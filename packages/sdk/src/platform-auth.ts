/**
 * Asymmetric platform-auth — how the marketplace platform proves a paid call to an
 * agent WITHOUT sharing any secret.
 *
 * The platform holds an ed25519 PRIVATE key it never discloses. Every external
 * agent is configured with the platform's PUBLIC key (a Stellar `G...` address —
 * safe to publish, useless for forging). For each call the platform mints a short
 * "call certificate" and signs it; the agent verifies the signature against the
 * published public key.
 *
 *   cert = { v, service, payloadHash, ts, nonce, exp, iss }
 *   signature = ed25519_sign(platformPrivateKey, utf8(JSON(cert)))
 *
 * Transmitted as two headers:
 *   X-Platform-Cert       = base64( utf8(JSON(cert)) )
 *   X-Platform-Signature  = base64( signature )
 *
 * The agent verifies, in order: signature over the exact transmitted cert bytes →
 * issuer matches its configured key → service matches → payloadHash matches the
 * received body → not expired (ts/exp window) → nonce not seen before (replay).
 *
 * Why this is better than a shared secret: the value an agent holds (public key)
 * cannot mint calls, so a leak of any single agent's config can never impersonate
 * the platform to other agents. Only the holder of the private key can produce a
 * valid certificate.
 */
import { createHash } from 'node:crypto';
import { Keypair } from '@stellar/stellar-sdk';
import { PlatformAuthError } from './errors';

export const PLATFORM_CERT_HEADER = 'X-Platform-Cert';
export const PLATFORM_SIGNATURE_HEADER = 'X-Platform-Signature';

/** Default lifetime of a call certificate, in seconds. */
export const DEFAULT_CERT_TTL_SEC = 60;
/** Default tolerance for clock skew between platform and agent, in seconds. */
export const DEFAULT_MAX_CLOCK_SKEW_SEC = 120;

export interface PlatformCallCert {
  /** Schema version. */
  v: 1;
  /** Service the call is authorized for; must match the agent's own service. */
  service: string;
  /** Lowercase hex sha256 of the request body bytes — binds the cert to this payload. */
  payloadHash: string;
  /** Issued-at, unix seconds. */
  ts: number;
  /** Unique per call; the agent rejects a repeat within the validity window. */
  nonce: string;
  /** Expiry, unix seconds. */
  exp: number;
  /** Issuer public key (Stellar G... strkey). The agent rejects a mismatch with its configured key. */
  iss: string;
}

/**
 * Signs call certificates. The private key never leaves this object. `sign` may be
 * async so remote signers (e.g. a KMS/TEE) can implement it.
 */
export interface PlatformCallSigner {
  /** Issuer public key, Stellar G... strkey. */
  publicKey(): string;
  /** Raw ed25519 signature over `message`. */
  sign(message: Uint8Array): Uint8Array | Promise<Uint8Array>;
}

/** Platform signer backed by an in-process Stellar keypair. */
export class LocalPlatformSigner implements PlatformCallSigner {
  constructor(private readonly keypair: Keypair) {}

  /** Build from a Stellar secret (S...). */
  static fromSecret(secret: string): LocalPlatformSigner {
    return new LocalPlatformSigner(Keypair.fromSecret(secret));
  }

  publicKey(): string {
    return this.keypair.publicKey();
  }

  sign(message: Uint8Array): Uint8Array {
    return this.keypair.sign(Buffer.from(message));
  }
}

/** sha256 (lowercase hex) of arbitrary body content. Objects are JSON-serialized first. */
export function hashBody(body: Uint8Array | string | object): string {
  const bytes = toBytes(body);
  return createHash('sha256').update(bytes).digest('hex');
}

function toBytes(body: Uint8Array | string | object): Buffer {
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (typeof body === 'string') return Buffer.from(body, 'utf8');
  return Buffer.from(JSON.stringify(body ?? null), 'utf8');
}

/**
 * Mint the headers for a platform-signed call. Returns the two headers plus the
 * exact body string that was hashed — send THAT string as the request body so the
 * agent hashes identical bytes.
 */
export async function buildPlatformCallHeaders(args: {
  signer: PlatformCallSigner;
  service: string;
  /** Request payload. Serialized once; the returned `body` is what you must send. */
  payload: unknown;
  /** Certificate lifetime in seconds (default 60). */
  ttlSec?: number;
  /** Override the nonce (default: a unique random value). */
  nonce?: string;
  /** Override issued-at (unix seconds); for testing. */
  now?: number;
}): Promise<{ headers: Record<string, string>; body: string; cert: PlatformCallCert }> {
  const body = JSON.stringify(args.payload ?? null);
  const ts = args.now ?? Math.floor(Date.now() / 1000);
  const cert: PlatformCallCert = {
    v: 1,
    service: args.service,
    payloadHash: hashBody(body),
    ts,
    nonce: args.nonce ?? randomNonce(),
    exp: ts + (args.ttlSec ?? DEFAULT_CERT_TTL_SEC),
    iss: args.signer.publicKey(),
  };
  const certBytes = Buffer.from(JSON.stringify(cert), 'utf8');
  const sig = await args.signer.sign(certBytes);
  return {
    headers: {
      [PLATFORM_CERT_HEADER]: certBytes.toString('base64'),
      [PLATFORM_SIGNATURE_HEADER]: Buffer.from(sig).toString('base64'),
    },
    body,
    cert,
  };
}

