ARG BUN_VERSION=1.4.4

FROM rust:1.100.0-alpine3.24@sha256:de1e0058543a81ed7b046629167db587c67a94bdf37cce14eb27f0ec83baaffb AS core-builder

WORKDIR /app/core
RUN apk add --no-cache musl-dev
COPY core/Cargo.toml core/Cargo.lock core/rust-toolchain.toml ./
COPY core/src ./src
COPY core/app-contracts/Cargo.toml core/app-contracts/build.rs ./app-contracts/
COPY core/app-contracts/src ./app-contracts/src
COPY contracts/v1/contracts.schema.json /app/contracts/v1/contracts.schema.json
RUN --mount=type=cache,id=rentnerproxy-marketplace-cargo-registry,target=/usr/local/cargo/registry,sharing=locked \
    --mount=type=cache,id=rentnerproxy-marketplace-cargo-musl-release,target=/app/core/target,sharing=locked \
    cargo build --release --locked --bins \
    && mkdir /native \
    && find target/release -maxdepth 1 -type f -name 'marketplace-*' ! -name '*.d' -exec cp '{}' /native/ ';' \
    && test -x /native/marketplace-appliance \
    && test -x /native/marketplace-archive \
    && test -x /native/marketplace-storage

FROM valkey/valkey:9.1.3-alpine AS valkey-runtime

FROM oven/bun:${BUN_VERSION}-alpine AS base

WORKDIR /app

FROM alpine:3.24 AS runtime-base

WORKDIR /app

ENV BUN_RUNTIME_TRANSPILER_CACHE_PATH=0 \
    BUN_INSTALL_BIN=/usr/local/bin

COPY --from=base /usr/local/bin/bun /usr/local/bin/bun

RUN apk upgrade --no-cache \
    && apk add --no-cache postgresql18 postgresql18-client su-exec tini bash openssl libgcc libstdc++ ca-certificates \
    && addgroup -g 1000 bun \
    && adduser -u 1000 -G bun -s /bin/sh -D bun \
    && addgroup -g 1001 valkey \
    && adduser -u 1001 -G valkey -s /bin/sh -D valkey \
    && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && ln -s /usr/local/bin/bun /usr/local/bin/node

COPY --from=valkey-runtime /usr/local/bin/valkey-server /usr/local/bin/valkey-cli /usr/local/bin/
COPY --chmod=755 \
    docker/container-entrypoint.sh \
    docker/container-healthcheck.sh \
    docker/appliance-psql \
    docker/valkey/valkey-entrypoint.sh \
    docker/valkey/valkey-healthcheck.sh \
    /usr/local/bin/

RUN bun --version \
    && pg_dump --version | grep -E '^pg_dump \(PostgreSQL\) 18\.' \
    && pg_restore --version | grep -E '^pg_restore \(PostgreSQL\) 18\.' \
    && valkey-server --version && valkey-cli --version

HEALTHCHECK --interval=30s --timeout=15s --start-period=5m --retries=3 \
    CMD ["container-healthcheck.sh"]

ENTRYPOINT ["tini", "--", "container-entrypoint.sh"]
CMD ["start"]

FROM base AS deps

COPY package.json bun.lock bunfig.toml ./
COPY patches ./patches
RUN export BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER=1 && \
    if ! bun ci --linker=isolated; then \
        echo "Bun cache is corrupt or download incomplete; retrying with an empty cache."; \
        bun pm cache rm; \
        bun ci --linker=isolated; \
    fi

FROM base AS builder

ARG APP_VERSION
ARG VITE_REALTIME_WS_URL=

RUN test -n "$APP_VERSION"

ENV VITE_APP_VERSION=$APP_VERSION \
    VITE_REALTIME_WS_URL=$VITE_REALTIME_WS_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN bun run build

FROM base AS production-deps

COPY package.json bun.lock bunfig.toml ./
COPY patches ./patches
RUN export BUN_FEATURE_FLAG_DISABLE_NATIVE_DEPENDENCY_LINKER=1 && \
    if ! bun ci --linker=isolated --production --omit=peer; then \
        echo "Bun cache is corrupt or download incomplete; retrying with an empty cache."; \
        bun pm cache rm; \
        bun ci --linker=isolated --production --omit=peer; \
    fi

FROM runtime-base AS runner

USER root

ARG APP_VERSION
ARG VITE_REALTIME_WS_URL=

LABEL org.opencontainers.image.title="RentnerProxy Marketplace" \
      org.opencontainers.image.version="$APP_VERSION"

ENV NODE_ENV=production \
    VITE_APP_VERSION=$APP_VERSION \
    VITE_REALTIME_WS_URL=$VITE_REALTIME_WS_URL \
    PORT=3000 \
    INTERNAL_APP_PORT=3002 \
    HOST=0.0.0.0 \
    APP_STORAGE_DIR=/data/storage/public \
    APP_PRIVATE_STORAGE_DIR=/data/storage/private \
    POSTGRES_HOST=127.0.0.1 \
    POSTGRES_PORT=5432 \
    POSTGRES_DB=rentnerproxy_marketplace \
    POSTGRES_USER=postgres \
    VALKEY_URL=redis://127.0.0.1:6379 \
    CONTAINER_LOG_READER_URL=http://127.0.0.1:3004 \
    BACKUP_DIR=/data/backups \
    MAIL_FROM_NAME="RentnerProxy Marketplace"

COPY --from=production-deps /app/node_modules ./node_modules
COPY --from=builder /app/.output ./.output
COPY --from=builder /app/web/drizzle ./web/drizzle
COPY --from=builder /app/package.json ./package.json
COPY LICENSE /app/LICENSE
COPY --from=builder /app/web ./web
COPY --from=builder /app/tsconfig.json ./tsconfig.json
COPY --from=core-builder /native/ /usr/local/bin/

EXPOSE 3000

CMD ["start"]

FROM runtime-base AS core-integration

COPY package.json tsconfig.json bunfig.toml ./
COPY --from=deps /app/node_modules ./node_modules
COPY --from=core-builder /native/ /usr/local/bin/
COPY --from=integration-web ./src ./web/src
COPY core/tests/fixtures ./core/tests/fixtures
ENV NODE_ENV=test \
    CORE_BINARY_DIR=/usr/local/bin
HEALTHCHECK NONE
USER bun
ENTRYPOINT ["bun", "--no-env-file", "test", "--isolate", "--timeout", "30000", "--path-ignore-patterns", "__no_ignore__", ".core.test.ts"]
CMD []

FROM runner AS production
