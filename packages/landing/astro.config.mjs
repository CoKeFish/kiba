import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
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
