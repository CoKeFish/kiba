FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --no-audit --no-fund
COPY server.mjs setup.mjs ./
EXPOSE 3001
CMD ["node", "server.mjs"]
