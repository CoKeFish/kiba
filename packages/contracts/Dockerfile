FROM rust:1.85-slim-bookworm

# System dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    pkg-config \
    libssl-dev \
    libudev-dev \
    curl \
    git \
    bash \
    procps \
    jq \
    && rm -rf /var/lib/apt/lists/*

# ── Solana CLI ────────────────────────────────────────────────────
# 3.1.x trae platform-tools v1.52 (rustc 1.85+) — necesario porque deps modernas
# como blake3 1.8 → digest 0.11 → block-buffer 0.12 ya requieren edition2024.
ENV SOLANA_VERSION=3.1.14
RUN sh -c "$(curl -sSfL https://release.anza.xyz/v${SOLANA_VERSION}/install)"
ENV PATH="/root/.local/share/solana/install/active_release/bin:${PATH}"

# ── solana-test-validator viejo (para localnet sin io_uring) ───────
# El test-validator de 3.1.x usa io_uring que el kernel del host no expone al
# container Docker. Bajamos el binario standalone de 2.3.13 que sí funciona.
RUN curl -sSfL https://github.com/anza-xyz/agave/releases/download/v2.3.13/solana-release-x86_64-unknown-linux-gnu.tar.bz2 \
      -o /tmp/solana-2.3.13.tar.bz2 \
    && tar -xjf /tmp/solana-2.3.13.tar.bz2 -C /tmp \
    && cp /tmp/solana-release/bin/solana-test-validator /usr/local/bin/solana-test-validator-2.3 \
    && rm -rf /tmp/solana-2.3.13.tar.bz2 /tmp/solana-release

# ── Node 20 (para anchor tests + npm) ─────────────────────────────
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn ts-mocha typescript

# ── Anchor CLI 0.31.1 ─────────────────────────────────────────────
# 0.30.1 no compila con proc-macro2 1.0.92+ (Span::source_file removed en rustc 1.85).
RUN cargo install --git https://github.com/coral-xyz/anchor --tag v0.31.1 anchor-cli --locked --force

# Default: devnet
RUN solana config set --url https://api.devnet.solana.com

# CLI helper para el equipo
COPY packages/contracts/scripts/bazaar /usr/local/bin/bazaar
COPY packages/contracts/scripts/init.sh /usr/local/bin/init-contracts
RUN chmod +x /usr/local/bin/bazaar /usr/local/bin/init-contracts

WORKDIR /workspace

# Imprime estado al iniciar bash interactivo
RUN echo 'init-contracts' >> /root/.bashrc

CMD ["tail", "-f", "/dev/null"]
