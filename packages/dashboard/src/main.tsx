import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "@/lib/auth";
import { ModeProvider } from "@/lib/mode";
import "./i18n";
import "./styles/globals.css";

// Métricas internas (Umami): el tracker solo se inyecta si el build trae el id del sitio (prod).
// Sigue solo los cambios de ruta del SPA (pushState); no usa cookies ni identifica usuarios.
const umamiWebsiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID;
if (umamiWebsiteId) {
  const script = document.createElement("script");
  script.defer = true;
  script.src = "https://metrics.kiba.tools/kb.js";
  script.dataset.websiteId = umamiWebsiteId;
  document.head.appendChild(script);
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <ModeProvider>
            <App />
          </ModeProvider>
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
