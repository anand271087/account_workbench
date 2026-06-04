# Frontend Dockerfile — Vite build → nginx static serve.
#
# Two-stage so the runtime image carries only the compiled bundle + nginx,
# not node_modules or Vite. Final image ~25 MB.
#
# Build args at the top let CI/the devops engineer point the bundle at a
# specific API host without touching code:
#   docker build \
#     --build-arg VITE_API_BASE_URL=https://api.awb.beroe.internal \
#     --build-arg VITE_SUPABASE_URL=https://<project>.supabase.co \
#     --build-arg VITE_SUPABASE_ANON_KEY=<anon-key> \
#     -t beroe-awb-web .

# ---------- Stage 1: build ----------
FROM node:20-alpine AS build

ENV PNPM_HOME="/root/.local/share/pnpm" \
    PATH="$PATH:/root/.local/share/pnpm"

WORKDIR /app

# pnpm via corepack (bundled with Node 20)
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate

# Dependency layer — cached unless pnpm-lock.yaml changes.
# We copy the lockfile + the workspace + web package manifests so pnpm can
# resolve dependencies for the web app alone.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json ./apps/web/package.json
RUN pnpm install --frozen-lockfile --filter @beroe/web...

# Application sources
COPY apps/web ./apps/web

# Build-time env. Vite bakes these into the bundle at build time, so they
# MUST be supplied as --build-arg at docker build time (not docker run).
ARG VITE_API_BASE_URL
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_SUPABASE_URL=$VITE_SUPABASE_URL \
    VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY

# Type-check + build. Match the same script CI runs.
WORKDIR /app/apps/web
RUN pnpm run build

# ---------- Stage 2: runtime ----------
FROM nginx:1.27-alpine AS runtime

# Strip the default site config; ours below owns /etc/nginx/conf.d/default.conf
RUN rm /etc/nginx/conf.d/default.conf
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

# Copy the compiled bundle. Vite's default outDir is `dist`.
COPY --from=build /app/apps/web/dist /usr/share/nginx/html

# Optional: a tiny entrypoint that could inject a runtime config.js for
# env vars that need to change without rebuilding. Not used by default —
# Vite envs are baked in at build time per the ARG block above.

EXPOSE 80

# nginx runs in foreground (daemon off) as PID 1 — clean signal handling.
CMD ["nginx", "-g", "daemon off;"]
