/**
 * Firmar con la wallet del usuario lo que el gateway armó, desde cualquier parte del panel.
 *
 * Publicar, cambiar o dar de baja un servicio lo firma el publicador con su wallet. El gateway
 * responde con la transacción por firmar (`prepared`) y la wallet que debe firmarla; aquí se
 * firma y se devuelve lo que espera `api.spendSubmit`.
 *
 *   - Wallet externa (Freighter, xBull…): firma el XDR completo.
 *   - Wallet de Privy: firma el hash. Necesita la sesión de Privy, que vive en un componente
 *     (`PrivySignHost`, en paywallet/PayWallet.tsx) y se registra aquí al montarse.
 */
import i18n from "@/i18n";
import type { PreparedTx } from "@/lib/api";

export type SignedBody = { hash: string; signature: string } | { xdr: string };
export type WalletRef = { address: string; kind: "privy" | "external" };
type PrivySign = (tx: PreparedTx, address: string) => Promise<SignedBody>;

let privySign: PrivySign | null = null;
/** Dirección de la wallet externa ya elegida en esta visita. */
let externalReady: string | null = null;
/** Lo llama PrivySignHost al montarse (y con null al desmontarse). */
export function registerPrivySign(fn: PrivySign | null): void {
  privySign = fn;
}

export async function signPrepared(tx: PreparedTx, wallet: WalletRef): Promise<SignedBody> {
  if (wallet.kind === "external") {
    const { connectStellarWallet, signXdr } = await import("@/lib/stellar-wallet");
    // Si la wallet ya quedó elegida en esta visita, se firma directo. El selector solo se abre la
    // primera vez (o si la firma no encuentra wallet), no en cada transacción.
    if (externalReady === wallet.address) {
      try {
        return { xdr: await signXdr(tx.xdr, wallet.address) };
      } catch (err) {
        // Un rechazo del usuario es un rechazo: no se le vuelve a preguntar.
        if (/reject|declin|denied|cancel/i.test(String((err as Error)?.message ?? err))) throw err;
        externalReady = null;
      }
    }
    const connected = await connectStellarWallet();
    if (connected !== wallet.address) throw new Error(i18n.t("wallet_sign.other_wallet", { address: `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}` }));
    externalReady = connected;
    return { xdr: await signXdr(tx.xdr, wallet.address) };
  }
  // La sesión de Privy se carga aparte: se le da un momento a que esté lista.
  for (let i = 0; i < 80 && !privySign; i++) await new Promise((r) => setTimeout(r, 100));
  if (!privySign) throw new Error(i18n.t("paywallet.err_not_ready"));
  return privySign(tx, wallet.address);
}
