#!/usr/bin/env node
/**
 * Pin check: probe a candidate harness on the shipped profile and on the bridged
 * one, and print which of the three outcomes applies, so moving the harness pin
 * after an upgrade is one command instead of a judgement call.
 *
 *   upstream  the shipped profile advertises loadSession itself — drop the bridge
 *             and unpin: point the client back at `dsh --profile acp`
 *   bridge    only the bridged profile advertises it — upgrade the harness and
 *             move the pin
 *   refuses   neither profile answers with loadSession — stay on the pinned harness
 *
 * Usage:
 *   DSH_BIN=~/.local/bin/dsh dsh-acp-replay-pincheck
 *
 * Env: DSH_BIN (default: dsh), DSH_SHIPPED_PROFILE (acp), DSH_PROFILE (acp-replay),
 *      PIN_CHECK_TIMEOUT_MS (60000).
 */

import { spawn } from 'node:child_process'

import { OUTCOMES, describeImage, explainMissingResponse, probeProfile } from './probe.mjs'

const bin = process.env.DSH_BIN ?? 'dsh'
const shippedProfile = process.env.DSH_SHIPPED_PROFILE ?? 'acp'
const bridgeProfile = process.env.DSH_PROFILE ?? 'acp-replay'
const timeoutMs = Number(process.env.PIN_CHECK_TIMEOUT_MS ?? 60000)

function harnessVersion() {
  return new Promise((resolve) => {
    const child = spawn(bin, ['--version'], { stdio: ['ignore', 'pipe', 'ignore'] })
    let stdout = ''
    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })
    child.on('error', () => resolve(null))
    child.on('exit', () => resolve(stdout.split('\n')[0].trim() || null))
  })
}

function report(label, profile, result) {
  const answered =
    result.kind === OUTCOMES.loadSession
      ? `advertises loadSession (${describeImage(result)})`
      : result.message
  return `${`${label} profile "${profile}"`.padEnd(30)} ${answered}`
}

const [version, shipped, bridged] = await Promise.all([
  harnessVersion(),
  probeProfile({ bin, profile: shippedProfile, timeoutMs }),
  probeProfile({ bin, profile: bridgeProfile, timeoutMs }),
])

console.log(`harness: ${bin}${version ? ` (${version})` : ''}`)
console.log(report('shipped', shippedProfile, shipped))
console.log(report('bridge', bridgeProfile, bridged))

let outcome
let advice
if (shipped.kind === OUTCOMES.loadSession) {
  outcome = 'upstream'
  advice = `drop the bridge and unpin; point the client at \`${bin} --profile ${shippedProfile}\``
} else if (bridged.kind === OUTCOMES.loadSession) {
  outcome = 'bridge'
  advice = 'upgrade the harness and move the pin; this bridge answers session/load on it'
} else {
  outcome = 'refuses'
  advice = 'stay on the pinned harness; neither profile advertises session/load'
}

console.log(`\nPIN: ${outcome} — ${advice}`)

for (const result of [shipped, bridged]) {
  const hint = explainMissingResponse(result)
  if (hint) console.log(`\n${hint}`)
}

const answered = new Set([OUTCOMES.loadSession, OUTCOMES.noLoadSession])
for (const [profile, result] of [
  [shippedProfile, shipped],
  [bridgeProfile, bridged],
]) {
  if (answered.has(result.kind) || result.stderr.length === 0) continue
  console.log(`\n--- ${bin} --profile ${profile} stderr ---\n${result.stderr}`)
}
