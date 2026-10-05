import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEventJournal } from './event-journal.mjs'

test('busy file retries preserve ordering without throwing in event callbacks', async () => {
  const written = []
  let attempts = 0
  const journal = createEventJournal('unused', { wait: async () => {}, openFile: async () => {
    if (++attempts === 1) throw Object.assign(new Error('busy'), { code: 'EBUSY' })
    return { write: async buffer => { written.push(buffer.toString()); return { bytesWritten: buffer.length } }, close: async () => {} }
  } })
  journal.append({ number: 1 }); journal.append({ number: 2 })
  assert.deepEqual(await journal.close(), { retries: 1, error: null })
  assert.equal(written.join(''), '{"number":1}\n{"number":2}\n')
})

test('permanent journal failure is reported separately at finalization', async () => {
  const journal = createEventJournal('unused', { wait: async () => {}, openFile: async () => {
    throw Object.assign(new Error('busy'), { code: 'EBUSY' })
  } })
  assert.doesNotThrow(() => journal.append({ kind: 'game_completed' }))
  const result = await journal.close()
  assert.equal(result.retries, 5)
  assert.equal(result.error.code, 'EBUSY')
})
