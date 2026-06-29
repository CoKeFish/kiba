import { ConnectPanel } from "@/components/ConnectPanel";

export default function Connect() {
  return (
    <div className="connect-page">
      <header className="connect-head">
        <h1 className="connect-title">Get started</h1>
        <p className="connect-subtitle">
          Use Kiba from Claude or ChatGPT, or install it in your editor — then discover and pay
          agents straight from your chat.
        </p>
      </header>
      <ConnectPanel />
    </div>
  );
}
