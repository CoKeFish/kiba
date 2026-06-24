FROM node:20-alpine

WORKDIR /app

# Root configs + lockfile
COPY package.json package-lock.json tsconfig.base.json ./

# Solo los workspaces que los agentes usan (sdk = dep transitiva).
# Mismo patrón optimizado que backend/gateway → cut node_modules ~50%.
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/demo-agents/package.json ./packages/demo-agents/

RUN npm install --workspace=@kiba/demo-agents --include-workspace-root

# Código fuente (solo lo que necesitan los agentes en runtime)
COPY packages/sdk ./packages/sdk
COPY packages/demo-agents ./packages/demo-agents

WORKDIR /app/packages/demo-agents

EXPOSE 5001 5002 5003 5004 5005

# AGENT_NAME selecciona qué agente correr: yield-hunter|risk-auditor|translator-pro|price-oracle|code-reviewer
# Si no se pasa, corre todos los 5 con concurrently (modo local docker-compose).
CMD ["sh", "-c", "if [ -n \"$AGENT_NAME\" ]; then npm run dev:${AGENT_NAME%%-*}; else npm run dev; fi"]
