//! Agent Bazaar — registry + x402 escrow on Solana
//!
//! Para simplicidad de implementación en hackathon, este programa usa **SOL nativo (lamports)**
//! como medio de pago en lugar de USDC. La lógica del protocolo x402 es idéntica;
//! para producción es un cambio de una capa: usar `anchor_spl::token::transfer` con un mint USDC
//! en lugar de mover lamports directamente.
//!
//! Cuentas / instrucciones:
//!   - Agent (PDA seeded by service name) — registry entry
//!   - Escrow (PDA seeded by client + agent_owner + nonce) — pago retenido hasta claim
//!
//!   register_agent / update_agent / deregister_agent
//!   open_escrow / claim_payment / refund_escrow

use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("3CsQnAua3xniuMY5axKUNYtmTyAxh6cG2E257PLjJCmA");

/// Tiempo mínimo (segundos) que un escrow debe estar abierto antes de poder ser refunded.
/// 5 minutos en producción; suficiente para que un agente ejecute y claim.
pub const REFUND_DELAY_SECS: i64 = 300;

/// Límites de tamaño para evitar account bloat.
pub const MAX_SERVICE_LEN: usize = 32;
pub const MAX_ENDPOINT_LEN: usize = 256;
pub const MAX_DESCRIPTION_LEN: usize = 512;

#[program]
pub mod agent_bazaar {
    use super::*;

