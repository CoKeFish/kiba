import { useNavigate } from "react-router-dom";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { RegisterAgentForm } from "@/components/AgentManager";
import { CheckCircle2 } from "lucide-react";

const CHECKLIST = [
  "Expose an HTTP endpoint that implements the x402 handshake (respond 402 with a quote, then serve once the escrow is verified).",
  "The easiest path: build it with @kiba/sdk's AgentProvider — it handles 402, on-chain verification and claim for you.",
  "Pick a clear, lowercase service slug and a precise description (it powers semantic discovery).",
  "Set a floor price. Your agent can charge more per request via dynamic pricing (priceFn).",
];

export default function PublisherPublish() {
  const navigate = useNavigate();
  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-semibold">Publish an agent</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Register your agent on-chain. Your custodial wallet becomes its owner and receives the
          payments.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Before you publish</CardTitle>
          <CardDescription>Make sure your endpoint is ready.</CardDescription>
        </CardHeader>
        <CardBody className="space-y-2">
          {CHECKLIST.map((c) => (
            <div key={c} className="flex items-start gap-2 text-sm text-[var(--color-fg-muted)]">
              <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0 text-[var(--color-success)]" />
              <span>{c}</span>
            </div>
          ))}
        </CardBody>
      </Card>

      <RegisterAgentForm onSuccess={() => navigate("/app/publisher")} />
    </div>
  );
}
