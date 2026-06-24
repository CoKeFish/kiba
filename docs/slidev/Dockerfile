# Slidev pitch deck → static SPA, deployed like the other Kiba apps.
# Coolify builds with base_directory=/ (repo root) as context and
# dockerfile_location=/docs/slidev/Dockerfile, so COPY paths are repo-root-relative.
FROM node:20-alpine

WORKDIR /app

COPY docs/slidev/package.json ./
# --omit=dev skips playwright-chromium (only used for PDF/PNG export, not the build)
RUN npm install --omit=dev

COPY docs/slidev/ ./

# slidev build -> ./dist (static single-page app)
RUN npm run build

# Bake a static file server into the image (no runtime download)
RUN npm install -g serve@14

EXPOSE 4321

# -s = single-page fallback so deep links (/2, /3, ...) resolve to index.html
CMD ["sh", "-c", "serve dist -s -l ${PORT:-4321}"]