    // ─── Registry ─────────────────────────────────────────────

    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        service: String,
        price_per_call: u64,
        endpoint: String,
        description: String,
    ) -> Result<()> {
        require!(!service.is_empty(), ErrorCode::ServiceEmpty);
        require!(service.len() <= MAX_SERVICE_LEN, ErrorCode::ServiceTooLong);
        require!(endpoint.len() <= MAX_ENDPOINT_LEN, ErrorCode::EndpointTooLong);
        require!(description.len() <= MAX_DESCRIPTION_LEN, ErrorCode::DescriptionTooLong);
        require!(price_per_call > 0, ErrorCode::PriceMustBePositive);

        let agent = &mut ctx.accounts.agent;
        agent.owner = ctx.accounts.owner.key();
        agent.service = service.clone();
        agent.price_per_call = price_per_call;
        agent.endpoint = endpoint;
        agent.description = description;
        agent.total_calls = 0;
        agent.total_earned = 0;
        agent.created_at = Clock::get()?.unix_timestamp;
        agent.bump = ctx.bumps.agent;

        emit!(AgentRegistered {
            owner: agent.owner,
            service,
            price_per_call,
            timestamp: agent.created_at,
        });

        Ok(())
    }

    pub fn update_agent(
        ctx: Context<UpdateAgent>,
        price_per_call: Option<u64>,
        endpoint: Option<String>,
        description: Option<String>,
    ) -> Result<()> {
        let agent = &mut ctx.accounts.agent;

        if let Some(p) = price_per_call {
            require!(p > 0, ErrorCode::PriceMustBePositive);
            agent.price_per_call = p;
        }
        if let Some(e) = endpoint {
            require!(e.len() <= MAX_ENDPOINT_LEN, ErrorCode::EndpointTooLong);
            agent.endpoint = e;
        }
        if let Some(d) = description {
            require!(d.len() <= MAX_DESCRIPTION_LEN, ErrorCode::DescriptionTooLong);
            agent.description = d;
        }

        emit!(AgentUpdated {
            owner: agent.owner,
            service: agent.service.clone(),
        });

        Ok(())
    }

    pub fn deregister_agent(ctx: Context<DeregisterAgent>) -> Result<()> {
        emit!(AgentDeregistered {
            owner: ctx.accounts.agent.owner,
            service: ctx.accounts.agent.service.clone(),
        });
        // El close attribute en el context devuelve los lamports al owner.
        Ok(())
    }

    // ─── Escrow x402 ──────────────────────────────────────────

    pub fn open_escrow(
        ctx: Context<OpenEscrow>,
        nonce: u64,
        amount: u64,
    ) -> Result<()> {
        require!(amount > 0, ErrorCode::AmountMustBePositive);
        // El cliente paga al menos el precio del servicio. Puede pagar más si quiere.
        require!(amount >= ctx.accounts.agent.price_per_call, ErrorCode::AmountBelowPrice);

        let escrow = &mut ctx.accounts.escrow;
        escrow.client = ctx.accounts.client.key();
        escrow.agent_owner = ctx.accounts.agent.owner;
        escrow.service = ctx.accounts.agent.service.clone();
        escrow.amount = amount;
        escrow.nonce = nonce;
        escrow.created_at = Clock::get()?.unix_timestamp;
        escrow.state = EscrowState::Pending;
        escrow.bump = ctx.bumps.escrow;

        // Transferir SOL del cliente al PDA del escrow (additional al rent ya cubierto por init)
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.client.to_account_info(),
                to: escrow.to_account_info(),
            },
        );
        system_program::transfer(cpi_ctx, amount)?;

        emit!(EscrowOpened {
            client: escrow.client,
            agent_owner: escrow.agent_owner,
            service: escrow.service.clone(),
            amount,
            nonce,
            timestamp: escrow.created_at,
        });

        Ok(())
    }

    pub fn claim_payment(ctx: Context<ClaimPayment>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(escrow.state == EscrowState::Pending, ErrorCode::EscrowNotPending);
        require!(
            escrow.agent_owner == ctx.accounts.agent_owner.key(),
            ErrorCode::Unauthorized
        );

        let amount = escrow.amount;
        let nonce = escrow.nonce;
        let client = escrow.client;
        let agent_owner = escrow.agent_owner;

        // Mover lamports del PDA al owner del agente. El PDA puede mutar sus propios lamports.
        **escrow.to_account_info().try_borrow_mut_lamports()? = escrow
            .to_account_info()
            .lamports()
            .checked_sub(amount)
            .ok_or(ErrorCode::InsufficientEscrowBalance)?;
        **ctx
            .accounts
            .agent_owner
            .to_account_info()
            .try_borrow_mut_lamports()? = ctx
            .accounts
            .agent_owner
            .to_account_info()
            .lamports()
            .checked_add(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        escrow.state = EscrowState::Completed;

        let agent = &mut ctx.accounts.agent;
        agent.total_calls = agent.total_calls.checked_add(1).unwrap_or(agent.total_calls);
        agent.total_earned = agent.total_earned.checked_add(amount).unwrap_or(agent.total_earned);

        emit!(PaymentClaimed {
            client,
            agent_owner,
            amount,
            nonce,
            timestamp: Clock::get()?.unix_timestamp,
        });

        Ok(())
    }

    pub fn refund_escrow(ctx: Context<RefundEscrow>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        require!(escrow.state == EscrowState::Pending, ErrorCode::EscrowNotPending);
        require!(escrow.client == ctx.accounts.client.key(), ErrorCode::Unauthorized);

        let now = Clock::get()?.unix_timestamp;
        require!(
            now > escrow.created_at + REFUND_DELAY_SECS,
            ErrorCode::RefundTooEarly
        );

        let amount = escrow.amount;
        let nonce = escrow.nonce;
        let client = escrow.client;

        **escrow.to_account_info().try_borrow_mut_lamports()? = escrow
            .to_account_info()
            .lamports()
            .checked_sub(amount)
            .ok_or(ErrorCode::InsufficientEscrowBalance)?;
        **ctx
            .accounts
            .client
            .to_account_info()
            .try_borrow_mut_lamports()? = ctx
            .accounts
            .client
            .to_account_info()
            .lamports()
            .checked_add(amount)
            .ok_or(ErrorCode::ArithmeticOverflow)?;

        escrow.state = EscrowState::Refunded;

        emit!(EscrowRefunded {
            client,
            nonce,
            timestamp: now,
        });

        Ok(())
    }
}

// ═══════════════════════════════════════════════════════════════
//   Account types
// ═══════════════════════════════════════════════════════════════

#[account]
pub struct Agent {
    pub owner: Pubkey,           // 32
    pub service: String,         // 4 + max 32
    pub price_per_call: u64,     // 8
    pub endpoint: String,        // 4 + max 256
    pub description: String,     // 4 + max 512
    pub total_calls: u64,        // 8
    pub total_earned: u64,       // 8
    pub created_at: i64,         // 8
    pub bump: u8,                // 1
}

impl Agent {
    pub const LEN: usize = 32
        + 4 + MAX_SERVICE_LEN
        + 8
        + 4 + MAX_ENDPOINT_LEN
        + 4 + MAX_DESCRIPTION_LEN
        + 8 + 8 + 8 + 1;
}

#[account]
pub struct Escrow {
    pub client: Pubkey,          // 32
    pub agent_owner: Pubkey,     // 32
    pub service: String,         // 4 + max 32
    pub amount: u64,             // 8
    pub nonce: u64,              // 8
    pub created_at: i64,         // 8
    pub state: EscrowState,      // 1
    pub bump: u8,                // 1
}

impl Escrow {
    pub const LEN: usize = 32 + 32 + 4 + MAX_SERVICE_LEN + 8 + 8 + 8 + 1 + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Debug)]
