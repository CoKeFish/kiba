import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AuthProvider } from "@/lib/auth";
import { ModeProvider } from "@/lib/mode";
import "./i18n";
import "./styles/globals.css";

// Métricas internas (Umami): el tracker (kb.js) y la grabadora de sesiones (recorder.js) solo se
// inyectan si el build trae el id del sitio (prod). El tracker sigue solo los cambios de ruta del
// SPA (pushState); no usa cookies ni identifica usuarios. La grabación va con todo el texto y los
// campos enmascarados, y lo que lleve data-replay-block (contenido comprado) no se graba.
const umamiWebsiteId = import.meta.env.VITE_UMAMI_WEBSITE_ID;
if (umamiWebsiteId) {
  // ?metrics=off deja este navegador fuera de las métricas y grabaciones; ?metrics=on lo revierte.
  try {
    const metrics = new URLSearchParams(window.location.search).get("metrics");
    if (metrics === "off") localStorage.setItem("umami.disabled", "1");
    else if (metrics === "on") localStorage.removeItem("umami.disabled");
  } catch {
    // Sin localStorage disponible no hay marca que guardar: se mide como cualquier visita.
  }
  for (const file of ["kb.js", "recorder.js"]) {
    const script = document.createElement("script");
    script.defer = true;
    script.src = `https://metrics.kiba.tools/${file}`;
    script.dataset.websiteId = umamiWebsiteId;
    document.head.appendChild(script);
  }
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
