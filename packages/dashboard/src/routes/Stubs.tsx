import { Card, CardBody, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Construction } from "lucide-react";

function Stub({ title, description }: { title: string; description: string }) {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">{title}</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">{description}</p>
      </div>
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Construction className="w-4 h-4" />
            <CardTitle>Coming soon</CardTitle>
          </div>
          <CardDescription>This page is on the roadmap. Track progress on GitHub.</CardDescription>
        </CardHeader>
        <CardBody>
          <p className="text-sm text-[var(--color-fg-muted)]">
            For the demo, focus on Overview, Transactions and Credentials. The other tabs are scaffolded
            to validate the navigation pattern.
          </p>
        </CardBody>
      </Card>
    </div>
  );
}

export const Usage = () => (
  <Stub
    title="Usage"
    description="Spend over time, breakdown by agent, by channel, average cost per call."
  />
);

export const Agents = () => (
  <Stub
    title="Agents"
    description="Browse the catalog. Build an allowlist or blocklist. Set per-agent spending caps."
  />
);

export const Billing = () => (
  <Stub
    title="Billing"
    description="Top up credits, manage payment methods, view invoices, set spending limits."
  />
);

export const Settings = () => (
  <Stub
    title="Settings"
    description="Profile, password, notifications, webhooks, team members, data export."
  />
);
