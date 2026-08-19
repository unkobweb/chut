# Built from the repository root, not from apps/api:
#   docker build -f apps/api/Dockerfile -t chut .
# The lockfile lives at the root now that this is a workspace, and npm needs to
# see the whole workspace to install anything at all.

FROM node:22-slim AS build
WORKDIR /repo

# better-sqlite3 is native and compiles here; the runtime stage carries only the
# built artefact, so none of this toolchain ships.
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

# --------------------------------------------------------------------------

FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production

# Runtime dependencies only. No TypeScript, no Tailwind, no tsx: the server that
# runs in production is plain compiled JavaScript.
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /repo/apps/api/dist ./dist
# tsc does not carry stylesheets across; the server reads it beside its own file.
COPY --from=build /repo/apps/api/src/ui/styles.generated.css ./dist/ui/styles.generated.css

RUN mkdir -p /app/data && chown -R node:node /app/data
USER node
VOLUME ["/app/data"]
EXPOSE 8787

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/server.js"]
