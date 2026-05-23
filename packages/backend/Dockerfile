FROM node:20-slim

# better-sqlite3 necesita build tools nativos; onnxruntime (transformers.js) necesita libs glibc
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Root configs + lockfile (para install determinista)
COPY package.json package-lock.json tsconfig.base.json ./

# Solo los workspaces que el backend usa. sdk es dep transitiva del backend
# (a través de @agent-bazaar/sdk). No copiamos los otros 6 workspaces
# (landing, dashboard, demo-agents, orchestrator-agent, gateway, mcp-server)
# → npm no enumera sus deps → ni Astro, ni Vite, ni framer-motion, ni
# react-router, etc. terminan en node_modules.
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/backend/package.json ./packages/backend/

# Install scopeado al backend (incluye sdk transitivamente y root deps).
# Reduce node_modules ~50% y RAM de build ~50% vs `npm install` plano.
RUN npm install --workspace=@agent-bazaar/backend --include-workspace-root

# Código fuente (solo lo que necesita el backend en runtime)
COPY packages/sdk ./packages/sdk
COPY packages/backend ./packages/backend

WORKDIR /app/packages/backend

# Carpeta para SQLite y para el cache de modelos de transformers.js
RUN mkdir -p /app/packages/backend/data /app/packages/backend/models
ENV BACKEND_DATA_DIR=/app/packages/backend/data
ENV TRANSFORMERS_CACHE=/app/packages/backend/models

EXPOSE 4000

CMD ["npm", "run", "dev"]
