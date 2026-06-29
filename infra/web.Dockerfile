# syntax=docker/dockerfile:1
#
# Perdura web (Next.js, SSR — NOT static export). bun-based image.
# NEXT_PUBLIC_API_URL is baked at `next build` (packages/app/lib/api-base.ts), so it
# MUST be supplied as a build ARG — a runtime env would never reach the browser bundle.
# Built for linux/arm64 (Graviton t4g). See infra/build-and-push.sh.
#
# Single stage: the root `postinstall` runs `bun run build` (contracts→config→ui), which
# needs the full source present at install time — so we COPY everything before install.
FROM oven/bun:1.3.14
WORKDIR /app
ENV HUSKY=0
# Public API base baked into the client bundle; non-secret Tamagui/Next build flags
# mirrored from apps/next/.env.
ARG NEXT_PUBLIC_API_URL=https://perduraapi.thezmgroup.com/api/v1
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}
ENV TAMAGUI_TARGET=web
ENV TAMAGUI_DISABLE_WARN_DYNAMIC_LOAD=1
ENV IGNORE_TS_CONFIG_PATHS=true
ENV NODE_ENV=production
COPY . .
RUN bun install --frozen-lockfile          # postinstall builds shared packages
# Refresh the static design-system CSS from the live config BEFORE next build, so the
# prod bundle never serves a stale public/tamagui.css (e.g. tight heading letterSpacing).
RUN bun run --filter @perduraflow/next generate:css
RUN bun --filter @perduraflow/next build    # next build (NEXT_PUBLIC_API_URL baked in)

EXPOSE 3011
CMD ["bun", "--filter", "@perduraflow/next", "start"]
