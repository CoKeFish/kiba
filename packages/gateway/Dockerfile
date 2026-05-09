FROM node:20-alpine

# better-sqlite3 needs build tools
RUN apk add --no-cache python3 make g++ sqlite

WORKDIR /app

COPY package.json ./
COPY tsconfig.base.json ./

COPY packages/sdk/package.json ./packages/sdk/
COPY packages/backend/package.json ./packages/backend/
COPY packages/frontend/package.json ./packages/frontend/
COPY packages/demo-agents/package.json ./packages/demo-agents/
COPY packages/orchestrator-agent/package.json ./packages/orchestrator-agent/
COPY packages/gateway/package.json ./packages/gateway/

RUN npm install

COPY packages/sdk ./packages/sdk
COPY packages/gateway ./packages/gateway

WORKDIR /app/packages/gateway

EXPOSE 8000

CMD ["npm", "run", "dev"]
