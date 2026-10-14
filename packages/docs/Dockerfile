# Sitio de documentación de Kiba (docs.kiba.tools).
# Construye el sitio estático de Docusaurus (es/en/pt) y lo sirve con `serve`,
# igual que hacía la docs anterior en el repo oficial: mismo puerto (4321).
FROM node:22-alpine

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

RUN npm run build

ENV PORT=4321
EXPOSE 4321

# `serve` resuelve URLs sin extensión (/sdk → sdk.html) y usa build/404.html.
CMD ["sh", "-c", "npx serve build -l ${PORT:-4321}"]
