import { open } from 'node:fs/promises'

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

// One handle and one ordered writer. Event handlers never throw disk errors
// into Playwright; finalization reports a journal failure separately instead.
export function createEventJournal(file, { openFile = open, wait = delay } = {}) {
  let handle
  let closed = false
  let failure
  let retries = 0
  let tail = Promise.resolve()
  async function retry(operation) {
    for (let attempt = 0; ; attempt++) {
      try { return await operation() } catch (error) {
        if (!['EBUSY', 'EACCES', 'EPERM'].includes(error.code) || attempt >= 5) throw error
        retries++
        await wait(50 * 2 ** attempt)
      }
    }
  }
  return {
    append(event) {
      if (closed) return
      const line = `${JSON.stringify(event)}\n`
      tail = tail.then(async () => {
        if (failure) return
        handle ??= await retry(() => openFile(file, 'wx'))
        const buffer = Buffer.from(line)
        let offset = 0
        while (offset < buffer.length) {
          const { bytesWritten } = await retry(() => handle.write(buffer, offset, buffer.length - offset))
          if (!bytesWritten) throw new Error('Event journal write made no progress')
          offset += bytesWritten
        }
      }).catch(error => { failure ??= error })
    },
    async close() {
      closed = true
      await tail
      try { await handle?.close() } catch (error) { failure ??= error }
      return { retries, error: failure ? { code: failure.code, message: failure.message } : null }
    },
  }
}
