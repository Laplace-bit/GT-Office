import test from 'node:test'
import assert from 'node:assert/strict'

test('standard modal backdrops do not request close', async () => {
  const modulePath = '../src/components/modal/standard-modal-close.js'
  const modalClose = await import(modulePath as string).catch(() => null)

  assert.ok(modalClose, 'expected standard modal close helper to exist')

  let closeCount = 0
  modalClose.requestStandardModalClose('backdrop', () => {
    closeCount += 1
  })

  assert.equal(closeCount, 0)
})

test('explicit standard modal close requests close', async () => {
  const modulePath = '../src/components/modal/standard-modal-close.js'
  const modalClose = await import(modulePath as string).catch(() => null)

  assert.ok(modalClose, 'expected standard modal close helper to exist')

  let closeCount = 0
  modalClose.requestStandardModalClose('explicit', () => {
    closeCount += 1
  })

  assert.equal(closeCount, 1)
})
