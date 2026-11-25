# The production image: the compiled API with its shared contracts, its runtime dependencies
# and the web shell it serves. CI builds and smoke-tests it (docs/ci-and-images.md). The Node major matches .nvmrc.
FROM node:26.13.1-bookworm-slim@sha256:0042e17d232a87a2cd485be1da7900fca4d10a4ad11b29e9285da1d2e54798c9 AS base

FROM base AS build
WORKDIR /src
COPY apps/web/package.json apps/web/package-lock.json apps/web/
COPY apps/api/package.json apps/api/package-lock.json apps/api/
# Explicit, so an inherited NODE_ENV=production can never skip the build tools.
RUN NODE_ENV=development npm --prefix apps/web ci --include=dev --no-audit --no-fund \
    && NODE_ENV=development npm --prefix apps/api ci --include=dev --no-audit --no-fund
COPY packages/ packages/
COPY apps/ apps/
# Vite derives import.meta.env.PROD from NODE_ENV. The API build compiles packages/contracts
# into apps/api/contracts first (prebuild), which the API imports as #contracts.
RUN NODE_ENV=production npm --prefix apps/web run build \
    && NODE_ENV=production npm --prefix apps/api run build

FROM base AS deps
WORKDIR /app/server
COPY apps/api/package.json apps/api/package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

FROM base AS runtime
# EMBER_CONTAINER=1 switches the startup guard to the container endpoints (apps/api/src/config.ts).
ENV NODE_ENV=production EMBER_WEB_ROOT=/app/web EMBER_CONTAINER=1
WORKDIR /app/server
COPY --from=deps /app/server/package.json ./package.json
COPY --from=deps /app/server/node_modules ./node_modules
COPY --from=build /src/apps/api/dist ./dist
COPY --from=build /src/apps/api/contracts ./contracts
COPY --from=build /src/apps/web/dist /app/web
COPY apps/api/scripts/image-smoke.cjs /tmp/image-smoke.cjs
RUN node /tmp/image-smoke.cjs && rm /tmp/image-smoke.cjs
USER node
EXPOSE 5191
CMD ["node", "dist/trial.js"]
