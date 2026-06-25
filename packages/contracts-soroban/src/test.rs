#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::testutils::{Address as _, Ledger as _};
use soroban_sdk::{token, Address, Env, String};

/// Crea el entorno, un token (Stellar Asset Contract), la treasury y el contrato
/// ya inicializado. Devuelve direcciones (los clients se crean en cada test para
/// evitar problemas de lifetime con el Env local).
fn setup() -> (Env, Address, Address, Address) {
    let env = Env::default();
    env.mock_all_auths();

    let token_admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(token_admin);
    let token_id = sac.address();

    let treasury = Address::generate(&env);
    let contract_id = env.register(Kiba, ());

    let app = KibaClient::new(&env, &contract_id);
    app.initialize(&token_id, &treasury);

    (env, contract_id, token_id, treasury)
}

fn s(env: &Env, v: &str) -> String {
    String::from_str(env, v)
}

// ─── initialize ────────────────────────────────────────────────

#[test]
fn initialize_sets_config() {
    let (env, contract_id, token_id, treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);

    let config = app.get_config().unwrap();
    assert_eq!(config.token, token_id);
    assert_eq!(config.treasury, treasury);
}

#[test]
fn initialize_twice_fails() {
    let (env, contract_id, token_id, treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);

    assert_eq!(
        app.try_initialize(&token_id, &treasury),
        Err(Ok(Error::AlreadyInitialized))
    );
}

// ─── registry ──────────────────────────────────────────────────

