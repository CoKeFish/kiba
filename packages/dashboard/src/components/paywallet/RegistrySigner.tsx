/**
 * Deja lista la firma con la wallet de Privy en las páginas del publicador, donde publicar,
 * cambiar o dar de baja un servicio se firma con la wallet del usuario. Solo carga el SDK de
 * Privy si la wallet vinculada a la cuenta es de Privy; con una externa no hace falta nada.
 */
import { lazy, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";

const PrivySignHost = lazy(() => import("./PayWallet").then((m) => ({ default: m.PrivySignHost })));

export function RegistrySigner() {
  const { user } = useAuth();
  const { data: st } = useQuery({ queryKey: ["spend"], queryFn: api.spend });
  if (!user || !st?.privyAppId || st.kind !== "privy") return null;
  return (
    <Suspense fallback={null}>
      <PrivySignHost appId={st.privyAppId} email={user.email} />
    </Suspense>
  );
}
