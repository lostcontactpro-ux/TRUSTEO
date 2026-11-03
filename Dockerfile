# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim AS dependencies
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 PRISMA_SKIP_POSTINSTALL_GENERATE=true
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/core/package.json packages/core/package.json
# Optional cloud proxy trust; no session certificate is retained in an image layer.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --strict-ssl=true

FROM dependencies AS dev
COPY --chown=node:node . .
# A non-connected build URL lets Prisma read the client engine configuration.
# No actual database credentials or connection are needed for generation.
RUN npm run providers:generate && DATABASE_URL=postgresql://build:build@localhost:5432/build npm run db:generate && ln -s ../../.env apps/web/.env
EXPOSE 3000
CMD ["npm", "run", "dev"]

FROM dev AS builder
ARG APP_URL=http://localhost:3000
ENV APP_URL=$APP_URL NODE_ENV=production
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npm run build

# Separate long-running image. Runtime variables are injected, no .env file needed.
FROM dev AS worker
ENV NODE_ENV=production
USER node
CMD ["node", "--import", "tsx", "apps/worker/src/index.ts"]

FROM node:24-bookworm-slim AS web
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder --chown=node:node /app/apps/web/public ./apps/web/public
USER node
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
