# Moli Cashier runs as one long-lived Node process. The image keeps the sources and the full
# node_modules rather than a standalone output: the migration and the account commands run through
# tsx, and both need them.
# Pinned by digest so the image CI checked and the one the deploy builds start from the same base;
# Dependabot moves the pin.
FROM node:25-bookworm-slim@sha256:81db02c4b671288a03915da9534dbd54f96d0e7c24d80ccc54f5b36b2e684370

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    # next start otherwise exits 143 on SIGTERM and the worker never hands its work back.
    NEXT_MANUAL_SIG_HANDLE=true

WORKDIR /app

COPY package.json package-lock.json ./
# Dev dependencies stay: the build needs them, and so do tsx and the migration at runtime.
RUN npm ci --include=dev

COPY . .

# The build only needs the startup variables to be well-formed; none of them is used or kept.
RUN DATABASE_URL=postgresql://build:build@127.0.0.1:1/build \
    OPENAI_API_KEY=build \
    AUTH_SECRET=build-only-secret \
    APP_URL=http://localhost:3000 \
    S3_ENDPOINT=http://127.0.0.1:1 \
    S3_BUCKET=build \
    S3_ACCESS_KEY_ID=build \
    S3_SECRET_ACCESS_KEY=build \
    npm run build \
 && mkdir -p .next/cache \
 && chown -R node:node .next/cache
# Root owns the sources, node_modules and the build: the server process can write only its cache.

# The commit sha the deploy builds from; /healthz reports it so the deploy can confirm what is
# running. Set after the build so a new sha does not invalidate the install and build layers.
ARG VERSION=dev
ENV APP_VERSION=$VERSION

USER node
EXPOSE 3000
ENTRYPOINT ["./scripts/docker-entrypoint.sh"]
