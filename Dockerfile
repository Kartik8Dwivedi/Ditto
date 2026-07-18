# syntax=docker/dockerfile:1
#
# ROOT Dockerfile for Cloud Run deployment of the backend.
# Build context = repo root (Cloud Run's default), so every path is prefixed
# with `backend/`. For local builds from inside backend/, use backend/Dockerfile.

# ---- build stage: compile TypeScript to dist/ ----
FROM node:22-alpine AS build
WORKDIR /app

# Install ALL deps (incl. dev) for the build, using the lockfile for reproducibility.
COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

# Reduce node_modules to production-only for the runtime image.
RUN npm prune --omit=dev

# ---- runtime stage: only what's needed to run dist/index.js ----
FROM node:22-alpine AS runtime
WORKDIR /app

# Never run as root. node:alpine ships an unprivileged "node" user (uid 1000).
ENV NODE_ENV=production

COPY --chown=node:node backend/package.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist

USER node

# Documentation only — Cloud Run injects PORT at runtime and AppConfig reads it.
EXPOSE 3001

# index.ts handles SIGTERM for graceful shutdown (the signal Cloud Run sends to
# drain an instance). Run node directly so it is PID 1 and receives that signal.
CMD ["node", "dist/index.js"]
