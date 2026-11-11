#![no_std]
//! Kiba — pagos en USDC con el split de la plataforma, sobre Soroban (Stellar).
//!
//! Sustituye a los escrows de Trustless Work. Dos formas de pagar a un servicio, ambas con
//! el mismo split (`fee_bps` a la treasury, el resto al servicio):
//!
//!   pay                       pago directo en UNA tx (liquidaciones y pago por llamada).
//!   open / claim / refund     escrow por llamada (x402 desde el SDK, sin la plataforma):
//!                             el pagador bloquea el monto, el servicio cobra tras servir y,
//!                             si no lo hace antes de que expire, el pagador lo recupera.
//!
//! Sin funciones de administración: token, treasury y comisión se fijan al desplegar y no
//! cambian (nadie puede subir la comisión ni desviar pagos después).

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, token, Address, BytesN, Env,
};

const LEDGERS_PER_DAY: u32 = 17_280; // ~5 s por ledger
const INSTANCE_TTL: u32 = 30 * LEDGERS_PER_DAY;
/// Margen de TTL sobre la expiración de un escrow: tras expirar, el pagador tiene
/// este tiempo para recuperar los fondos antes de que la entrada pueda archivarse.
const TTL_MARGIN: u32 = 30 * LEDGERS_PER_DAY;
/// Tope de vida de un escrow (Soroban limita el TTL máximo de una entrada).
const MAX_TTL_LEDGERS: u32 = 120 * LEDGERS_PER_DAY;
#[contracttype]
#[derive(Clone)]
pub struct Config {
    pub token: Address,
    pub treasury: Address,
    pub fee_bps: u32,
}

#[contracttype]
#[derive(Clone, Debug, PartialEq)]
pub struct Escrow {
    pub payer: Address,
    pub receiver: Address,
    pub amount: i128,
    /// Último ledger en que el servicio puede cobrar; después, el pagador puede recuperar.
    pub expires: u32,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Config,
    Escrow(BytesN<32>),
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    BadAmount = 1,
    FeeTooHigh = 2,
    BadTtl = 3,
    EscrowExists = 10,
    EscrowNotFound = 11,
    EscrowExpired = 12,
    EscrowNotExpired = 13,
}

fn config(e: &Env) -> Config {
    e.storage().instance().extend_ttl(INSTANCE_TTL, INSTANCE_TTL);
    e.storage().instance().get(&Key::Config).unwrap()
}

fn check_ttl(e: &Env, ttl_ledgers: u32) -> u32 {
    if ttl_ledgers == 0 || ttl_ledgers > MAX_TTL_LEDGERS {
        panic_with_error!(e, Error::BadTtl);
    }
    e.ledger().sequence() + ttl_ledgers
}

fn keep(e: &Env, key: &Key, expires: u32) {
    let ttl = expires - e.ledger().sequence() + TTL_MARGIN;
    e.storage().persistent().extend_ttl(key, ttl, ttl);
}

/// Paga `amount` desde `from` repartiendo: comisión a la treasury, el resto a `to`.
fn split(e: &Env, cfg: &Config, from: &Address, to: &Address, amount: i128) -> (i128, i128) {
    let fee = amount * cfg.fee_bps as i128 / 10_000;
    let net = amount - fee;
    let t = token::Client::new(e, &cfg.token);
    if net > 0 {
        t.transfer(from, to, &net);
    }
    // Si paga la propia treasury (liquidaciones de la plataforma), la comisión ya está donde va.
    if fee > 0 && *from != cfg.treasury {
        t.transfer(from, &cfg.treasury, &fee);
    }
    (net, fee)
}

#[contract]
pub struct KibaPayments;

#[contractimpl]
impl KibaPayments {
    pub fn __constructor(e: Env, token: Address, treasury: Address, fee_bps: u32) {
        if fee_bps > 10_000 {
            panic_with_error!(&e, Error::FeeTooHigh);
        }
        e.storage().instance().set(&Key::Config, &Config { token, treasury, fee_bps });
        e.storage().instance().extend_ttl(INSTANCE_TTL, INSTANCE_TTL);
    }

    pub fn get_config(e: Env) -> Config {
        config(&e)
    }

    // ─── Pago directo ─────────────────────────────────────────

    /// Paga `amount` de `from` a `to` con el split. `reference` enlaza el pago con su origen
    /// (id de liquidación o de llamada) en el evento. Devuelve (neto, comisión).
    pub fn pay(e: Env, from: Address, to: Address, amount: i128, reference: u64) -> (i128, i128) {
        from.require_auth();
        if amount <= 0 {
            panic_with_error!(&e, Error::BadAmount);
        }
        let cfg = config(&e);
        let (net, fee) = split(&e, &cfg, &from, &to, amount);
        e.events().publish(("paid", to), (from, amount, fee, reference));
        (net, fee)
    }

    // ─── Escrow por llamada ───────────────────────────────────

    /// Bloquea `amount` de `payer` para `receiver` bajo `id` (32 bytes elegidos por el pagador).
    pub fn open(e: Env, payer: Address, receiver: Address, amount: i128, id: BytesN<32>, ttl_ledgers: u32) {
        payer.require_auth();
        if amount <= 0 {
            panic_with_error!(&e, Error::BadAmount);
        }
        let key = Key::Escrow(id.clone());
        if e.storage().persistent().has(&key) {
            panic_with_error!(&e, Error::EscrowExists);
        }
        let expires = check_ttl(&e, ttl_ledgers);
        let cfg = config(&e);
        token::Client::new(&e, &cfg.token).transfer(&payer, &e.current_contract_address(), &amount);
        e.storage().persistent().set(&key, &Escrow { payer: payer.clone(), receiver: receiver.clone(), amount, expires });
        keep(&e, &key, expires);
        e.events().publish(("opened", receiver), (id, payer, amount, expires));
    }

    /// El servicio cobra el escrow (con el split) antes de que expire.
    pub fn claim(e: Env, id: BytesN<32>) -> (i128, i128) {
        let key = Key::Escrow(id.clone());
        let esc: Escrow = e
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&e, Error::EscrowNotFound));
        esc.receiver.require_auth();
        if e.ledger().sequence() > esc.expires {
            panic_with_error!(&e, Error::EscrowExpired);
        }
        e.storage().persistent().remove(&key);
        let cfg = config(&e);
        let (net, fee) = split(&e, &cfg, &e.current_contract_address(), &esc.receiver, esc.amount);
        e.events().publish(("claimed", esc.receiver), (id, net, fee));
        (net, fee)
    }

    /// Tras la expiración sin cobro, devuelve el monto al pagador (cualquiera puede dispararlo).
    pub fn refund(e: Env, id: BytesN<32>) {
        let key = Key::Escrow(id.clone());
        let esc: Escrow = e
            .storage()
            .persistent()
            .get(&key)
            .unwrap_or_else(|| panic_with_error!(&e, Error::EscrowNotFound));
        if e.ledger().sequence() <= esc.expires {
            panic_with_error!(&e, Error::EscrowNotExpired);
        }
        e.storage().persistent().remove(&key);
        let cfg = config(&e);
        token::Client::new(&e, &cfg.token).transfer(&e.current_contract_address(), &esc.payer, &esc.amount);
        e.events().publish(("refunded", esc.payer), (id, esc.amount));
    }

    pub fn get_escrow(e: Env, id: BytesN<32>) -> Option<Escrow> {
        e.storage().persistent().get(&Key::Escrow(id))
    }
}

#[cfg(test)]
mod test;
