FROM node:20-alpine

WORKDIR /app

# Root configs + lockfile
COPY package.json package-lock.json tsconfig.base.json ./

# Solo los workspaces que el gateway usa (sdk es dep transitiva).
COPY packages/sdk/package.json ./packages/sdk/
COPY packages/gateway/package.json ./packages/gateway/

# Install scopeado al gateway → reduce node_modules y build RAM ~50%
# vs `npm install` plano (que traería todos los 8 workspaces).
RUN npm install --workspace=@kiba/gateway --include-workspace-root

COPY packages/sdk ./packages/sdk
COPY packages/gateway ./packages/gateway

WORKDIR /app/packages/gateway

EXPOSE 8000

CMD ["npm", "run", "dev"]
