FROM node:20-alpine

WORKDIR /app

# Copia configs raíz
COPY package.json ./
COPY tsconfig.base.json ./

# Copia los package.json de cada workspace (para que npm install resuelva deps)
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/demo-agents/package.json ./packages/demo-agents/
COPY packages/orchestrator-agent/package.json ./packages/orchestrator-agent/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/mcp-server/package.json ./packages/mcp-server/

# Instala todo el workspace
RUN npm install

# Copia el código fuente
COPY packages/sdk ./packages/sdk
COPY packages/backend ./packages/backend

WORKDIR /app/packages/backend

EXPOSE 4000

CMD ["npm", "run", "dev"]
