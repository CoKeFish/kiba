#![cfg(test)]
extern crate std;

use super::*;
use ed25519_dalek::{Signer, SigningKey};
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

fn sign_voucher(s: &Setup, sk: &SigningKey, cumulative: i128) -> BytesN<64> {
    let msg = s.e.as_contract(&s.c.address, || voucher_message(&s.e, &s.payer, &s.service, cumulative));
    let mut buf = [0u8; 2048];
    let len = msg.len() as usize;
    msg.copy_into_slice(&mut buf[..len]);
    BytesN::from_array(&s.e, &sk.sign(&buf[..len]).to_bytes())
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

#[test]
fn canal_cobra_por_lotes_con_vales_acumulados() {
    let s = setup();
    let sk = SigningKey::from_bytes(&[7u8; 32]);
    let key = BytesN::from_array(&s.e, &sk.verifying_key().to_bytes());
    s.c.open_channel(&s.payer, &s.service, &key, &100_000, &1_000);
    // 3 llamadas de 5000: el servicio guarda solo el último vale y lo cobra una vez.
    let v3 = sign_voucher(&s, &sk, 15_000);
    assert_eq!(s.c.redeem(&s.payer, &s.service, &15_000, &v3), (14_250, 750));
    // Más llamadas después: un vale con un total mayor cobra solo la diferencia.
    let v5 = sign_voucher(&s, &sk, 25_000);
    assert_eq!(s.c.redeem(&s.payer, &s.service, &25_000, &v5), (9_500, 500));
    assert_eq!(s.usdc.balance(&s.service), 23_750);
    assert_eq!(s.usdc.balance(&s.treasury), 1_250);
    let ch = s.c.get_channel(&s.payer, &s.service).unwrap();
    assert_eq!((ch.deposit, ch.redeemed), (100_000, 25_000));
}

#[test]
fn canal_rechaza_vales_viejos_repetidos_o_falsos() {
    let s = setup();
    let sk = SigningKey::from_bytes(&[7u8; 32]);
    let key = BytesN::from_array(&s.e, &sk.verifying_key().to_bytes());
    s.c.open_channel(&s.payer, &s.service, &key, &100_000, &1_000);
    let v = sign_voucher(&s, &sk, 10_000);
    s.c.redeem(&s.payer, &s.service, &10_000, &v);
    assert_eq!(s.c.try_redeem(&s.payer, &s.service, &10_000, &v), Err(Ok(ce(Error::VoucherNotNew))));
    // Firma de otra clave → falla la verificación ed25519 (pánico del host).
    let otro = SigningKey::from_bytes(&[8u8; 32]);
    let falso = sign_voucher(&s, &otro, 20_000);
    assert!(s.c.try_redeem(&s.payer, &s.service, &20_000, &falso).is_err());
    // Vale válido con el total cambiado → firma no corresponde.
    let v2 = sign_voucher(&s, &sk, 20_000);
    assert!(s.c.try_redeem(&s.payer, &s.service, &30_000, &v2).is_err());
    assert_eq!(s.c.get_channel(&s.payer, &s.service).unwrap().redeemed, 10_000);
}

#[test]
fn canal_no_paga_mas_que_el_deposito() {
    let s = setup();
    let sk = SigningKey::from_bytes(&[7u8; 32]);
    let key = BytesN::from_array(&s.e, &sk.verifying_key().to_bytes());
    s.c.open_channel(&s.payer, &s.service, &key, &10_000, &1_000);
    let v = sign_voucher(&s, &sk, 10_001);
    assert_eq!(s.c.try_redeem(&s.payer, &s.service, &10_001, &v), Err(Ok(ce(Error::VoucherOverDeposit))));
}

#[test]
fn canal_vale_de_otro_servicio_no_sirve() {
    let s = setup();
    let sk = SigningKey::from_bytes(&[7u8; 32]);
    let key = BytesN::from_array(&s.e, &sk.verifying_key().to_bytes());
    let otro_servicio = Address::generate(&s.e);
    s.c.open_channel(&s.payer, &s.service, &key, &10_000, &1_000);
    s.c.open_channel(&s.payer, &otro_servicio, &key, &10_000, &1_000);
    // Vale firmado para `service`: presentado por otro servicio no verifica.
    let v = sign_voucher(&s, &sk, 5_000);
    assert!(s.c.try_redeem(&s.payer, &otro_servicio, &5_000, &v).is_err());
}

#[test]
fn canal_recarga_y_cierre_devuelve_lo_no_cobrado() {
    let s = setup();
    let sk = SigningKey::from_bytes(&[7u8; 32]);
    let key = BytesN::from_array(&s.e, &sk.verifying_key().to_bytes());
    s.c.open_channel(&s.payer, &s.service, &key, &10_000, &10);
    s.c.open_channel(&s.payer, &s.service, &key, &5_000, &20); // recarga y alarga
    let otra = BytesN::from_array(&s.e, &[1u8; 32]);
    assert_eq!(
        s.c.try_open_channel(&s.payer, &s.service, &otra, &1, &20),
        Err(Ok(ce(Error::ChannelKeyMismatch)))
    );
    let v = sign_voucher(&s, &sk, 4_000);
    s.c.redeem(&s.payer, &s.service, &4_000, &v);
    assert_eq!(s.c.try_close_channel(&s.payer, &s.service), Err(Ok(ce(Error::ChannelNotExpired))));
    advance(&s.e, 21);
    let v2 = sign_voucher(&s, &sk, 6_000);
    assert_eq!(s.c.try_redeem(&s.payer, &s.service, &6_000, &v2), Err(Ok(ce(Error::ChannelExpired))));
    assert_eq!(s.c.close_channel(&s.payer, &s.service), 11_000);
    assert_eq!(s.usdc.balance(&s.payer), 1_000_000_000 - 4_000);
    assert!(s.c.get_channel(&s.payer, &s.service).is_none());
}
