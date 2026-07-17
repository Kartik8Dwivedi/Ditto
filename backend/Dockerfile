# syntax=docker/dockerfile:1

# ---- build stage: compile TypeScript to dist/ ----
FROM node:22-alpine AS build
WORKDIR /app

# Install ALL deps (incl. dev) for the build, using the lockfile for reproducibility.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Reduce node_modules to production-only for the runtime image.
RUN npm prune --omit=dev

# ---- runtime stage: only what's needed to run dist/index.js ----
FROM node:22-alpine AS runtime
WORKDIR /app

# Never run as root. node:alpine ships an unprivileged "node" user (uid 1000).
ENV NODE_ENV=production

COPY --chown=node:node package.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist

USER node

# Documentation only — Cloud Run injects PORT at runtime and AppConfig reads it.
# The app defaults to 3001 when PORT is unset (see AppConfig).
EXPOSE 3001

# index.ts handles SIGTERM for graceful shutdown, which is the signal Cloud Run
# sends to drain an instance. Run node directly (no shell/npm wrapper) so the
# process is PID 1 and receives that signal instead of it being swallowed.
CMD ["node", "dist/index.js"]
