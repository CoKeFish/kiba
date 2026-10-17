# Sitio de documentación de Kiba (docs.kiba.tools), Docusaurus 3 (es/en/pt).
# El contexto de build es la raíz del monorepo (ver docker-compose*.yml), por eso
# las rutas apuntan a packages/docs. Sirve el estático con `serve` en el 4321.
FROM node:22-alpine

WORKDIR /app

COPY packages/docs/package.json packages/docs/package-lock.json ./
RUN npm ci

COPY packages/docs/ ./

# Id del sitio en Umami (métricas internas); vacío = sin tracker. Build arg del compose.
ARG UMAMI_WEBSITE_ID
ENV UMAMI_WEBSITE_ID=$UMAMI_WEBSITE_ID

RUN npm run build

ENV PORT=4321
EXPOSE 4321

# `serve` resuelve URLs sin extensión (/sdk → sdk.html) y usa build/404.html.
CMD ["sh", "-c", "npx serve build -l ${PORT:-4321}"]
