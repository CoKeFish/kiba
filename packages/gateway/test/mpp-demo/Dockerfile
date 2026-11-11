# Demo oficial de MPP en Stellar (github.com/stellar/stellar-mpp-sdk), para correr contra él la
# prueba E2E de Kiba (test/e2e-mpp.mts). Trae el servidor y el cliente de ejemplo de ese
# repositorio, en la misma versión del paquete que usa el gateway.
#
#   docker build -t kiba-mpp-demo packages/gateway/test/mpp-demo
#   docker run --rm -e STELLAR_RECIPIENT=G... -p 3000:3000 kiba-mpp-demo        # vendedor: 0,01 USDC por petición
#   docker run --rm -e STELLAR_SECRET=S... -e SERVER_URL=https://<gateway>/mpp/<servicio> \
#     kiba-mpp-demo pnpm demo:charge-client                                    # comprador
#
# Con el vendedor levantado: MPP_DEMO_SERVER_URL=http://<host>:3000 en e2e-mpp.mts (parte A).
FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/* && corepack enable
WORKDIR /demo
ARG MPP_SDK_REF=v0.7.1
RUN git clone --depth 1 --branch ${MPP_SDK_REF} https://github.com/stellar/stellar-mpp-sdk.git . \
    && pnpm install --frozen-lockfile
EXPOSE 3000
CMD ["pnpm", "demo:charge-server"]
