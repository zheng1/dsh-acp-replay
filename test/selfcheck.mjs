#!/usr/bin/env node
/**
 * Self-check for the dsh-acp-replay bridge.
 *
 * Boots one profile, performs one ACP `initialize`, and reports whether the
 * bridge answered and advertised `loadSession`. Run it after any harness
 * upgrade: if the vendored bridge no longer matches the installed DSH, the
 * mount-time guard prints its reason to stderr and this script exits non-zero
 * with that text, instead of leaving "the provider will not start" unexplained.
 *
 * Usage:
 *   DSH_BIN=dsh DSH_PROFILE=acp-replay dsh-acp-replay-selfcheck
 */

import { OUTCOMES, describeImage, explainMissingResponse, probeProfile } from './probe.mjs'

const bin = process.env.DSH_BIN ?? 'dsh'
const profile = process.env.DSH_PROFILE ?? 'acp-replay'
const timeoutMs = Number(process.env.SELFCHECK_TIMEOUT_MS ?? 60000)

const result = await probeProfile({ bin, profile, timeoutMs })
const ok = result.kind === OUTCOMES.loadSession

console.log(
  ok
    ? `OK: profile "${profile}" ${result.message} (${describeImage(result)})`
    : `FAIL: ${result.message}`,
)

const hint = explainMissingResponse(result)
if (hint) console.log(`\n${hint}`)

if (!ok && result.stderr.length > 0) {
  console.log(`\n--- ${bin} stderr ---\n${result.stderr}`)
}

process.exit(ok ? 0 : 1)
