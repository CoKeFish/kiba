import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "@/lib/api";
import { MyAgentsSection } from "@/components/AgentManager";
import { Coins, Info, Zap } from "lucide-react";
import "./publisher.css";

export default function PublisherPricing() {
  const { t } = useTranslation();
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
          <h1 className="pub-title">{t("publisher.pricing.title")}</h1>
          <p className="pub-subtitle">
            {t("publisher.pricing.subtitle")}
          </p>
        </div>
      </header>

      <section className="pub-card">
        <div className="pub-card__head">
          <div>
            <h2 className="pub-card__title">{t("publisher.pricing.how_title")}</h2>
            <p className="pub-card__desc">{t("publisher.pricing.how_desc")}</p>
          </div>
        </div>
        <div className="pub-card__body">
          <div className="pub-benefits">
            <div className="pub-benefit">
              <Zap size={18} className="pub-benefit__icon" />
              <p className="pub-benefit__title">{t("publisher.pricing.benefit_pay_title")}</p>
              <p className="pub-benefit__text">{t("publisher.pricing.benefit_pay_text")}</p>
            </div>
            <div className="pub-benefit">
              <Coins size={18} className="pub-benefit__icon" />
              <p className="pub-benefit__title">{t("publisher.pricing.benefit_keep_title", { netPct })}</p>
              <p className="pub-benefit__text">
                {t("publisher.pricing.benefit_keep_text", { feePct })}
              </p>
            </div>
            <div className="pub-benefit">
              <Info size={18} className="pub-benefit__icon" />
              <p className="pub-benefit__title">{t("publisher.pricing.benefit_run_title")}</p>
              <p className="pub-benefit__text">{t("publisher.pricing.benefit_run_text")}</p>
            </div>
          </div>
        </div>
      </section>

      {isLoading ? (
        <p className="pub-loading">{t("publisher.pricing.loading")}</p>
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
