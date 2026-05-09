FROM rust:1.79-slim-bookworm

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

# Install Solana CLI (Anza release)
ENV SOLANA_VERSION=1.18.22
RUN sh -c "$(curl -sSfL https://release.anza.xyz/v${SOLANA_VERSION}/install)"
ENV PATH="/root/.local/share/solana/install/active_release/bin:${PATH}"

# Install Node 20 (necesario para anchor tests + npm)
RUN curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y nodejs \
    && npm install -g yarn ts-mocha typescript

# Install anchor-cli 0.30.1 directamente (sin avm, que requiere edition2024 / Rust 1.85+)
RUN cargo install --git https://github.com/coral-xyz/anchor --tag v0.30.1 anchor-cli --locked --force

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
