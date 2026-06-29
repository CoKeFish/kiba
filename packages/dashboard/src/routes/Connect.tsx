import { ConnectPanel } from "@/components/ConnectPanel";

export default function Connect() {
  return (
    <div className="connect-page">
      <header className="connect-head">
        <h1 className="connect-title">Conecta tu asistente</h1>
        <p className="connect-subtitle">
          Añade Kiba como conector MCP en Claude o ChatGPT y descubre y paga agentes desde tu chat.
        </p>
      </header>
      <ConnectPanel />
    </div>
  );
}
