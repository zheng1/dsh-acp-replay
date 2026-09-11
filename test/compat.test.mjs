import { test } from 'node:test'
import assert from 'node:assert/strict'
import { assertReplayHostSupport, replayHostProblems } from '../lib/compat.js'

const noop = () => {}

test('accepts a harness with the persistence handle API', () => {
  const support = {
    persistence: { create: noop, open: noop, flush: noop, stat: noop, list: noop },
    sessionLoadMethod: 'session/load',
  }
  assert.deepEqual(replayHostProblems(support), [])
  assertReplayHostSupport(support)
})

test('names the service-level read API that replaced it', () => {
  const legacy = {
    persistence: { load: noop, inspect: noop, stat: noop, list: noop },
    sessionLoadMethod: 'session/load',
  }
  const problems = replayHostProblems(legacy)
  assert.equal(problems.length, 1)
  assert.match(problems[0].requirement, /sessionPersistence\.open\(\)/)
  assert.match(problems[0].detail, /inspect, list, load, stat/)
  assert.throws(() => assertReplayHostSupport(legacy), /cannot serve session\/load/)
})

test('refuses a host with no persistence service mounted', () => {
  assert.throws(
    () => assertReplayHostSupport({ persistence: undefined, sessionLoadMethod: 'session/load' }),
    /not mounted/,
  )
})

test('refuses an ACP SDK without the session/load constant', () => {
  assert.throws(
    () => assertReplayHostSupport({ persistence: { open: noop, stat: noop }, sessionLoadMethod: undefined }),
    /session\/load method constant/,
  )
})

test('reports the harness version when the caller knows it', () => {
  assert.throws(
    () => assertReplayHostSupport({ persistence: undefined, sessionLoadMethod: 'session/load', harnessVersion: '0.1.6' }),
    /harness 0\.1\.6/,
  )
})
