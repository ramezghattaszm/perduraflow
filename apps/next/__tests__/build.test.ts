import { exec, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { afterAll, expect, test } from 'vitest'

let buildProcess: ChildProcess | null = null

afterAll(() => {
  if (buildProcess?.pid) {
    try {
      process.kill(buildProcess.pid, 0)
      process.kill(buildProcess.pid)
    } catch {
      // already terminated
    }
  }
})

test('Next.js build completes', async () => {
  // Isolated dist dir → the build never touches a running dev server's `.next` (parallel-safe).
  buildProcess = exec('bun run build', { cwd: path.resolve(__dirname, '..'), env: { ...process.env, NEXT_DIST_DIR: '.next-smoke' } })

  const result = await new Promise<string>((resolve, reject) => {
    let output = ''
    buildProcess?.stdout?.on('data', (d) => (output += d.toString()))
    buildProcess?.stderr?.on('data', (d) => (output += d.toString()))
    buildProcess?.on('close', (code) =>
      code === 0 ? resolve(output) : reject(new Error(`Build exited with code ${code}\n${output}`)),
    )
  })

  // Next build ran and produced the app-router route table.
  expect(result).toContain('Next.js 16')
  expect(result).toContain('Creating an optimized production build')
  expect(result).toContain('Route (app)')

  // Phase-0 routes: the dashboard ('/') + the admin CRUD screens. (Admin was restructured into
  // config/ and access/ sections — these are the current paths.)
  expect(result).toContain('ƒ /')
  expect(result).toContain('/admin/config/plants')
  expect(result).toContain('/admin/access/roles')

  // All routes are server-rendered on demand (no static prerender in phase 0).
  expect(result).toContain('ƒ  (Dynamic)  server-rendered on demand')
}, 180_000)
