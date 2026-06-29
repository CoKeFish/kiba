/**
 * Typed error classes for @kiba/sdk.
 *
 * Every error the SDK throws on purpose is an instance of {@link KibaError}, so
 * callers can `catch (err) { if (err instanceof KibaError) ... }` and branch on
 * the concrete subclass. Messages are in English and stable enough to match on.
 */

/** Base class for all errors raised by the SDK. */
export class KibaError extends Error {
  constructor(message: string) {
    super(message);
    this.name = new.target.name;
    // Restore prototype chain when compiled down to ES5/CommonJS.
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Invalid or incomplete configuration (missing contractId, empty platform address, …). */
export class ConfigError extends KibaError {}

/** A service could not be found in the registry or discovery backend. */
export class ServiceNotFoundError extends KibaError {
  constructor(public readonly service: string) {
    super(`agent '${service}' not found in registry or discovery backend`);
  }
}

/** The provider rejected a request because payment was missing or insufficient. */
export class PaymentRequiredError extends KibaError {}

/**
 * An on-chain escrow operation failed (open/fund/release/refund), or an escrow
 * presented for verification did not satisfy the binding rules (wrong receiver,
 * already consumed, under-funded). `recoverable` flags cases where funds may be
 * locked and recoverable via the dispute flow.
 */
export class EscrowError extends KibaError {
  recoverable: boolean;
  service?: string;
  escrowId?: string;
  nonce?: string;
  constructor(
    message: string,
    opts: { recoverable?: boolean; service?: string; escrowId?: string; nonce?: string } = {},
  ) {
    super(message);
    this.recoverable = opts.recoverable ?? false;
    this.service = opts.service;
    this.escrowId = opts.escrowId;
    this.nonce = opts.nonce;
  }
}

/**
 * A platform-signed call could not be verified (bad signature, wrong service,
 * tampered payload, expired timestamp, or replayed nonce). Raised by the provider
 * when a request carries platform-auth headers that fail verification.
 */
export class PlatformAuthError extends KibaError {
  constructor(
    message: string,
    public readonly reason:
      | 'missing'
      | 'malformed'
      | 'bad-signature'
      | 'wrong-service'
      | 'payload-mismatch'
      | 'expired'
      | 'replayed'
      | 'not-configured',
  ) {
    super(message);
  }
}

/**
 * A discovered agent's endpoint could not be verified as belonging to the on-chain
 * owner (the live `/manifest` reports a different service or owner). Guards against
 * name-squatting that points a registered service at someone else's endpoint.
 */
export class EndpointVerificationError extends KibaError {
  constructor(
    public readonly service: string,
    detail: string,
  ) {
    super(`endpoint verification failed for '${service}': ${detail}`);
  }
}

/** A call to a remote agent failed (transport error, non-2xx, timeout). */
export class AgentCallError extends KibaError {
  constructor(
    message: string,
    public readonly service?: string,
    public readonly status?: number,
  ) {
    super(message);
  }
}
