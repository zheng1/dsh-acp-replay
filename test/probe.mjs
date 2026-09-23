/**
 * Shared ACP probe for the checks in this directory.
 *
 * Boots one profile, performs a single `initialize`, and classifies the answer.
 * Both `selfcheck.mjs` (one profile) and `pin-check.mjs` (shipped profile plus the
 * bridged one) are built on this, so the two report the same thing about the same
 * harness.
 */

import { spawn } from 'node:child_process'

export const OUTCOMES = {
  loadSession: 'load-session',
  noLoadSession: 'no-load-session',
  noResponse: 'no-response',
  initializeFailed: 'initialize-failed',
  spawnFailed: 'spawn-failed',
  exited: 'exited',
}

/**
 * @returns {Promise<{kind: string, message: string, image: boolean | null, stderr: string}>}
 */
export async function probeProfile({ bin, profile, timeoutMs = 60000 }) {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--profile', profile], { stdio: ['pipe', 'pipe', 'pipe'] })

    let stdout = ''
    let stderr = ''
    let settled = false

    function finish(result) {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.kill('SIGTERM')
      resolve({ image: null, ...result, stderr: stderr.trim() })
    }

    const timer = setTimeout(
      () =>
        finish({
          kind: OUTCOMES.noResponse,
          message: `no ACP initialize response within ${timeoutMs}ms`,
        }),
      timeoutMs,
    )

    child.on('error', (error) =>
      finish({ kind: OUTCOMES.spawnFailed, message: `could not start ${bin}: ${error.message}` }),
    )
    child.on('exit', (code) =>
      finish({
        kind: OUTCOMES.exited,
        message: `${bin} exited early with code ${code} before answering`,
      }),
    )

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
      let index
      while ((index = stdout.indexOf('\n')) >= 0) {
        const line = stdout.slice(0, index).trim()
        stdout = stdout.slice(index + 1)
        if (line.length === 0) continue
        let message
        try {
          message = JSON.parse(line)
        } catch {
          continue
        }
        if (message.id !== 1) continue
        if (message.error) {
          finish({
            kind: OUTCOMES.initializeFailed,
            message: `initialize failed: ${JSON.stringify(message.error).slice(0, 200)}`,
          })
          continue
        }
        const capabilities = message.result?.agentCapabilities
        finish({
          kind:
            capabilities?.loadSession === true ? OUTCOMES.loadSession : OUTCOMES.noLoadSession,
          message:
            capabilities?.loadSession === true
              ? 'advertises loadSession'
              : 'the bridge answered but does not advertise loadSession',
          image: capabilities?.promptCapabilities?.image === true,
        })
      }
    })

    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: 1, clientCapabilities: {} },
      })}\n`,
    )
  })
}

export function describeImage(result) {
  return result.image === true ? 'image: yes' : 'image: no'
}

/**
 * `dsh` rewrites the profile's `cordis.yml` while preparing it, so a sandbox that
 * denies writes to `DSH_HOME` exits on EPERM before answering — which the probe can
 * only report as "no response", the same text a failed mount produces.
 */
export function explainMissingResponse(result) {
  if (result.kind === OUTCOMES.loadSession || result.kind === OUTCOMES.noLoadSession) return null
  if (/EPERM|prepareProfile|cordis\.yml/i.test(result.stderr)) {
    return 'the harness could not write its profile: run this where DSH_HOME is writable (look for EPERM or prepareProfile in its stderr below)'
  }
  return null
}
