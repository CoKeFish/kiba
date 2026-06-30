/**
 * Recarga de la wallet Privy (invisible) del usuario vía Stellar Wallets Kit.
 *
 * El usuario conecta una wallet EXTERNA que sí controla (Freighter, xBull, Albedo, Lobstr…)
 * y envía USDC directo a SU dirección Privy. Como es su propia dirección, NO hace falta memo,
 * QR ni verificación por backend: el USDC cae en la dirección y el saldo on-chain
 * (`/v1/balance` → wallet_usd) sube porque se relee de Horizon.
 */
import { Asset, BASE_FEE, Horizon, Operation, TransactionBuilder } from "@stellar/stellar-sdk";
import { Networks, StellarWalletsKit } from "@creit.tech/stellar-wallets-kit";
import { defaultModules } from "@creit.tech/stellar-wallets-kit/modules/utils";
import { chain } from "./chain";

let initialized = false;

/** Inicializa el kit una sola vez (modal + módulos de wallets, red activa). */
function ensureKit(): void {
  if (initialized) return;
  const network =
    chain.networkPassphrase === Networks.PUBLIC ? Networks.PUBLIC : Networks.TESTNET;
  StellarWalletsKit.init({ modules: defaultModules(), network });
  initialized = true;
}

/** Abre el modal de selección de wallet y devuelve la dirección conectada (G...). */
export async function connectStellarWallet(): Promise<string> {
  ensureKit();
  const { address } = await StellarWalletsKit.authModal();
  return address;
}

export interface SendUsdcArgs {
  /** Wallet externa que paga (la conectada con el kit). */
  source: string;
  /** Dirección Privy del usuario que recibe el USDC. */
  destination: string;
  /** Monto en USDC (token, no unidades base). */
  amount: number;
}

/**
 * Arma un pago USDC `source` → `destination`, lo firma con la wallet conectada y lo envía a
 * Horizon. Devuelve el hash de la transacción.
 */
export async function sendUsdc({ source, destination, amount }: SendUsdcArgs): Promise<string> {
  ensureKit();
  const server = new Horizon.Server(chain.horizonUrl);

  let account;
  try {
    account = await server.loadAccount(source);
  } catch (e) {
    throw new Error(friendlyError(e, "No se pudo cargar tu wallet externa."));
  }

  const asset = new Asset(chain.usdcCode, chain.usdcIssuer);
  const tx = new TransactionBuilder(account, {
    fee: BASE_FEE,
    networkPassphrase: chain.networkPassphrase,
  })
    .addOperation(Operation.payment({ destination, asset, amount: amount.toFixed(7) }))
    .setTimeout(180)
    .build();

  const { signedTxXdr } = await StellarWalletsKit.signTransaction(tx.toXDR(), {
    networkPassphrase: chain.networkPassphrase,
    address: source,
  });

  const signed = TransactionBuilder.fromXDR(signedTxXdr, chain.networkPassphrase);
  try {
    const res = await server.submitTransaction(signed);
    return res.hash;
  } catch (e) {
    throw new Error(friendlyError(e, "No se pudo enviar la transacción."));
  }
}

/** Traduce errores de Horizon/SDK a mensajes claros para el usuario. */
function friendlyError(e: unknown, fallback: string): string {
  const err = e as {
    name?: string;
    message?: string;
    response?: {
      status?: number;
      data?: { extras?: { result_codes?: { transaction?: string; operations?: string[] } } };
    };
  };
  const status = err?.response?.status;
  const codes = err?.response?.data?.extras?.result_codes;
  const ops = codes?.operations ?? [];

  if (err?.name === "NotFoundError" || status === 404)
    return "Tu wallet externa no está activada en la red (necesita un poco de XLM).";
  if (ops.includes("op_no_trust"))
    return "Tu wallet de Kiba aún no tiene línea de confianza (trustline) de USDC. Haz una llamada a un agente primero o contáctanos.";
  if (ops.includes("op_underfunded"))
    return "Saldo USDC insuficiente en tu wallet externa.";
  if (ops.includes("op_line_full"))
    return "Tu wallet de Kiba no puede recibir más USDC (línea de confianza llena).";
  if (codes?.transaction === "tx_insufficient_balance")
    return "Tu wallet externa no tiene XLM suficiente para la comisión de red.";
  return err?.message || fallback;
}
