# Landing (kiba.tools): sitio estático de Astro servido con `serve`.
# Instala desde el package-lock.json de la raíz (workspace @kiba/landing), como
# el gateway y los demo-agents, para que el build sea reproducible: con
# `npm install` sin lockfile cada build resolvía versiones nuevas y el
# 2026-10-16 rompió con un bug de npm 10 ("Cannot read properties of null
# (reading 'edgesOut')") sin que cambiara nada en la landing.
FROM node:20-alpine

WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/landing/package.json ./packages/landing/
RUN npm install --workspace=@kiba/landing

COPY packages/landing ./packages/landing
WORKDIR /app/packages/landing

# Las URLs públicas se hornean en el build estático (Astro lee
# import.meta.env.PUBLIC_* en build time); llegan como build args del compose.
ARG PUBLIC_DASHBOARD_URL
ARG PUBLIC_BACKEND_URL
ARG PUBLIC_GATEWAY_URL
ENV PUBLIC_DASHBOARD_URL=$PUBLIC_DASHBOARD_URL \
    PUBLIC_BACKEND_URL=$PUBLIC_BACKEND_URL \
    PUBLIC_GATEWAY_URL=$PUBLIC_GATEWAY_URL

RUN npm run build

EXPOSE 4321

# Sirve el sitio estático con un servidor sin host-check (a diferencia de astro dev/preview).
CMD ["sh", "-c", "npx serve dist -l ${PORT:-4321}"]
