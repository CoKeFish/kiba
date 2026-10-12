FROM node:22-alpine

WORKDIR /app

COPY packages/docs/package.json packages/docs/package-lock.json ./
RUN npm ci

COPY packages/docs/ ./

RUN npm run build

EXPOSE 4321

# Sirve el sitio estático con un servidor sin host-check (igual que la landing).
CMD ["sh", "-c", "npx serve dist -l ${PORT:-4321}"]
