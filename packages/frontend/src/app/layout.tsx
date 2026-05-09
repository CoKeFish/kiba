import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Agent Bazaar',
  description: 'Marketplace descentralizado de agentes IA en Solana',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className="bg-bg text-white min-h-screen">{children}</body>
    </html>
  );
}
