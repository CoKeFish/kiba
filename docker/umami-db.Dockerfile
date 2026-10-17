# Postgres PROPIO de Umami (metrics.kiba.tools), separado del Postgres de negocio.
# Igual que docker/postgres.Dockerfile, pero resuelve SOLO su password desde Doppler
# (UMAMI_DB_PASSWORD, --only-secrets) y la remapea a POSTGRES_PASSWORD, que en Doppler
# es la del Postgres del gateway.
FROM postgres:16-alpine

RUN wget -q -t3 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' -O /etc/apk/keys/cli@doppler-8004D9FF50437357.rsa.pub && \
    echo 'https://packages.doppler.com/public/cli/alpine/any-version/main' >> /etc/apk/repositories && \
    apk add --no-cache doppler

ENTRYPOINT ["doppler", "run", "--only-secrets", "UMAMI_DB_PASSWORD", "--command", "export POSTGRES_PASSWORD=\"$UMAMI_DB_PASSWORD\"; unset DOPPLER_TOKEN UMAMI_DB_PASSWORD; exec docker-entrypoint.sh postgres"]
