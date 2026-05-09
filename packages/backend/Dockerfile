FROM node:20-slim

# better-sqlite3 necesita build tools nativos; onnxruntime (transformers.js) necesita libs glibc
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Configs raíz
COPY package.json ./
COPY tsconfig.base.json ./

# package.json de cada workspace (resolución de deps)
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/backend/package.json ./packages/backend/
COPY packages/landing/package.json ./packages/landing/
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/demo-agents/package.json ./packages/demo-agents/
COPY packages/orchestrator-agent/package.json ./packages/orchestrator-agent/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/mcp-server/package.json ./packages/mcp-server/

RUN npm install

# Código fuente
COPY packages/sdk ./packages/sdk
COPY packages/backend ./packages/backend

WORKDIR /app/packages/backend

# Carpeta para SQLite y para el cache de modelos de transformers.js
RUN mkdir -p /app/packages/backend/data /app/packages/backend/models
ENV BACKEND_DATA_DIR=/app/packages/backend/data
ENV TRANSFORMERS_CACHE=/app/packages/backend/models

EXPOSE 4000

CMD ["npm", "run", "dev"]
