#![no_std]
//! Kiba — pagos en USDC con el split de la plataforma, sobre Soroban (Stellar).
//!
//! Sustituye a los escrows de Trustless Work. Tres formas de pagar a un servicio, todas con
//! el mismo split (`fee_bps` a la treasury, el resto al servicio):
//!
//!   pay                       pago directo en UNA tx (liquidaciones y pago por llamada).
//!   open / claim / refund     escrow por llamada (x402 desde el SDK, sin la plataforma):
//!                             el pagador bloquea el monto, el servicio cobra tras servir y,
//!                             si no lo hace antes de que expire, el pagador lo recupera.
//!   open_channel / redeem /   canal de pago: el pagador deposita una vez y firma off-chain
//!   close_channel             vales (ed25519) con el total acumulado; el servicio los verifica
//!                             al instante y cobra el último cuando quiere (por lotes).
//!
//! Sin funciones de administración: token, treasury y comisión se fijan al desplegar y no
//! cambian (nadie puede subir la comisión ni desviar pagos después).

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, panic_with_error, token, xdr::ToXdr,
    Address, Bytes, BytesN, Env,
};

const LEDGERS_PER_DAY: u32 = 17_280; // ~5 s por ledger
const INSTANCE_TTL: u32 = 30 * LEDGERS_PER_DAY;
/// Margen de TTL sobre la expiración de un escrow/canal: tras expirar, el pagador tiene
/// este tiempo para recuperar los fondos antes de que la entrada pueda archivarse.
const TTL_MARGIN: u32 = 30 * LEDGERS_PER_DAY;
/// Tope de vida de un escrow o canal (Soroban limita el TTL máximo de una entrada).
const MAX_TTL_LEDGERS: u32 = 120 * LEDGERS_PER_DAY;
/// Prefijo del mensaje que firma el pagador en cada vale (separación de dominio).
const VOUCHER_DOMAIN: &[u8] = b"kiba-voucher-v1";

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
#[derive(Clone, Debug, PartialEq)]
pub struct Channel {
    /// Clave ed25519 con la que el pagador firma los vales.
    pub key: BytesN<32>,
    pub deposit: i128,
    /// Total ya cobrado por el servicio (los vales llevan el total acumulado, no el delta).
    pub redeemed: i128,
    pub expires: u32,
}

#[contracttype]
#[derive(Clone)]
enum Key {
    Config,
    Escrow(BytesN<32>),
    Channel(Address, Address),
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
    ChannelNotFound = 20,
    ChannelKeyMismatch = 21,
    ChannelExpired = 22,
    ChannelNotExpired = 23,
    VoucherNotNew = 24,
    VoucherOverDeposit = 25,
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

/// Mensaje que firma el pagador para un vale: dominio | contrato | pagador | servicio | total.
pub fn voucher_message(e: &Env, payer: &Address, receiver: &Address, cumulative: i128) -> Bytes {
    let mut m = Bytes::from_slice(e, VOUCHER_DOMAIN);
    m.append(&e.current_contract_address().to_xdr(e));
    m.append(&payer.clone().to_xdr(e));
    m.append(&receiver.clone().to_xdr(e));
    m.append(&Bytes::from_slice(e, &cumulative.to_be_bytes()));
    m
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

    // ─── Canal de pago con vales ──────────────────────────────

    /// Abre (o recarga) el canal `payer` → `receiver` depositando `amount`. Los vales se firman
    /// con `key`; recargar exige la misma clave y puede alargar la expiración.
    pub fn open_channel(e: Env, payer: Address, receiver: Address, key: BytesN<32>, amount: i128, ttl_ledgers: u32) {
        payer.require_auth();
        if amount <= 0 {
            panic_with_error!(&e, Error::BadAmount);
        }
        let expires = check_ttl(&e, ttl_ledgers);
        let k = Key::Channel(payer.clone(), receiver.clone());
        let ch = match e.storage().persistent().get::<_, Channel>(&k) {
            Some(mut ch) => {
                if ch.key != key {
                    panic_with_error!(&e, Error::ChannelKeyMismatch);
                }
                ch.deposit += amount;
                ch.expires = ch.expires.max(expires);
                ch
            }
            None => Channel { key, deposit: amount, redeemed: 0, expires },
        };
        let cfg = config(&e);
        token::Client::new(&e, &cfg.token).transfer(&payer, &e.current_contract_address(), &amount);
        e.storage().persistent().set(&k, &ch);
        keep(&e, &k, ch.expires);
        e.events().publish(("channel", receiver), (payer, ch.deposit, ch.expires));
    }

    /// El servicio cobra hasta el total acumulado de un vale firmado por el pagador. Solo paga
    /// la diferencia con lo ya cobrado, así que un vale viejo o repetido no paga dos veces.
    pub fn redeem(e: Env, payer: Address, receiver: Address, cumulative: i128, signature: BytesN<64>) -> (i128, i128) {
        receiver.require_auth();
        let k = Key::Channel(payer.clone(), receiver.clone());
        let mut ch: Channel = e
            .storage()
            .persistent()
            .get(&k)
            .unwrap_or_else(|| panic_with_error!(&e, Error::ChannelNotFound));
        if e.ledger().sequence() > ch.expires {
            panic_with_error!(&e, Error::ChannelExpired);
        }
        if cumulative <= ch.redeemed {
            panic_with_error!(&e, Error::VoucherNotNew);
        }
        if cumulative > ch.deposit {
            panic_with_error!(&e, Error::VoucherOverDeposit);
        }
        let msg = voucher_message(&e, &payer, &receiver, cumulative);
        e.crypto().ed25519_verify(&ch.key, &msg, &signature);
        let delta = cumulative - ch.redeemed;
        ch.redeemed = cumulative;
        e.storage().persistent().set(&k, &ch);
        keep(&e, &k, ch.expires);
        let cfg = config(&e);
        let (net, fee) = split(&e, &cfg, &e.current_contract_address(), &receiver, delta);
        e.events().publish(("redeemed", receiver), (payer, cumulative, net, fee));
        (net, fee)
    }

    /// Tras la expiración, devuelve al pagador lo que el servicio no cobró y cierra el canal.
    pub fn close_channel(e: Env, payer: Address, receiver: Address) -> i128 {
        let k = Key::Channel(payer.clone(), receiver.clone());
        let ch: Channel = e
            .storage()
            .persistent()
            .get(&k)
            .unwrap_or_else(|| panic_with_error!(&e, Error::ChannelNotFound));
        if e.ledger().sequence() <= ch.expires {
            panic_with_error!(&e, Error::ChannelNotExpired);
        }
        e.storage().persistent().remove(&k);
        let left = ch.deposit - ch.redeemed;
        if left > 0 {
            let cfg = config(&e);
            token::Client::new(&e, &cfg.token).transfer(&e.current_contract_address(), &payer, &left);
        }
        e.events().publish(("closed", receiver), (payer, left));
        left
    }

    pub fn get_channel(e: Env, payer: Address, receiver: Address) -> Option<Channel> {
        e.storage().persistent().get(&Key::Channel(payer, receiver))
    }
}

#[cfg(test)]
mod test;
