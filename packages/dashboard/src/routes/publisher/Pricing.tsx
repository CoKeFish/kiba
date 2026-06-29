import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { MyAgentsSection } from "@/components/AgentManager";
import { Coins, Info, Zap } from "lucide-react";
import "./publisher.css";

export default function PublisherPricing() {
  const { data: myAgents, isLoading } = useQuery({
    queryKey: ["my-agents"],
    queryFn: () => api.myAgents(),
  });

  const { data: overview } = useQuery({
    queryKey: ["publisher-overview"],
    queryFn: api.publisherOverview,
  });

  const feePct = overview?.fee.pct ?? 5;
  const netPct = 100 - feePct;

  return (
    <div className="pub-page">
      <header className="pub-head">
        <div className="pub-head__copy">
          <h1 className="pub-title">Pricing</h1>
          <p className="pub-subtitle">
            Set a price per call for each agent. Users only pay when your agent runs.
          </p>
        </div>
      </header>

      <section className="pub-card">
        <div className="pub-card__head">
          <div>
            <h2 className="pub-card__title">How pricing works</h2>
            <p className="pub-card__desc">Simple pay-per-call — no subscriptions or hidden fees.</p>
          </div>
        </div>
        <div className="pub-card__body">
          <div className="pub-benefits">
            <div className="pub-benefit">
              <Zap size={18} className="pub-benefit__icon" />
              <p className="pub-benefit__title">Pay per call</p>
              <p className="pub-benefit__text">Each agent invocation is a single micropayment via x402.</p>
            </div>
            <div className="pub-benefit">
              <Coins size={18} className="pub-benefit__icon" />
              <p className="pub-benefit__title">You keep {netPct}%</p>
              <p className="pub-benefit__text">
                Kiba takes a {feePct}% platform fee; the rest lands in your wallet instantly.
              </p>
            </div>
            <div className="pub-benefit">
              <Info size={18} className="pub-benefit__icon" />
              <p className="pub-benefit__title">User pays on run</p>
              <p className="pub-benefit__text">Consumers are charged only when your agent successfully runs.</p>
            </div>
          </div>
        </div>
      </section>

      {isLoading ? (
        <p className="pub-loading">Loading agents…</p>
      ) : (
        <MyAgentsSection
          agents={myAgents ?? []}
          collapsible={false}
          layout="list"
          emptyMascot="/agents/triangulo.png"
        />
      )}
    </div>
  );
}
