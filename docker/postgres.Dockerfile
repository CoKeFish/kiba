# Postgres del stack de producción en Coolify. Envuelto en `doppler run` para que
# POSTGRES_PASSWORD también viva SOLO en Doppler (ni en la UI de Coolify ni en el compose).
FROM postgres:16-alpine

RUN wget -q -t3 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' -O /etc/apk/keys/cli@doppler-8004D9FF50437357.rsa.pub && \
    echo 'https://packages.doppler.com/public/cli/alpine/any-version/main' >> /etc/apk/repositories && \
    apk add --no-cache doppler

ENTRYPOINT ["doppler", "run", "--", "docker-entrypoint.sh"]
CMD ["postgres"]
