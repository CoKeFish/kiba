#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::testutils::Address as _;
use soroban_sdk::{Address, Env, String};

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

// ─── auth on-chain ─────────────────────────────────────────────

#[test]
#[should_panic] // sin mock de auth, owner.require_auth() en register_agent debe fallar
fn register_agent_requires_owner_auth() {
    let env = Env::default(); // SIN mock_all_auths → require_auth NO pasa
    let contract_id = env.register(Kiba, ());
    let app = KibaClient::new(&env, &contract_id);
    let token = Address::generate(&env);
    let treasury = Address::generate(&env);
    app.initialize(&token, &treasury); // initialize no exige auth
    let owner = Address::generate(&env);
    // register_agent exige owner.require_auth() → panic sin auth mockeada.
    app.register_agent(&owner, &s(&env, "svc"), &1, &s(&env, ""), &s(&env, ""));
}
