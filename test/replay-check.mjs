import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'

const dsh = process.env.DSH_BIN
const home = process.env.DSH_HOME
const profile = process.env.DSH_PROFILE ?? 'acp-replay'
const cwd = process.env.TEST_CWD

function start() {
  const child = spawn(dsh, ['--profile', profile], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env },
  })
  child.stderr.on('data', (d) => process.stderr.write(`[stderr] ${String(d).slice(0, 200)}\n`))
  const state = { buffer: '', pending: new Map(), nextId: 1, notifications: [] }
  child.stdout.on('data', (chunk) => {
    state.buffer += chunk.toString()
    let i
    while ((i = state.buffer.indexOf('\n')) >= 0) {
      const line = state.buffer.slice(0, i).trim()
      state.buffer = state.buffer.slice(i + 1)
      if (!line) continue
      const msg = JSON.parse(line)
      if (msg.method) {
        if (msg.method === 'session/update') state.notifications.push(msg.params)
        if (msg.id !== undefined) {
          if (msg.method === 'session/request_permission') {
            const options = msg.params?.options ?? []
            const allow = options.find((o) => String(o.kind).startsWith('allow')) ?? options[0]
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'selected', optionId: allow?.optionId } } })}\n`)
          } else {
            child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: {} })}\n`)
          }
        }
        continue
      }
      const resolve = state.pending.get(msg.id)
      if (resolve) {
        state.pending.delete(msg.id)
        resolve(msg)
      }
    }
  })
  const request = (method, params, timeoutMs = 300000) => {
    const id = state.nextId++
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`${method} timed out`)), timeoutMs)
      state.pending.set(id, (msg) => {
        clearTimeout(timer)
        resolve(msg)
      })
      child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`)
    })
  }
  return { child, request, state }
}

const phase = process.argv[2]

if (phase === 'record') {
  const { child, request, state } = start()
  const init = await request('initialize', { protocolVersion: 1, clientCapabilities: {} })
  console.log('loadSession advertised:', init.result?.agentCapabilities?.loadSession === true)
  const created = await request('session/new', { cwd, mcpServers: [] })
  const sessionId = created.result.sessionId
  for (const text of ['Reply with exactly: ALPHA', 'Reply with exactly: BETA']) {
    const out = await request('session/prompt', { sessionId, prompt: [{ type: 'text', text }] })
    console.log(`prompt "${text}":`, out.error ? `ERROR ${JSON.stringify(out.error).slice(0, 160)}` : JSON.stringify(out.result))
  }
  const live = state.notifications.map((n) => n.update.sessionUpdate)
  console.log('live updates:', [...new Set(live)].join(', '))
  await request('session/close', { sessionId })
  writeFileSync('/tmp/dsh-replay-session.txt', sessionId)
  console.log('SESSION', sessionId)
  child.stdin.end()
  setTimeout(() => { child.kill('SIGTERM'); process.exit(0) }, 300)
} else {
  const sessionId = process.argv[3]
  const { child, request, state } = start()
  const init = await request('initialize', { protocolVersion: 1, clientCapabilities: {} })
  console.log('loadSession advertised:', init.result?.agentCapabilities?.loadSession === true)
  state.notifications.length = 0
  const out = await request('session/load', { sessionId, cwd, mcpServers: [] })
  if (out.error) {
    console.log('LOAD ERROR:', JSON.stringify(out.error).slice(0, 300))
  } else {
    const updates = state.notifications.map((n) => n.update)
    const kinds = updates.reduce((acc, u) => ({ ...acc, [u.sessionUpdate]: (acc[u.sessionUpdate] ?? 0) + 1 }), {})
    console.log('replayed updates:', JSON.stringify(kinds))
    const users = updates.filter((u) => u.sessionUpdate === 'user_message_chunk').map((u) => u.content?.text)
    const agents = updates.filter((u) => u.sessionUpdate === 'agent_message_chunk').map((u) => u.content?.text)
    console.log('replayed user texts:', JSON.stringify(users))
    console.log('replayed agent texts:', JSON.stringify(agents.map((t) => (t ?? '').slice(0, 40))))
  }
  child.stdin.end()
  setTimeout(() => { child.kill('SIGTERM'); process.exit(0) }, 300)
}
