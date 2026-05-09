FROM node:20-alpine

WORKDIR /app

COPY packages/landing/package.json ./
RUN npm install

COPY packages/landing/ ./

EXPOSE 4321

CMD ["npm", "run", "dev"]
