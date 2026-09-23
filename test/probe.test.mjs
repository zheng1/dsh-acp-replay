import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OUTCOMES, describeImage, explainMissingResponse } from './probe.mjs'

test('reports loadSession and the image capability', () => {
  assert.equal(describeImage({ image: true }), 'image: yes')
  assert.equal(describeImage({ image: false }), 'image: no')
  assert.equal(describeImage({ image: null }), 'image: no')
})

test('explains a silent probe whose harness could not write its profile', () => {
  const hint = explainMissingResponse({
    kind: OUTCOMES.noResponse,
    stderr: 'Error: EPERM: operation not permitted, open cordis.yml',
  })

  assert.match(hint ?? '', /DSH_HOME is writable/)
})

test('explains a probe that failed while preparing the profile', () => {
  const hint = explainMissingResponse({
    kind: OUTCOMES.exited,
    stderr: 'prepareProfile failed: read-only file system',
  })

  assert.match(hint ?? '', /DSH_HOME is writable/)
})

test('leaves an answered probe alone', () => {
  assert.equal(
    explainMissingResponse({ kind: OUTCOMES.loadSession, stderr: 'EPERM cordis.yml' }),
    null,
  )
  assert.equal(
    explainMissingResponse({ kind: OUTCOMES.noLoadSession, stderr: 'prepareProfile' }),
    null,
  )
})

test('does not guess at an unrelated failure', () => {
  assert.equal(
    explainMissingResponse({ kind: OUTCOMES.noResponse, stderr: 'some other error' }),
    null,
  )
})
