# This file lives at the repository root on purpose.
#
#   docker build -t chut .
#
# apps/api is an npm workspace: the lockfile is at the root and npm needs to see
# the whole workspace to install anything at all, so the build context has to be
# the repository root. Most hosts default the context to the directory holding
# the Dockerfile, so keeping it here is what makes a zero-configuration deploy
# work.

# --------------------------------------------------------------- runtime deps
# Separate from the build stage so the production node_modules never contains a
# dev dependency, and separate from the runtime image so the C++ toolchain never
# ships. better-sqlite3 is native: it normally downloads a prebuilt binary, but
# when none matches the platform it falls back to compiling, and a stage without
# a compiler would simply fail there.
FROM node:22-slim AS deps
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
# apps/api only. packages/mcp is a workspace in the lockfile but its package.json
# is deliberately left out of the context: npm tolerates the absence, skips its
# dependencies, and the MCP SDK never ships in the server image. Adding the COPY
# back is not a fix, it is 3 MB of an SDK this process never loads.
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev && npm cache clean --force

# --------------------------------------------------------------------- build
FROM node:22-slim AS build
WORKDIR /repo
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
# Dev dependencies included on purpose: Tailwind and TypeScript are needed to
# produce the stylesheet and compile the server, and neither ships.
RUN npm ci

COPY apps/api/tsconfig.json apps/api/
COPY apps/api/src apps/api/src

WORKDIR /repo/apps/api
RUN npm run build:css && npx tsc

# ------------------------------------------------------------------- runtime
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY --from=deps /repo/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
# tsc does not carry stylesheets across; the server reads it beside its own file.
COPY --from=build /repo/apps/api/src/ui/styles.generated.css ./dist/ui/styles.generated.css
COPY apps/api/package.json ./package.json

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
