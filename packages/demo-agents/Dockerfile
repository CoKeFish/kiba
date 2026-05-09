FROM node:20-alpine

WORKDIR /app

# Configs raíz
COPY package.json ./
COPY tsconfig.base.json ./

# Workspace package.json
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/backend/package.json ./packages/backend/
COPY packages/landing/package.json ./packages/landing/
COPY packages/dashboard/package.json ./packages/dashboard/
COPY packages/demo-agents/package.json ./packages/demo-agents/
COPY packages/orchestrator-agent/package.json ./packages/orchestrator-agent/
COPY packages/gateway/package.json ./packages/gateway/
COPY packages/mcp-server/package.json ./packages/mcp-server/

RUN npm install

# Source
COPY packages/sdk ./packages/sdk
COPY packages/demo-agents ./packages/demo-agents

WORKDIR /app/packages/demo-agents

EXPOSE 5001 5002 5003 5004 5005

CMD ["npm", "run", "dev"]
