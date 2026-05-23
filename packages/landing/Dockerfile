FROM node:20-alpine

WORKDIR /app

COPY packages/landing/package.json ./
RUN npm install

COPY packages/landing/ ./

# Las URLs públicas se hornean en el build estático (Astro lee
# import.meta.env.PUBLIC_* en build time). Railway expone las variables de
# servicio como build args — hay que declararlas con ARG para consumirlas.
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
