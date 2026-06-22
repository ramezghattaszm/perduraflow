import { spawn, type ChildProcess } from 'node:child_process'
import path from 'node:path'
import { promisify } from 'node:util'
import treeKill from 'tree-kill'
import { expect, test } from 'vitest'

const treeKillAsync = promisify(treeKill)
// Dedicated port so the test never collides with a running dev server / API.
const PORT = '3140'

test('Next.js dev server starts', async () => {
  let devProcess: ChildProcess | null = null

  try {
    devProcess = spawn('bunx', ['next', 'dev', '-p', PORT], {
      cwd: path.resolve(__dirname, '..'),
      stdio: 'pipe',
      shell: true,
      // Isolated dist dir → no `.next/dev/lock` collision with a running `bun web` (parallel-safe).
      env: { ...process.env, NEXT_DIST_DIR: '.next-smoke' },
    })

    let output = ''
    devProcess.stdout?.on('data', (d) => (output += d.toString()))
    devProcess.stderr?.on('data', (d) => (output += d.toString()))

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timeout; output:\n${output}`)), 60000)
      devProcess?.stdout?.on('data', (data) => {
        if (data.toString().includes('Ready in')) {
          clearTimeout(timeout)
          resolve()
        }
      })
    })

    expect(output).toContain('Next.js 16')
    expect(output).toContain('Local:')
    expect(output).toContain('Ready in')
  } finally {
    if (devProcess?.pid) {
      try {
        await treeKillAsync(devProcess.pid)
      } catch (error) {
        console.error('Failed to kill process:', error)
      }
    }
  }
}, 90000)