pub enum EscrowState {
    Pending,
    Completed,
    Refunded,
}

// ═══════════════════════════════════════════════════════════════
//   Account contexts
// ═══════════════════════════════════════════════════════════════

#[derive(Accounts)]
#[instruction(service: String)]
pub struct RegisterAgent<'info> {
    #[account(
        init,
        payer = owner,
        space = 8 + Agent::LEN,
        seeds = [b"agent", service.as_bytes()],
        bump,
    )]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub owner: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct UpdateAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent.service.as_bytes()],
        bump = agent.bump,
        has_one = owner,
    )]
    pub agent: Account<'info, Agent>,

    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct DeregisterAgent<'info> {
    #[account(
        mut,
        seeds = [b"agent", agent.service.as_bytes()],
        bump = agent.bump,
        has_one = owner,
        close = owner,
    )]
    pub agent: Account<'info, Agent>,

    #[account(mut)]
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(nonce: u64, amount: u64)]
pub struct OpenEscrow<'info> {
    pub agent: Account<'info, Agent>,

    #[account(
        init,
        payer = client,
        space = 8 + Escrow::LEN,
        seeds = [
            b"escrow",
            client.key().as_ref(),
            agent.owner.as_ref(),
            &nonce.to_le_bytes(),
        ],
        bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(mut)]
    pub client: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ClaimPayment<'info> {
    #[account(
        mut,
        seeds = [
            b"escrow",
            escrow.client.as_ref(),
            escrow.agent_owner.as_ref(),
            &escrow.nonce.to_le_bytes(),
        ],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    #[account(
        mut,
        seeds = [b"agent", agent.service.as_bytes()],
        bump = agent.bump,
    )]
    pub agent: Account<'info, Agent>,

    /// CHECK: validamos en el handler que `escrow.agent_owner == agent_owner.key()`.
    /// Es Signer porque solo el owner del agente puede claim.
    #[account(mut)]
    pub agent_owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct RefundEscrow<'info> {
    #[account(
        mut,
        seeds = [
            b"escrow",
            escrow.client.as_ref(),
            escrow.agent_owner.as_ref(),
            &escrow.nonce.to_le_bytes(),
        ],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, Escrow>,

    /// CHECK: validamos `escrow.client == client.key()` en el handler.
    #[account(mut)]
    pub client: Signer<'info>,
}

// ═══════════════════════════════════════════════════════════════
//   Events
// ═══════════════════════════════════════════════════════════════

#[event]
pub struct AgentRegistered {
    pub owner: Pubkey,
    pub service: String,
    pub price_per_call: u64,
    pub timestamp: i64,
}

#[event]
pub struct AgentUpdated {
    pub owner: Pubkey,
    pub service: String,
}

#[event]
pub struct AgentDeregistered {
    pub owner: Pubkey,
    pub service: String,
}

#[event]
pub struct EscrowOpened {
    pub client: Pubkey,
    pub agent_owner: Pubkey,
    pub service: String,
    pub amount: u64,
    pub nonce: u64,
    pub timestamp: i64,
}

#[event]
pub struct PaymentClaimed {
    pub client: Pubkey,
    pub agent_owner: Pubkey,
    pub amount: u64,
    pub nonce: u64,
    pub timestamp: i64,
}

#[event]
pub struct EscrowRefunded {
    pub client: Pubkey,
    pub nonce: u64,
    pub timestamp: i64,
}

// ═══════════════════════════════════════════════════════════════
//   Errors
// ═══════════════════════════════════════════════════════════════

#[error_code]
pub enum ErrorCode {
    #[msg("Service name cannot be empty")]
    ServiceEmpty,
    #[msg("Service name exceeds maximum length")]
    ServiceTooLong,
    #[msg("Endpoint exceeds maximum length")]
    EndpointTooLong,
    #[msg("Description exceeds maximum length")]
    DescriptionTooLong,
    #[msg("Price must be positive")]
    PriceMustBePositive,
    #[msg("Amount must be positive")]
    AmountMustBePositive,
    #[msg("Amount is below the agent's price per call")]
    AmountBelowPrice,
    #[msg("Escrow is not in Pending state")]
    EscrowNotPending,
    #[msg("Caller is not authorized for this action")]
    Unauthorized,
    #[msg("Refund window has not yet elapsed")]
    RefundTooEarly,
    #[msg("Insufficient lamports in escrow")]
    InsufficientEscrowBalance,
    #[msg("Arithmetic overflow")]
    ArithmeticOverflow,
}
