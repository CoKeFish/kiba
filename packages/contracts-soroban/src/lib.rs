#![no_std]
//! Kiba — registry + x402 escrow sobre Soroban (Stellar).
//!
//! Port idiomático del programa Anchor de Solana. Misma lógica de protocolo:
//!   - Registro de agentes (uno por `service`).
//!   - Escrow x402: el cliente bloquea el pago, el agente lo reclama tras servir.
//!   - Split atómico 95/5: 95% al owner del agente, 5% a la treasury.
//!   - Refund tras una ventana de espera si el agente nunca reclama.
//!
//! Diferencia clave con Solana: en lugar de mover el activo nativo entre PDAs,
//! el contrato CUSTODIA un token (USDC o XLM como Stellar Asset Contract) y lo
//! mueve con la interfaz de token de Soroban. El token y la treasury se fijan
//! una sola vez en `initialize` (no hay setter → para cambiarlos se redepliega,
//! igual que la treasury hardcodeada del contrato Anchor).
//!
//! Funciones:
//!   initialize
//!   register_agent / update_agent / deregister_agent
//!   open_escrow / claim_payment / refund_escrow
//!   get_agent / get_escrow / get_config (lecturas)

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, token, Address, Env, String, Symbol,
};

/// Comisión de la plataforma en basis points (500 = 5%). Idéntica al contrato
/// Anchor. Se descuenta en cada `claim_payment`; el resto va al owner del agente.
const PLATFORM_FEE_BPS: i128 = 500;
const BPS_DENOMINATOR: i128 = 10_000;

/// Segundos que un escrow debe estar abierto antes de poder ser reembolsado.
/// 5 minutos: suficiente para que el agente ejecute y reclame.
const REFUND_DELAY_SECS: u64 = 300;

/// Límites de tamaño para evitar bloat de almacenamiento.
const MAX_SERVICE_LEN: u32 = 32;
const MAX_ENDPOINT_LEN: u32 = 256;
const MAX_DESCRIPTION_LEN: u32 = 512;

/// TTL del almacenamiento persistente. Soroban cobra "rent" vía time-to-live:
/// extendemos las entradas ~30 días y las renovamos cuando les quedan < ~1 día.
const LEDGERS_PER_DAY: u32 = 17_280; // ~5s por ledger
const TTL_THRESHOLD: u32 = LEDGERS_PER_DAY;
const TTL_EXTEND_TO: u32 = 30 * LEDGERS_PER_DAY;

// ═══════════════════════════════════════════════════════════════
//   Tipos
// ═══════════════════════════════════════════════════════════════

#[contracttype]
#[derive(Clone)]
pub struct Config {
    /// Stellar Asset Contract del token de liquidación (USDC/XLM).
    pub token: Address,
    /// Wallet que recibe la comisión de la plataforma.
    pub treasury: Address,
}

#[contracttype]
#[derive(Clone)]
pub struct Agent {
    pub owner: Address,
    pub service: String,
    pub price_per_call: i128,
    pub endpoint: String,
    pub description: String,
    pub total_calls: u64,
    pub total_earned: i128,
    pub created_at: u64,
}

#[contracttype]
#[derive(Clone, PartialEq, Eq, Debug)]
pub enum EscrowState {
    Pending,
    Completed,
    Refunded,
}

#[contracttype]
#[derive(Clone)]
pub struct Escrow {
    pub client: Address,
    pub agent_owner: Address,
    pub service: String,
    pub amount: i128,
    pub nonce: u64,
    pub created_at: u64,
    pub state: EscrowState,
}

/// Llaves de almacenamiento. Sustituyen a los PDAs de Solana:
///   - Agent  ← seeded por `service` (1 por servicio).
///   - Escrow ← seeded por (client, agent_owner, nonce) (1 por pago).
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Config,
    Agent(String),
    Escrow(Address, Address, u64),
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    ServiceEmpty = 3,
    ServiceTooLong = 4,
    EndpointTooLong = 5,
    DescriptionTooLong = 6,
    PriceMustBePositive = 7,
    AmountMustBePositive = 8,
    AmountBelowPrice = 9,
    AgentNotFound = 10,
    AgentExists = 11,
    EscrowNotFound = 12,
    EscrowExists = 13,
    EscrowNotPending = 14,
    Unauthorized = 15,
    RefundTooEarly = 16,
    ArithmeticOverflow = 17,
}

// ═══════════════════════════════════════════════════════════════
//   Contrato
// ═══════════════════════════════════════════════════════════════

#[contract]
pub struct Kiba;

