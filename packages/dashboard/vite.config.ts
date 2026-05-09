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
    port: 5173,
    strictPort: true,
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
