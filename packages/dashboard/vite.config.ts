// Deploy: Vercel (proyecto kiba-dashboard) vía GitHub Actions. Ver docs/DEPLOYMENT.md.
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: "0.0.0.0",
    port: Number(process.env.PORT) || 5173,
    strictPort: true,
    // Permite que el dev server responda tras el dominio público de Railway
    // (Vite 6 bloquea hosts desconocidos por defecto).
    allowedHosts: true,
    watch: {
      usePolling: true,
    },
    proxy: {
      "/api": {
        target: process.env.VITE_GATEWAY_URL || "http://gateway:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
      "/backend": {
        target: process.env.VITE_BACKEND_URL || "http://backend:4000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/backend/, ""),
      },
      "/ws": {
        target: process.env.VITE_BACKEND_URL || "http://backend:4000",
        ws: true,
        changeOrigin: true,
      },
    },
  },
});
