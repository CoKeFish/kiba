# slim (glibc), no alpine (musl): la dep nativa transitiva `usb` (stellar-wallets-kit →
# trezor) trae prebuilds solo para glibc; en musl exige toolchain completa para compilar.
FROM node:20-slim

WORKDIR /app

COPY packages/dashboard/package.json ./
RUN npm install

COPY packages/dashboard/ ./

EXPOSE 5173

CMD ["npm", "run", "dev"]
