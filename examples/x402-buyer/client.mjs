/**
 * Un agente x402 cualquiera (sin Kiba) le paga a un servicio Kiba.
 *
 * Usa los paquetes oficiales del estándar: @x402/fetch negocia el 402 y @x402/stellar firma la
 * autorización USDC con la clave del comprador. El servicio Kiba verifica y liquida vía su
 * facilitador y responde con el resultado y la cabecera PAYMENT-RESPONSE (hash de la tx).
 *
 *   STELLAR_SECRET_KEY=S...  (cuenta con USDC en testnet; no necesita XLM si el facilitador patrocina)
 *   node client.mjs https://agent-world-clock.kiba.tools/service '{"zone":"Tokyo"}'
 */
import 'dotenv/config';
import { wrapFetchWithPaymentFromConfig, decodePaymentResponseHeader } from '@x402/fetch';
import { createEd25519Signer } from '@x402/stellar';
import { ExactStellarScheme } from '@x402/stellar/exact/client';

const NETWORK = process.env.STELLAR_NETWORK || 'stellar:testnet';
const [url = 'http://localhost:5007/service', rawBody = '{"zone":"Tokyo"}'] = process.argv.slice(2);
if (!process.env.STELLAR_SECRET_KEY) throw new Error('falta STELLAR_SECRET_KEY (cuenta con USDC en la red elegida)');

const signer = createEd25519Signer(process.env.STELLAR_SECRET_KEY, NETWORK);
const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
  schemes: [{ network: NETWORK, client: new ExactStellarScheme(signer, process.env.STELLAR_RPC_URL ? { url: process.env.STELLAR_RPC_URL } : undefined) }],
  // El tope por pago lo decide este script (el default del cliente es 1 USD).
  spendControls: { maxAmountPerPayment: process.env.MAX_USD || '1' },
});

console.log(`comprador ${signer.address} → ${url}`);
const t0 = Date.now();
const res = await fetchWithPayment(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: rawBody,
});
const body = await res.json();
console.log(`HTTP ${res.status} en ${Date.now() - t0} ms`);
console.log(JSON.stringify(body, null, 2));
const settled = res.headers.get('payment-response');
if (settled) {
  const s = decodePaymentResponseHeader(settled);
  const seg = s.network === 'stellar:pubnet' ? 'public' : 'testnet';
  console.log(`pago liquidado: ${s.transaction}`);
  console.log(`https://stellar.expert/explorer/${seg}/tx/${s.transaction}`);
} else {
  console.log('sin PAYMENT-RESPONSE: la ruta no cobró o el servicio no liquidó');
}
