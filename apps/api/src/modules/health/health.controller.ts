import { Controller, Get } from '@nestjs/common'

/**
 * Liveness probe — no auth, no DB, no tenant scope. Mounted at `GET /api/v1/health`
 * (the global `api/v1` prefix applies). Exists so a load balancer / reverse proxy
 * (Caddy) and the docker-compose healthcheck have a known 200 route; the app's real
 * routes are all POST under guarded prefixes and 404 at the root otherwise.
 *
 * @returns `{ status: 'ok' }` with HTTP 200 whenever the process is serving.
 */
@Controller('health')
export class HealthController {
  /** Liveness probe. @returns `{ status: 'ok' }` (HTTP 200) while the process serves. */
  @Get()
  check(): { status: 'ok' } {
    return { status: 'ok' }
  }
}
