import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { MyAgentsSection, RegisterAgentForm } from "@/components/AgentManager";
import { Plus, X } from "lucide-react";

export default function PublisherAgents() {
  const [showRegister, setShowRegister] = useState(false);
  const { data: myAgents, isLoading } = useQuery({
    queryKey: ["my-agents"],
    queryFn: () => api.myAgents(),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">My agents</h1>
          <p className="text-sm text-[var(--color-fg-muted)]">
            Register, edit and retire the agents owned by your custodial wallet.
          </p>
        </div>
        <Button size="sm" onClick={() => setShowRegister((v) => !v)}>
          {showRegister ? <X className="w-3 h-3" /> : <Plus className="w-3 h-3" />}
          {showRegister ? "Cancel" : "Register agent"}
        </Button>
      </div>

      {showRegister && <RegisterAgentForm onSuccess={() => setShowRegister(false)} />}

      {isLoading ? (
        <p className="text-sm text-[var(--color-fg-muted)]">Loading…</p>
      ) : (
        <MyAgentsSection agents={myAgents ?? []} collapsible={false} />
      )}
    </div>
  );
}