#[contractimpl]
impl Kiba {
    /// Fija el token de liquidación y la treasury. Solo una vez.
    // TODO(kiba, contracts-crosscut-01): `initialize` no exige auth → en un redeploy futuro
    // es front-runnable antes de que el deployer la llame. Endurecer migrándola a un
    // `__constructor` (atómico en el deploy) en la próxima versión del contrato. Mitigación
    // actual: deploy-testnet.sh despliega e inicializa en secuencia inmediata.
    pub fn initialize(env: Env, token: Address, treasury: Address) -> Result<(), Error> {
        if env.storage().instance().has(&DataKey::Config) {
            return Err(Error::AlreadyInitialized);
        }
        env.storage()
            .instance()
            .set(&DataKey::Config, &Config { token, treasury });
        Ok(())
    }

    // ─── Registry ─────────────────────────────────────────────

    pub fn register_agent(
        env: Env,
        owner: Address,
        service: String,
        price_per_call: i128,
        endpoint: String,
        description: String,
    ) -> Result<(), Error> {
        owner.require_auth();

        if service.len() == 0 {
            return Err(Error::ServiceEmpty);
        }
        if service.len() > MAX_SERVICE_LEN {
            return Err(Error::ServiceTooLong);
        }
        if endpoint.len() > MAX_ENDPOINT_LEN {
            return Err(Error::EndpointTooLong);
        }
        if description.len() > MAX_DESCRIPTION_LEN {
            return Err(Error::DescriptionTooLong);
        }
        if price_per_call <= 0 {
            return Err(Error::PriceMustBePositive);
        }

        let key = DataKey::Agent(service.clone());
        if env.storage().persistent().has(&key) {
            return Err(Error::AgentExists);
        }

        let now = env.ledger().timestamp();
        let agent = Agent {
            owner: owner.clone(),
            service: service.clone(),
            price_per_call,
            endpoint,
            description,
            total_calls: 0,
            total_earned: 0,
            created_at: now,
        };
        env.storage().persistent().set(&key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        env.events().publish(
            (Symbol::new(&env, "agent_registered"), owner),
            (service, price_per_call, now),
        );
        Ok(())
    }

    pub fn update_agent(
        env: Env,
        service: String,
        price_per_call: Option<i128>,
        endpoint: Option<String>,
        description: Option<String>,
    ) -> Result<(), Error> {
        let key = DataKey::Agent(service.clone());
        let mut agent: Agent = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::AgentNotFound)?;
        agent.owner.require_auth();

        if let Some(p) = price_per_call {
            if p <= 0 {
                return Err(Error::PriceMustBePositive);
            }
            agent.price_per_call = p;
        }
        if let Some(e) = endpoint {
            if e.len() > MAX_ENDPOINT_LEN {
                return Err(Error::EndpointTooLong);
            }
            agent.endpoint = e;
        }
        if let Some(d) = description {
            if d.len() > MAX_DESCRIPTION_LEN {
                return Err(Error::DescriptionTooLong);
            }
            agent.description = d;
        }

        env.storage().persistent().set(&key, &agent);
        env.storage()
            .persistent()
            .extend_ttl(&key, TTL_THRESHOLD, TTL_EXTEND_TO);

        env.events()
            .publish((Symbol::new(&env, "agent_updated"), agent.owner), service);
        Ok(())
    }

    pub fn deregister_agent(env: Env, service: String) -> Result<(), Error> {
        let key = DataKey::Agent(service.clone());
        let agent: Agent = env
            .storage()
            .persistent()
            .get(&key)
            .ok_or(Error::AgentNotFound)?;
        agent.owner.require_auth();

        env.storage().persistent().remove(&key);

        env.events()
            .publish((Symbol::new(&env, "agent_deregistered"), agent.owner), service);
        Ok(())
    }

    // ─── Escrow x402 ──────────────────────────────────────────

    pub fn open_escrow(
        env: Env,
        client: Address,
        service: String,
        nonce: u64,
        amount: i128,
    ) -> Result<(), Error> {
        client.require_auth();

        if amount <= 0 {
            return Err(Error::AmountMustBePositive);
        }

        let agent: Agent = env
            .storage()
            .persistent()
            .get(&DataKey::Agent(service.clone()))
            .ok_or(Error::AgentNotFound)?;

        // El cliente paga al menos el precio del servicio; puede pagar más.
        if amount < agent.price_per_call {
            return Err(Error::AmountBelowPrice);
        }

        let ekey = DataKey::Escrow(client.clone(), agent.owner.clone(), nonce);
        if env.storage().persistent().has(&ekey) {
            return Err(Error::EscrowExists);
        }

        // Transferir el token del cliente al contrato (custodia hasta claim/refund).
        let config = Self::load_config(&env)?;
        let token_client = token::Client::new(&env, &config.token);
        token_client.transfer(&client, &env.current_contract_address(), &amount);

        let now = env.ledger().timestamp();
        let escrow = Escrow {
            client: client.clone(),
            agent_owner: agent.owner.clone(),
            service: service.clone(),
            amount,
            nonce,
            created_at: now,
            state: EscrowState::Pending,
        };
        env.storage().persistent().set(&ekey, &escrow);
        env.storage()
            .persistent()
            .extend_ttl(&ekey, TTL_THRESHOLD, TTL_EXTEND_TO);

        env.events().publish(
            (Symbol::new(&env, "escrow_opened"), client, agent.owner),
            (service, amount, nonce, now),
        );
        Ok(())
    }