/**
 * Tracks recently-seen nonces to block replays. Bounded by certificate expiry:
 * entries are pruned once past their `exp`, so memory stays proportional to the
 * number of in-flight (unexpired) certificates. Single-process only — for a
 * multi-instance agent, back this with a shared store (Redis, etc.).
 */
export class ReplayGuard {
  private readonly seen = new Map<string, number>();

  /**
   * Returns true the first time a nonce is seen (and records it until `exp`),
   * false if it was already seen within its validity window.
   */
  check(nonce: string, exp: number, now: number = Math.floor(Date.now() / 1000)): boolean {
    this.prune(now);
    if (this.seen.has(nonce)) return false;
    this.seen.set(nonce, exp);
    return true;
  }

  private prune(now: number): void {
    for (const [nonce, exp] of this.seen) {
      if (exp <= now) this.seen.delete(nonce);
    }
  }

  /** Current number of tracked nonces (for diagnostics/tests). */
  get size(): number {
    return this.seen.size;
  }
}

export interface VerifyPlatformCallOptions {
  /** The platform public key this agent trusts (Stellar G... strkey). */
  publicKey: string;
  /** Header bag from the incoming request (case-insensitive lookups handled). */
  headers: Record<string, string | string[] | undefined>;
  /** Raw request body bytes (or the parsed object, hashed identically to the signer). */
  body: Uint8Array | string | object;
  /** The service this agent serves; the cert must match it. */
  expectedService: string;
  /** Replay guard instance (typically one per provider). */
  replayGuard: ReplayGuard;
  /** Clock-skew tolerance in seconds (default 120). */
  maxClockSkewSec?: number;
  /** Override current time (unix seconds); for testing. */
  now?: number;
}

export type VerifyResult =
  | { ok: true; cert: PlatformCallCert }
  | { ok: false; error: PlatformAuthError };

/**
 * Verify a platform-signed call. Returns `{ ok: true, cert }` on success or
 * `{ ok: false, error }` with a typed {@link PlatformAuthError} describing the
 * first failed check. Does not throw.
 */
export function verifyPlatformCall(opts: VerifyPlatformCallOptions): VerifyResult {
  const certB64 = headerValue(opts.headers, PLATFORM_CERT_HEADER);
  const sigB64 = headerValue(opts.headers, PLATFORM_SIGNATURE_HEADER);
  if (!certB64 || !sigB64) {
    return fail('missing platform-auth headers', 'missing');
  }

  let certBytes: Buffer;
  let cert: PlatformCallCert;
  try {
    certBytes = Buffer.from(certB64, 'base64');
    cert = JSON.parse(certBytes.toString('utf8')) as PlatformCallCert;
  } catch {
    return fail('malformed platform certificate', 'malformed');
  }
  if (cert?.v !== 1 || typeof cert.nonce !== 'string' || typeof cert.payloadHash !== 'string') {
    return fail('unsupported or malformed platform certificate', 'malformed');
  }

  // Issuer must match the configured key (also guards against verifying with the
  // wrong key in multi-key setups).
  if (cert.iss !== opts.publicKey) {
    return fail('certificate issuer does not match configured platform key', 'bad-signature');
  }

  // Signature over the EXACT transmitted cert bytes (no re-serialization).
  let sigOk = false;
  try {
    sigOk = Keypair.fromPublicKey(opts.publicKey).verify(certBytes, Buffer.from(sigB64, 'base64'));
  } catch {
    sigOk = false;
  }
  if (!sigOk) return fail('invalid platform signature', 'bad-signature');

  if (cert.service !== opts.expectedService) {
    return fail(`certificate is for service '${cert.service}', not '${opts.expectedService}'`, 'wrong-service');
  }

  if (cert.payloadHash !== hashBody(opts.body)) {
    return fail('payload does not match the signed certificate', 'payload-mismatch');
  }

  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const skew = opts.maxClockSkewSec ?? DEFAULT_MAX_CLOCK_SKEW_SEC;
  if (cert.ts > now + skew) return fail('certificate timestamp is in the future', 'expired');
  if (cert.exp < now - skew) return fail('certificate has expired', 'expired');

  if (!opts.replayGuard.check(cert.nonce, cert.exp, now)) {
    return fail('certificate nonce already used (replay)', 'replayed');
  }

  return { ok: true, cert };
}

function fail(message: string, reason: PlatformAuthError['reason']): VerifyResult {
  return { ok: false, error: new PlatformAuthError(message, reason) };
}

function headerValue(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const lower = name.toLowerCase();
  for (const key of Object.keys(headers)) {
    if (key.toLowerCase() === lower) {
      const v = headers[key];
      return Array.isArray(v) ? v[0] : v;
    }
  }
  return undefined;
}

function randomNonce(): string {
  // 16 random bytes hex. Math.random is fine here: nonces only need to be unique
  // per platform within a cert lifetime, not cryptographically unpredictable (the
  // signature provides authenticity).
  let s = '';
  for (let i = 0; i < 4; i++) s += Math.floor(Math.random() * 0x100000000).toString(16).padStart(8, '0');
  return s;
}