#[test]
fn register_and_read_agent() {
    let (env, contract_id, _token, _treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    app.register_agent(
        &owner,
        &s(&env, "yield-hunter"),
        &10_000_000,
        &s(&env, "http://yield:5001"),
        &s(&env, "finds yield"),
    );

    let agent = app.get_agent(&s(&env, "yield-hunter")).unwrap();
    assert_eq!(agent.owner, owner);
    assert_eq!(agent.price_per_call, 10_000_000);
    assert_eq!(agent.total_calls, 0);
    assert_eq!(agent.total_earned, 0);
}

#[test]
fn register_duplicate_fails() {
    let (env, contract_id, _token, _treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let svc = s(&env, "dup");

    app.register_agent(&owner, &svc, &1, &s(&env, ""), &s(&env, ""));
    assert_eq!(
        app.try_register_agent(&owner, &svc, &1, &s(&env, ""), &s(&env, "")),
        Err(Ok(Error::AgentExists))
    );
}

#[test]
fn register_empty_service_fails() {
    let (env, contract_id, _token, _treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    assert_eq!(
        app.try_register_agent(&owner, &s(&env, ""), &10, &s(&env, ""), &s(&env, "")),
        Err(Ok(Error::ServiceEmpty))
    );
}

#[test]
fn register_nonpositive_price_fails() {
    let (env, contract_id, _token, _treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);
    let owner = Address::generate(&env);

    assert_eq!(
        app.try_register_agent(&owner, &s(&env, "free"), &0, &s(&env, ""), &s(&env, "")),
        Err(Ok(Error::PriceMustBePositive))
    );
}

#[test]
fn update_agent_changes_fields() {
    let (env, contract_id, _token, _treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let svc = s(&env, "translator");

    app.register_agent(&owner, &svc, &1_000, &s(&env, "http://old"), &s(&env, "old"));
    app.update_agent(
        &svc,
        &Some(2_000),
        &Some(s(&env, "http://new")),
        &None,
    );

    let agent = app.get_agent(&svc).unwrap();
    assert_eq!(agent.price_per_call, 2_000);
    assert_eq!(agent.endpoint, s(&env, "http://new"));
    assert_eq!(agent.description, s(&env, "old")); // sin cambio
}

#[test]
fn deregister_removes_agent() {
    let (env, contract_id, _token, _treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let svc = s(&env, "temp");

    app.register_agent(&owner, &svc, &1, &s(&env, ""), &s(&env, ""));
    app.deregister_agent(&svc);
    assert!(app.get_agent(&svc).is_none());
}

// ─── escrow x402 + split 95/5 ──────────────────────────────────

#[test]
fn full_payment_flow_splits_95_5() {
    let (env, contract_id, token_id, treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);
    let token = token::Client::new(&env, &token_id);
    let token_admin = token::StellarAssetClient::new(&env, &token_id);

    let owner = Address::generate(&env);
    let client = Address::generate(&env);
    let svc = s(&env, "yield-hunter");

    app.register_agent(&owner, &svc, &10_000_000, &s(&env, "http://a"), &s(&env, "d"));
    token_admin.mint(&client, &100_000_000);

    // open_escrow → el token pasa del cliente al contrato
    app.open_escrow(&client, &svc, &1u64, &100_000_000);
    assert_eq!(token.balance(&client), 0);
    assert_eq!(token.balance(&contract_id), 100_000_000);

    let esc = app.get_escrow(&client, &owner, &1u64).unwrap();
    assert_eq!(esc.state, EscrowState::Pending);
    assert_eq!(esc.amount, 100_000_000);

    // claim_payment → split 95/5 atómico
    app.claim_payment(&client, &owner, &1u64);
    assert_eq!(token.balance(&owner), 95_000_000); // 95%
    assert_eq!(token.balance(&treasury), 5_000_000); // 5%
    assert_eq!(token.balance(&contract_id), 0); // contrato vaciado

    // estadísticas del agente
    let agent = app.get_agent(&svc).unwrap();
    assert_eq!(agent.total_calls, 1);
    assert_eq!(agent.total_earned, 95_000_000);

    // escrow marcado Completed
    let esc = app.get_escrow(&client, &owner, &1u64).unwrap();
    assert_eq!(esc.state, EscrowState::Completed);
}

#[test]
fn split_rounds_fee_down() {
    // amount = 1 → fee = 1*500/10000 = 0 → owner se queda con todo (1).
    let (env, contract_id, token_id, treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);
    let token = token::Client::new(&env, &token_id);
    let token_admin = token::StellarAssetClient::new(&env, &token_id);

    let owner = Address::generate(&env);
    let client = Address::generate(&env);
    let svc = s(&env, "cheap");

    app.register_agent(&owner, &svc, &1, &s(&env, ""), &s(&env, ""));
    token_admin.mint(&client, &1);
    app.open_escrow(&client, &svc, &7u64, &1);
    app.claim_payment(&client, &owner, &7u64);

    assert_eq!(token.balance(&owner), 1);
    assert_eq!(token.balance(&treasury), 0);
}

#[test]
fn split_residue_goes_to_owner() {
    // amount = 20001 → fee = floor(20001*500/10000) = floor(1000.05) = 1000 (treasury),
    // owner = 20001 - 1000 = 19001. El residuo del redondeo queda a favor del OWNER
    // (consistente con el comentario del contrato y con la versión Anchor).
    let (env, contract_id, token_id, treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);
    let token = token::Client::new(&env, &token_id);
    let token_admin = token::StellarAssetClient::new(&env, &token_id);

    let owner = Address::generate(&env);
    let client = Address::generate(&env);
    let svc = s(&env, "residue");

    app.register_agent(&owner, &svc, &1, &s(&env, ""), &s(&env, ""));
    token_admin.mint(&client, &20_001);
    app.open_escrow(&client, &svc, &11u64, &20_001);
    app.claim_payment(&client, &owner, &11u64);

    assert_eq!(token.balance(&treasury), 1_000); // 5% truncado hacia abajo
    assert_eq!(token.balance(&owner), 19_001); // 95% + residuo del redondeo
    assert_eq!(token.balance(&contract_id), 0);
}

#[test]
fn open_escrow_below_price_fails() {
    let (env, contract_id, _token, _treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);
    let owner = Address::generate(&env);
    let client = Address::generate(&env);
    let svc = s(&env, "pricey");

    app.register_agent(&owner, &svc, &10_000_000, &s(&env, ""), &s(&env, ""));
    assert_eq!(
        app.try_open_escrow(&client, &svc, &1u64, &9_999_999),
        Err(Ok(Error::AmountBelowPrice))
    );
}

#[test]
fn claim_twice_fails() {
    let (env, contract_id, token_id, _treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);
    let token_admin = token::StellarAssetClient::new(&env, &token_id);

    let owner = Address::generate(&env);
    let client = Address::generate(&env);
    let svc = s(&env, "once");

    app.register_agent(&owner, &svc, &1_000, &s(&env, ""), &s(&env, ""));
    token_admin.mint(&client, &1_000);
    app.open_escrow(&client, &svc, &1u64, &1_000);
    app.claim_payment(&client, &owner, &1u64);

    assert_eq!(
        app.try_claim_payment(&client, &owner, &1u64),
        Err(Ok(Error::EscrowNotPending))
    );
}

// ─── refund ────────────────────────────────────────────────────

#[test]
fn refund_after_delay_returns_funds() {
    let (env, contract_id, token_id, _treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);
    let token = token::Client::new(&env, &token_id);
    let token_admin = token::StellarAssetClient::new(&env, &token_id);

    let owner = Address::generate(&env);
    let client = Address::generate(&env);
    let svc = s(&env, "abandoned");

    app.register_agent(&owner, &svc, &1_000, &s(&env, ""), &s(&env, ""));
    token_admin.mint(&client, &5_000);
    app.open_escrow(&client, &svc, &1u64, &5_000);
    assert_eq!(token.balance(&client), 0);

    // avanzar el tiempo más allá de la ventana de refund (300s)
    env.ledger().with_mut(|li| li.timestamp += 301);
    app.refund_escrow(&client, &owner, &1u64);

    assert_eq!(token.balance(&client), 5_000); // recuperado
    let esc = app.get_escrow(&client, &owner, &1u64).unwrap();
    assert_eq!(esc.state, EscrowState::Refunded);
}

#[test]
fn refund_too_early_fails() {
    let (env, contract_id, token_id, _treasury) = setup();
    let app = KibaClient::new(&env, &contract_id);
    let token_admin = token::StellarAssetClient::new(&env, &token_id);

    let owner = Address::generate(&env);
    let client = Address::generate(&env);
    let svc = s(&env, "fresh");

    app.register_agent(&owner, &svc, &1_000, &s(&env, ""), &s(&env, ""));
    token_admin.mint(&client, &5_000);
    app.open_escrow(&client, &svc, &1u64, &5_000);

    // sin avanzar el tiempo → todavía dentro de la ventana
    assert_eq!(
        app.try_refund_escrow(&client, &owner, &1u64),
        Err(Ok(Error::RefundTooEarly))
    );
}
