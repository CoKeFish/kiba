FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY client.mjs ./
ENTRYPOINT ["node", "client.mjs"]
