#!/usr/bin/env node
/**
 * Self-check for the dsh-acp-replay prototype.
 *
 * Boots a profile, performs one ACP `initialize`, and reports whether the
 * bridge answered and advertised `loadSession`. Run it after any harness
 * upgrade: if the vendored bridge no longer matches the installed DSH, the
 * mount-time guard prints its reason to stderr and this script exits non-zero
 * with that text, instead of leaving "the provider will not start" unexplained.
 *
 * Usage:
 *   DSH_BIN=dsh DSH_PROFILE=acp-replay node selfcheck.mjs
 */

import { spawn } from 'node:child_process'

const bin = process.env.DSH_BIN ?? 'dsh'
const profile = process.env.DSH_PROFILE ?? 'acp-replay'
const timeoutMs = Number(process.env.SELFCHECK_TIMEOUT_MS ?? 60000)

const child = spawn(bin, ['--profile', profile], { stdio: ['pipe', 'pipe', 'pipe'] })

let stdout = ''
let stderr = ''
let settled = false

function finish(ok, message) {
  if (settled) return
  settled = true
  clearTimeout(timer)
  child.kill('SIGTERM')
  const details = stderr.trim()
  console.log(`${ok ? 'OK' : 'FAIL'}: ${message}`)
  if (!ok && details.length > 0) console.log(`\n--- ${bin} stderr ---\n${details}`)
  process.exit(ok ? 0 : 1)
}

const timer = setTimeout(
  () => finish(false, `no ACP initialize response within ${timeoutMs}ms`),
  timeoutMs,
)

child.on('error', (error) => finish(false, `could not start ${bin}: ${error.message}`))
child.on('exit', (code) => finish(false, `${bin} exited early with code ${code} before answering`))

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
      finish(false, `initialize failed: ${JSON.stringify(message.error).slice(0, 200)}`)
      continue
    }
    const capabilities = message.result?.agentCapabilities
    if (capabilities?.loadSession !== true) {
      finish(false, 'the bridge answered but does not advertise loadSession')
      continue
    }
    const image = capabilities?.promptCapabilities?.image === true ? 'image: yes' : 'image: no'
    finish(true, `profile "${profile}" advertises loadSession (${image})`)
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
