# Umami (metrics.kiba.tools): analítica web auto-hospedada, solo para uso interno.
# Imagen oficial FIJADA a una versión + CLI de Doppler: el contenedor recibe UNA sola env
# (DOPPLER_TOKEN) y resuelve en runtime SOLO sus tres secretos (--only-secrets, no recibe
# el resto del stack), que remapea a los nombres que espera Umami (DATABASE_URL /
# APP_SECRET / TWO_FACTOR_ENCRYPTION_KEY): DATABASE_URL ya existe en Doppler para el gateway.
FROM ghcr.io/umami-software/umami:3.4.0

# CLI de Doppler (capa explícita; no se confía en el host). La imagen corre como `nextjs`.
USER root
RUN wget -q -t3 'https://packages.doppler.com/public/cli/rsa.8004D9FF50437357.key' -O /etc/apk/keys/cli@doppler-8004D9FF50437357.rsa.pub && \
    echo 'https://packages.doppler.com/public/cli/alpine/any-version/main' >> /etc/apk/repositories && \
    apk add --no-cache doppler
USER nextjs

# Sin secretos resueltos no arranca: falla rápido y visible (por diseño).
# start-docker.sh (de la imagen) = migraciones Prisma + reescritura del tracker
# (COLLECT_API_ENDPOINT) + `node server.js`.
CMD ["doppler", "run", "--only-secrets", "UMAMI_DATABASE_URL,UMAMI_APP_SECRET,UMAMI_TWO_FACTOR_KEY", "--command", "export DATABASE_URL=\"$UMAMI_DATABASE_URL\" APP_SECRET=\"$UMAMI_APP_SECRET\" TWO_FACTOR_ENCRYPTION_KEY=\"$UMAMI_TWO_FACTOR_KEY\"; unset DOPPLER_TOKEN UMAMI_DATABASE_URL UMAMI_APP_SECRET UMAMI_TWO_FACTOR_KEY; exec sh scripts/start-docker.sh"]
