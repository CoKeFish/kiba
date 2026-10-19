/**
 * Wallet de pagos: una wallet Stellar dedicada a pagar en Kiba, controlada por el usuario.
 *
 * - Con Privy (por defecto): el usuario entra con su correo (código de Privy) y se le crea una
 *   wallet Stellar cuyo dueño es él. Kiba NO puede firmar con ella.
 * - Con una wallet externa (Freighter, xBull, Lobstr… vía Stellar Wallets Kit) para quien prefiera.
 *
 * Al activarla firma una sola vez un permiso de gasto sin tope (el límite es lo que deposite): el
 * agente gasta sin pedir firma por transacción. Recargar = enviarle USDC; retirar = lo firma él.
 * Kiba crea la cuenta y paga las comisiones: el usuario no necesita XLM.
 *
 * Todas las transacciones las arma el gateway; aquí solo se firman (hash con Privy, XDR completo
 * con wallets externas). Este módulo carga el SDK de Privy: se importa con lazy() desde Billing.
 */
import { useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PrivyProvider, useLogin, usePrivy, useLogout } from "@privy-io/react-auth";
import { useCreateWallet, useSignRawHash } from "@privy-io/react-auth/extended-chains";
import { api, type PreparedTx, type SpendStatus } from "@/lib/api";
import { PayWalletBody, type PayWalletSigner } from "./PayWalletBody";

type SubmitBody = { hash: string; signature: string } | { xdr: string };

export default function PayWallet({ email }: { email: string }) {
  const { data: st } = useQuery({ queryKey: ["spend"], queryFn: api.spend, refetchInterval: 15_000 });
  if (!st) return null;
  if (!st.privyAppId) return <PayWalletBody st={st} privy={null} external={externalSigner} />;
  return (
    <PrivyProvider
      appId={st.privyAppId}
      config={{
        loginMethods: ["email"],
        appearance: { theme: "light", accentColor: "#4f9cc4" },
        embeddedWallets: { showWalletUIs: false },
      }}
    >
      <WithPrivy st={st} email={email} />
    </PrivyProvider>
  );
}

/** Firmante de wallets externas: conecta la wallet y firma el XDR completo. */
const externalSigner: PayWalletSigner = {
  kind: "external",
  async address() {
    const { connectStellarWallet } = await import("@/lib/stellar-wallet");
    return connectStellarWallet();
  },
  async sign(tx: PreparedTx, address: string): Promise<SubmitBody> {
    const { signXdr } = await import("@/lib/stellar-wallet");
    return { xdr: await signXdr(tx.xdr, address) };
  },
};

function WithPrivy({ st, email }: { st: SpendStatus; email: string }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { ready, authenticated, user } = usePrivy();
  const { logout } = useLogout();
  const { createWallet } = useCreateWallet();
  const { signRawHash } = useSignRawHash();
  // El modal de Privy avisa por callback: lo convertimos en una promesa para poder esperar el login.
  const pending = useRef<{ resolve: () => void; reject: (e: Error) => void } | null>(null);
  const { login } = useLogin({
    onComplete: () => {
      pending.current?.resolve();
      pending.current = null;
    },
    onError: (err) => {
      // Cerrar el modal no es un error: el usuario simplemente se arrepintió.
      const e =
        String(err) === "exited_auth_flow"
          ? Object.assign(new Error("cancelled"), { name: "Cancelled" })
          : new Error(t("paywallet.err_login", { code: String(err) }));
      pending.current?.reject(e);
      pending.current = null;
    },
  });
  // Las funciones de firma son asíncronas y sobreviven a varios renders (el login ocurre en medio):
  // leen el estado actual de Privy por ref, no el capturado al crearse. Incluye las funciones de
  // Privy: `signRawHash` queda atada al `user` del render en que se creó, y la de antes del login
  // lanza "User must be authenticated before signing" aunque la sesión ya exista.
  const live = useRef({ ready, authenticated, user, signRawHash, createWallet });
  live.current = { ready, authenticated, user, signRawHash, createWallet };

  const ensureSession = useCallback(async () => {
    if (!live.current.ready) throw new Error(t("paywallet.err_not_ready"));
    if (!live.current.authenticated) {
      await new Promise<void>((resolve, reject) => {
        pending.current = { resolve, reject };
        login({ loginMethods: ["email"], prefill: { type: "email", value: email } });
      });
    }
    // El usuario de Privy llega en el render siguiente al login.
    for (let i = 0; i < 50 && !live.current.user; i++) await new Promise((r) => setTimeout(r, 100));
    if (!live.current.user) throw new Error(t("paywallet.err_not_ready"));
  }, [login, email, t]);

  const stellarWallet = (): string | null => {
    const w = live.current.user?.linkedAccounts.find(
      (a) => a.type === "wallet" && "chainType" in a && a.chainType === "stellar",
    ) as { address: string } | undefined;
    return w?.address ?? null;
  };

  const privySigner: PayWalletSigner = {
    kind: "privy",
    async address() {
      await ensureSession();
      const existing = stellarWallet();
      if (existing) return existing;
      const { wallet } = await live.current.createWallet({ chainType: "stellar" });
      return wallet.address;
    },
    async sign(tx: PreparedTx, address: string): Promise<SubmitBody> {
      await ensureSession();
      // Recién creada, la wallet tarda un render en aparecer en el usuario de Privy.
      for (let i = 0; i < 50 && stellarWallet() !== address; i++) await new Promise((r) => setTimeout(r, 100));
      if (stellarWallet() !== address) throw new Error(t("paywallet.err_other_privy"));
      const { signature } = await live.current.signRawHash({ address, chainType: "stellar", hash: `0x${tx.hash}` });
      return { hash: tx.hash, signature };
    },
  };

  return (
    <PayWalletBody
      st={st}
      privy={privySigner}
      external={externalSigner}
      privySession={
        authenticated
          ? {
              logout: async () => {
                await logout();
                qc.invalidateQueries({ queryKey: ["spend"] });
              },
            }
          : null
      }
    />
  );
}
