FROM node:20-alpine

WORKDIR /app

COPY packages/dashboard/package.json ./
RUN npm install

COPY packages/dashboard/ ./

EXPOSE 5173

CMD ["npm", "run", "dev"]
