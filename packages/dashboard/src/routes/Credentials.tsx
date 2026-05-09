import { useState, type FormEvent } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { Card, CardBody, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, Tbody, Td, Th, Thead, Tr } from "@/components/ui/table";
import { format } from "date-fns";
import { Trash2, KeyRound, Plug, Copy, Check } from "lucide-react";

export default function Credentials() {
  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-semibold">Credentials</h1>
        <p className="text-sm text-[var(--color-fg-muted)]">
          Manage who can pay agents on your behalf — API keys and OAuth-connected apps.
        </p>
      </div>
      <ApiKeysSection />
      <OAuthSection />
    </div>
  );
}

function ApiKeysSection() {
  const qc = useQueryClient();
  const { data: keys = [], isLoading } = useQuery({
    queryKey: ["api-keys"],
    queryFn: api.apiKeys,
  });
  const [name, setName] = useState("");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const createMut = useMutation({
    mutationFn: (n: string) => api.createApiKey(n),
    onSuccess: (data) => {
      setNewSecret(data.secret);
      setName("");
      qc.invalidateQueries({ queryKey: ["api-keys"] });
    },
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => api.revokeApiKey(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["api-keys"] }),
  });

  const onCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    createMut.mutate(name.trim());
  };

  const copy = () => {
    if (!newSecret) return;
    navigator.clipboard.writeText(newSecret);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <KeyRound className="w-4 h-4" />
          <CardTitle>API Keys</CardTitle>
        </div>
        <CardDescription>
          Long-lived secrets for direct REST API access. Use as <code>Authorization: Bearer ...</code>.
        </CardDescription>
      </CardHeader>
      <CardBody className="space-y-4">
        <form onSubmit={onCreate} className="flex gap-2">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Key name (e.g. production-server)"
          />
          <Button type="submit" disabled={createMut.isPending}>
            {createMut.isPending ? "Creating…" : "Create key"}
          </Button>
        </form>

        {newSecret && (
          <div className="rounded-md border border-[var(--color-success)]/40 bg-[var(--color-success)]/10 p-3">
            <p className="text-xs text-[var(--color-fg-muted)] mb-2">
              Copy this now — it won't be shown again.
            </p>
            <div className="flex items-center gap-2">
              <code className="flex-1 font-mono text-xs px-3 py-2 rounded bg-[var(--color-bg)] border border-[var(--color-border)] break-all">
                {newSecret}
              </code>
              <Button size="sm" variant="subtle" onClick={copy}>
                {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
              </Button>
            </div>
          </div>
        )}

        {isLoading ? (
          <p className="text-sm text-[var(--color-fg-muted)]">Loading…</p>
        ) : keys.length === 0 ? (
          <p className="text-sm text-[var(--color-fg-muted)] text-center py-6">
            No API keys yet. Create one above.
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>Name</Th>
                <Th>Prefix</Th>
                <Th>Created</Th>
                <Th>Last used</Th>
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              {keys.map((k) => (
                <Tr key={k.id}>
                  <Td className="font-medium">{k.name}</Td>
                  <Td className="font-mono text-xs text-[var(--color-fg-muted)]">{k.prefix}…</Td>
                  <Td className="text-xs text-[var(--color-fg-muted)]">
                    {format(new Date(k.created_at * 1000), "MMM d, yyyy")}
                  </Td>
                  <Td className="text-xs text-[var(--color-fg-muted)]">
                    {k.last_used_at
                      ? format(new Date(k.last_used_at * 1000), "MMM d, HH:mm")
                      : "Never"}
                  </Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => revokeMut.mutate(k.id)}
                      disabled={revokeMut.isPending}
                    >
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}

function OAuthSection() {
  const qc = useQueryClient();
  const { data: conns = [], isLoading } = useQuery({
    queryKey: ["oauth-connections"],
    queryFn: api.oauthConnections,
  });
  const revokeMut = useMutation({
    mutationFn: (id: string) => api.revokeOAuth(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["oauth-connections"] }),
  });

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-2">
          <Plug className="w-4 h-4" />
          <CardTitle>Connected apps</CardTitle>
        </div>
        <CardDescription>
          Apps you've authorized via OAuth (Claude Desktop, Cursor, MCP clients). Revoke access at any
          time.
        </CardDescription>
      </CardHeader>
      <CardBody className="p-0">
        {isLoading ? (
          <p className="p-6 text-sm text-[var(--color-fg-muted)]">Loading…</p>
        ) : conns.length === 0 ? (
          <p className="p-10 text-sm text-[var(--color-fg-muted)] text-center">
            No connected apps yet. Install <code>@agent-bazaar/mcp</code> in Claude or Cursor to see
            them here.
          </p>
        ) : (
          <Table>
            <Thead>
              <Tr>
                <Th>App</Th>
                <Th>Scope</Th>
                <Th>Connected</Th>
                <Th>Last used</Th>
                <Th></Th>
              </Tr>
            </Thead>
            <Tbody>
              {conns.map((c) => (
                <Tr key={c.id}>
                  <Td className="font-medium">{c.client_name}</Td>
                  <Td>
                    <Badge tone="info">{c.scope}</Badge>
                  </Td>
                  <Td className="text-xs text-[var(--color-fg-muted)]">
                    {format(new Date(c.created_at * 1000), "MMM d, yyyy")}
                  </Td>
                  <Td className="text-xs text-[var(--color-fg-muted)]">
                    {c.last_used_at
                      ? format(new Date(c.last_used_at * 1000), "MMM d, HH:mm")
                      : "Never"}
                  </Td>
                  <Td className="text-right">
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => revokeMut.mutate(c.id)}
                      disabled={revokeMut.isPending}
                    >
                      Revoke
                    </Button>
                  </Td>
                </Tr>
              ))}
            </Tbody>
          </Table>
        )}
      </CardBody>
    </Card>
  );
}
