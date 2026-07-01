import { useTranslation } from "react-i18next";
import { ConnectPanel } from "@/components/ConnectPanel";

export default function Connect() {
  const { t } = useTranslation();
  return (
    <div className="connect-page">
      <header className="connect-head">
        <h1 className="connect-title">{t("connect.title")}</h1>
        <p className="connect-subtitle">{t("connect.subtitle")}</p>
      </header>
      <ConnectPanel />
    </div>
  );
}
