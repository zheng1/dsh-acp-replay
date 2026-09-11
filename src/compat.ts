/**
 * Fail loudly when the harness this profile booted into cannot serve
 * `session/load`.
 *
 * This bridge vendors `@deepseek-ai/dsh-acp@0.1.5-rc.1` and reads a persisted
 * log through the persistence handle API that release introduced. A harness
 * upgrade can move that API again (`0.1.2-rc.1` exposed `load`/`inspect`
 * directly on the service), and a silent mismatch would surface much later as
 * "the provider will not start" or as an empty transcript. Checking once at
 * mount turns that into one sentence naming the fix.
 *
 * @module dsh-acp-replay/compat
 */

/** Persistence methods this bridge calls on the injected service. */
const REQUIRED_PERSISTENCE_METHODS = ['open', 'stat'] as const

const HOMEPAGE = 'https://github.com/zheng1/dsh-acp-replay'

export interface ReplayHostSupport {
  /** The injected `ctx.sessionPersistence` service, when the harness provides one. */
  persistence: unknown
  /** The ACP SDK's `session/load` method constant, which must exist to route the call. */
  sessionLoadMethod: unknown
  /** Harness-reported version, used only to make the message concrete. */
  harnessVersion?: string
}

/** One unmet requirement, phrased for a log line rather than an exception. */
export interface ReplayHostProblem {
  requirement: string
  detail: string
}

function hasFunction(value: unknown, key: string): boolean {
  return typeof (value as Record<string, unknown> | null)?.[key] === 'function'
}

function describeService(value: unknown): string {
  if (value === null || value === undefined) return 'not mounted'
  const keys = Object.keys(value as Record<string, unknown>).filter((key) =>
    hasFunction(value, key),
  )
  return keys.length > 0 ? keys.sort().join(', ') : 'no callable methods'
}

/**
 * Report every requirement this bridge does not find in its host.
 * @param support - the injected persistence service and ACP method constant.
 * @returns one entry per unmet requirement; empty when the host is usable.
 */
export function replayHostProblems(support: ReplayHostSupport): ReplayHostProblem[] {
  const problems: ReplayHostProblem[] = []
  for (const method of REQUIRED_PERSISTENCE_METHODS) {
    if (!hasFunction(support.persistence, method)) {
      problems.push({
        requirement: `ctx.sessionPersistence.${method}()`,
        detail: `the mounted sessionPersistence service exposes ${describeService(support.persistence)}`,
      })
    }
  }
  if (support.sessionLoadMethod === undefined || support.sessionLoadMethod === null) {
    problems.push({
      requirement: 'the ACP SDK session/load method constant',
      detail: 'this @agentclientprotocol/sdk version does not expose methods.agent.session.load',
    })
  }
  return problems
}

/**
 * Refuse to mount when the host cannot serve a replayed transcript.
 * @param support - the injected persistence service and ACP method constant.
 * @throws when any requirement is unmet; the message names the requirement, the
 *   alternative bridge, and where to update this plugin.
 */
export function assertReplayHostSupport(support: ReplayHostSupport): void {
  const problems = replayHostProblems(support)
  if (problems.length === 0) return
  const harness = support.harnessVersion === undefined ? '' : ` (harness ${support.harnessVersion})`
  const lines = [
    `dsh-acp-replay cannot serve session/load in this harness${harness}:`,
    ...problems.map((problem) => `  - needs ${problem.requirement}, but ${problem.detail}`),
    `This plugin vendors @deepseek-ai/dsh-acp@0.1.5-rc.1 and needs the persistence handle API it introduced.`,
    `Use the shipped bridge instead ("dsh --profile acp"), or update this plugin for the installed harness.`,
    HOMEPAGE,
  ]
  const error = new Error(lines.join('\n'))
  error.name = 'ReplayHostUnsupportedError'
  throw error
}
