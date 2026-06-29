# syntax=docker/dockerfile:1
#
# Perdura API (NestJS) — bun-based image (matches the dev runtime: CLAUDE.md §4 runs
# the API under bun). The image deliberately keeps `src/`, `node_modules` (incl. tsx +
# drizzle-kit devDeps), `apps/api/dist`, and `apps/api/drizzle/` so the SAME container can:
#   serve   →  bun apps/api/dist/main.js
#   migrate →  bun --filter @perduraflow/api db:migrate   (drizzle-kit)
#   reseed  →  bun --filter @perduraflow/api demo:reset    (tsx src/db/reset.ts, hits localhost)
# Built for linux/arm64 (Graviton t4g). See infra/build-and-push.sh.
#
# Single stage: the root `postinstall` runs `bun run build` (contracts→config→ui), which
# needs the full source present at install time — so we COPY everything before install.
FROM oven/bun:1.3.14
WORKDIR /app
ENV HUSKY=0
COPY . .
RUN bun install --frozen-lockfile          # postinstall builds shared packages
RUN bun --filter @perduraflow/api build     # nest build → apps/api/dist

ENV NODE_ENV=production
ENV PORT=3010
EXPOSE 3010
CMD ["bun", "apps/api/dist/main.js"]
