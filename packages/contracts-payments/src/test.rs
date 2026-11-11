#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{Address as _, Ledger},
    token::{StellarAssetClient, TokenClient},
    Address, BytesN, Env,
};

const FEE_BPS: u32 = 500; // 5 %

/// Error de contrato tal como lo ve el cliente (las funciones fallan con panic_with_error!).
fn ce(x: Error) -> soroban_sdk::Error {
    soroban_sdk::Error::from_contract_error(x as u32)
}

struct Setup<'a> {
    e: Env,
    c: KibaPaymentsClient<'a>,
    usdc: TokenClient<'a>,
    treasury: Address,
    payer: Address,
    service: Address,
}

fn setup<'a>() -> Setup<'a> {
    let e = Env::default();
    e.mock_all_auths();
    let issuer = Address::generate(&e);
    let sac = e.register_stellar_asset_contract_v2(issuer);
    let usdc = TokenClient::new(&e, &sac.address());
    let treasury = Address::generate(&e);
    let payer = Address::generate(&e);
    let service = Address::generate(&e);
    StellarAssetClient::new(&e, &sac.address()).mint(&payer, &1_000_000_000);
    let id = e.register(KibaPayments, (sac.address(), treasury.clone(), FEE_BPS));
    let c = KibaPaymentsClient::new(&e, &id);
    Setup { e, c, usdc, treasury, payer, service }
}

fn id(e: &Env, n: u8) -> BytesN<32> {
    BytesN::from_array(e, &[n; 32])
}

fn advance(e: &Env, ledgers: u32) {
    e.ledger().with_mut(|l| l.sequence_number += ledgers);
}

#[test]
fn pay_reparte_con_la_comision() {
    let s = setup();
    let (net, fee) = s.c.pay(&s.payer, &s.service, &10_000, &7);
    assert_eq!((net, fee), (9_500, 500));
    assert_eq!(s.usdc.balance(&s.service), 9_500);
    assert_eq!(s.usdc.balance(&s.treasury), 500);
    assert_eq!(s.usdc.balance(&s.payer), 1_000_000_000 - 10_000);
}

#[test]
fn pay_desde_la_treasury_retiene_la_comision_sin_transferirla() {
    let s = setup();
    StellarAssetClient::new(&s.e, &s.usdc.address).mint(&s.treasury, &50_000);
    assert_eq!(s.c.pay(&s.treasury, &s.service, &10_000, &1), (9_500, 500));
    assert_eq!(s.usdc.balance(&s.service), 9_500);
    assert_eq!(s.usdc.balance(&s.treasury), 40_500);
}

#[test]
fn pay_micropago_redondea_la_comision_hacia_abajo() {
    let s = setup();
    // 0.0000019 USDC: 5 % = 0.95 unidades → 0 de comisión, todo al servicio.
    assert_eq!(s.c.pay(&s.payer, &s.service, &19, &0), (19, 0));
}

#[test]
fn pay_rechaza_montos_no_positivos() {
    let s = setup();
    assert_eq!(s.c.try_pay(&s.payer, &s.service, &0, &0), Err(Ok(ce(Error::BadAmount))));
}

#[test]
fn pay_exige_la_firma_del_pagador() {
    let s = setup();
    s.c.pay(&s.payer, &s.service, &100, &1);
    let auths = s.e.auths();
    assert_eq!(auths.len(), 1);
    assert_eq!(auths[0].0, s.payer);
}

#[test]
fn constructor_rechaza_comision_mayor_al_100() {
    let e = Env::default();
    let t = Address::generate(&e);
    let r = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        e.register(KibaPayments, (t.clone(), t.clone(), 10_001u32));
    }));
    assert!(r.is_err());
}

#[test]
fn escrow_el_servicio_cobra_tras_servir() {
    let s = setup();
    s.c.open(&s.payer, &s.service, &20_000, &id(&s.e, 1), &100);
    assert_eq!(s.usdc.balance(&s.c.address), 20_000);
    let esc = s.c.get_escrow(&id(&s.e, 1)).unwrap();
    assert_eq!((esc.payer.clone(), esc.receiver.clone(), esc.amount), (s.payer.clone(), s.service.clone(), 20_000));
    assert_eq!(s.c.claim(&id(&s.e, 1)), (19_000, 1_000));
    assert_eq!(s.usdc.balance(&s.service), 19_000);
    assert_eq!(s.usdc.balance(&s.treasury), 1_000);
    assert_eq!(s.usdc.balance(&s.c.address), 0);
    assert!(s.c.get_escrow(&id(&s.e, 1)).is_none());
}

#[test]
fn escrow_no_se_cobra_dos_veces() {
    let s = setup();
    s.c.open(&s.payer, &s.service, &20_000, &id(&s.e, 1), &100);
    s.c.claim(&id(&s.e, 1));
    assert_eq!(s.c.try_claim(&id(&s.e, 1)), Err(Ok(ce(Error::EscrowNotFound))));
}

#[test]
fn escrow_id_repetido_rechazado() {
    let s = setup();
    s.c.open(&s.payer, &s.service, &1, &id(&s.e, 1), &100);
    assert_eq!(s.c.try_open(&s.payer, &s.service, &1, &id(&s.e, 1), &100), Err(Ok(ce(Error::EscrowExists))));
}

#[test]
fn escrow_expirado_vuelve_al_pagador_y_ya_no_se_cobra() {
    let s = setup();
    s.c.open(&s.payer, &s.service, &20_000, &id(&s.e, 1), &10);
    assert_eq!(s.c.try_refund(&id(&s.e, 1)), Err(Ok(ce(Error::EscrowNotExpired))));
    advance(&s.e, 11);
    assert_eq!(s.c.try_claim(&id(&s.e, 1)), Err(Ok(ce(Error::EscrowExpired))));
    s.c.refund(&id(&s.e, 1));
    assert_eq!(s.usdc.balance(&s.payer), 1_000_000_000);
    assert_eq!(s.c.try_refund(&id(&s.e, 1)), Err(Ok(ce(Error::EscrowNotFound))));
}

#[test]
fn escrow_cobro_exige_la_firma_del_servicio() {
    let s = setup();
    s.c.open(&s.payer, &s.service, &5, &id(&s.e, 9), &100);
    s.c.claim(&id(&s.e, 9));
    let auths = s.e.auths();
    assert_eq!(auths[0].0, s.service);
}

#[test]
fn escrow_ttl_fuera_de_rango() {
    let s = setup();
    assert_eq!(s.c.try_open(&s.payer, &s.service, &1, &id(&s.e, 1), &0), Err(Ok(ce(Error::BadTtl))));
    assert_eq!(
        s.c.try_open(&s.payer, &s.service, &1, &id(&s.e, 2), &(MAX_TTL_LEDGERS + 1)),
        Err(Ok(ce(Error::BadTtl)))
    );
}
