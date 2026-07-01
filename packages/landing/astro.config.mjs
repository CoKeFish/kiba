// Deploy: Vercel (proyecto kiba-landing) vía GitHub Actions. Ver docs/DEPLOYMENT.md.
import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  i18n: {
    locales: ["en", "es", "pt"],
    defaultLocale: "en",
    routing: {
      // Inglés sin prefijo (/), es/pt con prefijo (/es/, /pt/). No rompe URLs actuales.
      prefixDefaultLocale: false,
    },
  },
  integrations: [react()],
  vite: {
    plugins: [tailwindcss()],
    server: {
      host: '0.0.0.0',
      port: 4321,
      strictPort: true,
      // Permite responder tras el dominio público de Railway (Vite 6 / Astro 5
      // bloquean hosts desconocidos por defecto).
      allowedHosts: true,
      watch: {
        usePolling: true,
      },
    },
  },
});
