#![no_std]
//! Kiba — registro de agentes sobre Soroban (Stellar).
//!
//! Registro de agentes del marketplace (uno por `service`). El escrow x402 de los
//! pagos se liquida fuera de este contrato (Trustless Work).
//!
//! Funciones:
//!   register_agent / update_agent / deregister_agent
//!   get_agent (lectura)

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, Address, Env, String, Symbol,
};

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

/// Llaves de almacenamiento. Sustituyen a los PDAs de Solana:
///   - Agent ← seeded por `service` (1 por servicio).
#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Agent(String),
}

#[contracterror]
#[derive(Copy, Clone, Debug, PartialEq, Eq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    ServiceEmpty = 3,
    ServiceTooLong = 4,
    EndpointTooLong = 5,
    DescriptionTooLong = 6,
    PriceMustBePositive = 7,
    AgentNotFound = 10,
    AgentExists = 11,
}

// ═══════════════════════════════════════════════════════════════
//   Contrato
// ═══════════════════════════════════════════════════════════════

#[contract]
pub struct Kiba;

#[contractimpl]
impl Kiba {
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

    // ─── Lecturas ─────────────────────────────────────────────

    pub fn get_agent(env: Env, service: String) -> Option<Agent> {
        env.storage().persistent().get(&DataKey::Agent(service))
    }
}

#[cfg(test)]
mod test;
