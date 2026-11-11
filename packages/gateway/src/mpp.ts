/**
 * MPP (Machine Payments Protocol) en Stellar: lo común y el lado comprador.
 *
 * MPP es otro protocolo de pago por HTTP 402, hermano de x402. La API responde 402 con un reto
 * en la cabecera `WWW-Authenticate: Payment ...`; quien llama paga, repite la llamada con la
 * prueba en `Authorization: Payment ...` y recibe el resultado con un recibo en `Payment-Receipt`.
 * En Stellar el pago es una transferencia de USDC directa, sin intermediario.
 *
 * Como comprador (x402.ts lo usa): Kiba reconoce el reto, lee el precio y paga desde la tesorería.
 * El lado vendedor está en mpp-sell.ts.
 */
import { Keypair } from '@stellar/stellar-sdk';
import { Challenge, Receipt } from 'mppx';
import { Mppx as MppxClient } from 'mppx/client';
import { charge as stellarClientCharge } from '@stellar/mpp/charge/client';
import { getUsdcAddress } from '@x402/stellar';
import { getMasterWallet } from './wallets';

/** Red de MPP (CAIP-2), la misma en la que opera el resto del gateway. */
export const MPP_NETWORK: 'stellar:testnet' | 'stellar:pubnet' =
  (process.env.STELLAR_NETWORK || 'testnet').toLowerCase() === 'mainnet' ? 'stellar:pubnet' : 'stellar:testnet';

/** Contrato del USDC en la red activa: la moneda en la que Kiba paga y cobra con MPP. */
export function mppCurrency(): string {
  return getUsdcAddress(MPP_NETWORK);
}

/** Tesorería de Kiba: paga como comprador y cobra como vendedor. */
export function mppTreasury(): Keypair {
  return Keypair.fromRawEd25519Seed(Buffer.from(getMasterWallet().secretKey.slice(0, 32)));
}

/** ¿La respuesta 402 pide el pago con MPP? */
export function isMppChallenge(headers: Headers): boolean {
  return /(^|,)\s*Payment\b/i.test(headers.get('www-authenticate') ?? '');
}

export interface MppQuote {
  /** Precio en unidades base (USDC, 7 decimales). */
  lamports: number;
  payTo: string;
  network: string;
}

/**
 * Lee de un 402 de MPP la opción que Kiba puede pagar: cobro único en Stellar, con USDC, en
 * nuestra red. Lanza con una explicación si la API ofrece otra cosa.
 */
export function readMppQuote(headers: Headers): MppQuote {
  let challenges: ReturnType<typeof Challenge.fromResponseList>;
  try {
    challenges = Challenge.fromResponseList(new Response(null, { status: 402, headers }));
  } catch (err) {
    throw new Error(`la API pide pago con MPP pero su reto no se puede leer: ${(err as Error).message}`);
  }
  const offered = challenges.map((c) => `${c.method}/${c.intent}`);
  for (const c of challenges) {
    if (c.method !== 'stellar' || c.intent !== 'charge') continue;
    const r = c.request as { amount?: string; currency?: string; recipient?: string; methodDetails?: { network?: string } };
    const network = r.methodDetails?.network ?? 'stellar:testnet';
    if (network !== MPP_NETWORK) continue;
    if (r.currency !== mppCurrency()) continue;
    if (!r.amount || !/^\d+$/.test(r.amount) || !r.recipient) continue;
    return { lamports: Number(BigInt(r.amount)), payTo: r.recipient, network };
  }
  throw new Error(
    `la API cobra con MPP pero no acepta USDC en ${MPP_NETWORK} con un cobro por llamada (ofrece: ${Array.from(new Set(offered)).join(', ') || 'nada'})`,
  );
}

type Payer = (challenge402: Response) => Promise<string>;
let payer: Payer | null = null;
/** Tests: sustituye la firma del pago (null = la tesorería, en la red). */
export function setMppPayer(fn: Payer | null): void {
  payer = fn;
}

let client: ReturnType<typeof MppxClient.create> | null = null;
function treasuryClient() {
  // `polyfill: false`: el fetch global del gateway no debe pagar nada por su cuenta.
  return (client ??= MppxClient.create({
    polyfill: false,
    methods: [
      stellarClientCharge({
        keypair: mppTreasury(),
        // La API recibe la transacción firmada y la envía ella: así confirma el pago antes de servir.
        mode: 'pull',
        ...(process.env.STELLAR_RPC_URL ? { rpcUrl: process.env.STELLAR_RPC_URL } : {}),
      }),
    ],
  }));
}

/**
 * Firma con la tesorería el pago que pide un 402 de MPP y devuelve el valor de la cabecera
 * `Authorization` con el que se repite la llamada.
 */
export async function mppAuthorization(headers: Headers): Promise<string> {
  const challenge402 = new Response(null, { status: 402, headers });
  if (payer) return payer(challenge402);
  return treasuryClient().createCredential(challenge402);
}

/** Recibo de una llamada pagada con MPP: la referencia es el hash de la transacción. */
export function readMppReceipt(headers: Headers): { reference: string } | null {
  const raw = headers.get('payment-receipt');
  if (!raw) return null;
  try {
    const r = Receipt.deserialize(raw);
    return r.status === 'success' && r.reference ? { reference: r.reference } : null;
  } catch {
    return null;
  }
}
