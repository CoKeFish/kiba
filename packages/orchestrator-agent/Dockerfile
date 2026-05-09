FROM node:20-alpine

WORKDIR /app

# Configs raíz
COPY package.json ./
COPY tsconfig.base.json ./

# Workspace package.json (todos para que npm install resuelva)
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/demo-agents/package.json ./packages/demo-agents/
COPY packages/orchestrator-agent/package.json ./packages/orchestrator-agent/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/mcp-server/package.json ./packages/mcp-server/

RUN npm install

# Source
COPY packages/sdk ./packages/sdk
COPY packages/orchestrator-agent ./packages/orchestrator-agent

WORKDIR /app/packages/orchestrator-agent

EXPOSE 6001

CMD ["npm", "run", "dev"]