    pub fn claim_payment(
        env: Env,
        client: Address,
        agent_owner: Address,
        nonce: u64,
    ) -> Result<(), Error> {
        let ekey = DataKey::Escrow(client.clone(), agent_owner.clone(), nonce);
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&ekey)
            .ok_or(Error::EscrowNotFound)?;

        if escrow.state != EscrowState::Pending {
            return Err(Error::EscrowNotPending);
        }
        // Solo el owner del agente puede reclamar.
        agent_owner.require_auth();
        if escrow.agent_owner != agent_owner {
            return Err(Error::Unauthorized);
        }

        let amount = escrow.amount;

        // Split: el fee redondea hacia abajo en favor del owner (idéntico a Anchor).
        let platform_fee = amount
            .checked_mul(PLATFORM_FEE_BPS)
            .ok_or(Error::ArithmeticOverflow)?
            .checked_div(BPS_DENOMINATOR)
            .ok_or(Error::ArithmeticOverflow)?;
        let owner_amount = amount
            .checked_sub(platform_fee)
            .ok_or(Error::ArithmeticOverflow)?;

        let config = Self::load_config(&env)?;
        let token_client = token::Client::new(&env, &config.token);
        let contract = env.current_contract_address();

        // El contrato mueve sus propios fondos custodiados → no requiere auth extra.
        token_client.transfer(&contract, &agent_owner, &owner_amount);
        if platform_fee > 0 {
            token_client.transfer(&contract, &config.treasury, &platform_fee);
        }

        escrow.state = EscrowState::Completed;
        env.storage().persistent().set(&ekey, &escrow);

        // Estadísticas del agente (best-effort: si fue dado de baja, no falla el claim).
        let akey = DataKey::Agent(escrow.service.clone());
        if let Some(mut agent) = env.storage().persistent().get::<DataKey, Agent>(&akey) {
            agent.total_calls = agent.total_calls.saturating_add(1);
            agent.total_earned = agent.total_earned.saturating_add(owner_amount);
            env.storage().persistent().set(&akey, &agent);
        }

        env.events().publish(
            (Symbol::new(&env, "payment_claimed"), client, agent_owner),
            (amount, owner_amount, platform_fee, nonce),
        );
        Ok(())
    }

    pub fn refund_escrow(
        env: Env,
        client: Address,
        agent_owner: Address,
        nonce: u64,
    ) -> Result<(), Error> {
        client.require_auth();

        let ekey = DataKey::Escrow(client.clone(), agent_owner.clone(), nonce);
        let mut escrow: Escrow = env
            .storage()
            .persistent()
            .get(&ekey)
            .ok_or(Error::EscrowNotFound)?;

        if escrow.state != EscrowState::Pending {
            return Err(Error::EscrowNotPending);
        }
        if escrow.client != client {
            return Err(Error::Unauthorized);
        }

        let now = env.ledger().timestamp();
        if now <= escrow.created_at + REFUND_DELAY_SECS {
            return Err(Error::RefundTooEarly);
        }

        let config = Self::load_config(&env)?;
        let token_client = token::Client::new(&env, &config.token);
        token_client.transfer(&env.current_contract_address(), &client, &escrow.amount);

        escrow.state = EscrowState::Refunded;
        env.storage().persistent().set(&ekey, &escrow);

        env.events().publish(
            (Symbol::new(&env, "escrow_refunded"), client),
            (escrow.amount, nonce, now),
        );
        Ok(())
    }

    // ─── Lecturas ─────────────────────────────────────────────

    pub fn get_agent(env: Env, service: String) -> Option<Agent> {
        env.storage().persistent().get(&DataKey::Agent(service))
    }

    pub fn get_escrow(
        env: Env,
        client: Address,
        agent_owner: Address,
        nonce: u64,
    ) -> Option<Escrow> {
        env.storage()
            .persistent()
            .get(&DataKey::Escrow(client, agent_owner, nonce))
    }

    pub fn get_config(env: Env) -> Option<Config> {
        env.storage().instance().get(&DataKey::Config)
    }

    // ─── Internos ─────────────────────────────────────────────

    fn load_config(env: &Env) -> Result<Config, Error> {
        env.storage()
            .instance()
            .get(&DataKey::Config)
            .ok_or(Error::NotInitialized)
    }
}

#[cfg(test)]
mod test;
