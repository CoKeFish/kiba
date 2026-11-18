# Tope de espacio de las grabaciones de sesión de Umami (docker/umami-prune.sh): un bucle
# con psql contra umami-db. Misma base que docker/umami-db.Dockerfile (cliente psql 16 +
# CLI de Doppler); resuelve SOLO la password de esa base (UMAMI_DB_PASSWORD, --only-secrets)
# y la pasa a psql como PGPASSWORD.
FROM postgres:16-alpine

RUN wget -q -t3 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' -O /etc/apk/keys/cli@doppler-8004D9FF50437357.rsa.pub && \
    echo 'https://packages.doppler.com/public/cli/alpine/any-version/main' >> /etc/apk/repositories && \
    apk add --no-cache doppler

COPY docker/umami-prune.sh /usr/local/bin/umami-prune.sh

USER postgres

ENTRYPOINT ["doppler", "run", "--only-secrets", "UMAMI_DB_PASSWORD", "--command", "export PGPASSWORD=\"$UMAMI_DB_PASSWORD\"; unset DOPPLER_TOKEN UMAMI_DB_PASSWORD; exec sh /usr/local/bin/umami-prune.sh"]
