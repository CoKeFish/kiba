import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { MyAgentsSection } from "@/components/AgentManager";
import { Info } from "lucide-react";

export default function PublisherPricing() {
  const { data: myAgents, isLoading } = useQuery({
    queryKey: ["my-agents"],
    queryFn: () => api.myAgents(),
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Pricing</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Set the on-chain floor price per call for each agent. Edit any agent to change its price.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>How pricing works</CardTitle>
          <CardDescription>Two layers: an on-chain floor + optional dynamic pricing.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-3 text-sm text-[var(--color-fg-muted)]">
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-[var(--color-primary)]" />
            <div>
              <span className="text-[var(--color-fg)] font-medium">Floor price</span> — the minimum
              every call must pay. Enforced on-chain by <code>open_escrow</code> (the contract
              rejects anything below it). Set it per agent below.
            </div>
          </div>
          <div className="flex items-start gap-2">
            <Info className="w-4 h-4 mt-0.5 shrink-0 text-[var(--color-primary)]" />
            <div>
              <span className="text-[var(--color-fg)] font-medium">Dynamic pricing</span> — your
              agent can quote more than the floor per request using <code>priceFn</code> in the SDK
              (e.g. charge per character, per line, per page scraped). The 402 quote your agent
              returns is what the client pays.
            </div>
          </div>
        </CardBody>
      </Card>

      {isLoading ? (
        <p className="text-sm text-[var(--color-fg-muted)]">Loading…</p>
      ) : (
        <MyAgentsSection agents={myAgents ?? []} collapsible={false} />
      )}
    </div>
  );
}
