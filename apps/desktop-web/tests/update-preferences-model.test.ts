import test from 'node:test'
import assert from 'node:assert/strict'

import {
  computeHasAvailableUpdate,
  getUpdateUnavailableReasonMessage,
} from '../src/features/settings/update-preferences-model.js'

test('computeHasAvailableUpdate stays true when update metadata remains available', () => {
  assert.equal(
    computeHasAvailableUpdate({
      enabled: true,
      updateAvailable: true,
      latestVersion: '0.1.7',
      skippedVersion: null,
    }),
    true,
  )
})

test('computeHasAvailableUpdate returns false for skipped or unavailable versions', () => {
  assert.equal(
    computeHasAvailableUpdate({
      enabled: true,
      updateAvailable: true,
      latestVersion: '0.1.7',
      skippedVersion: '0.1.7',
    }),
    false,
  )
  assert.equal(
    computeHasAvailableUpdate({
      enabled: true,
      updateAvailable: false,
      latestVersion: '0.1.7',
      skippedVersion: null,
    }),
    false,
  )
})

test('getUpdateUnavailableReasonMessage explains missing updater public key', () => {
  assert.match(getUpdateUnavailableReasonMessage('UPDATER_PUBKEY_MISSING', 'zh-CN'), /公钥配置/)
  assert.match(
    getUpdateUnavailableReasonMessage('UPDATER_PUBKEY_MISSING', 'en-US'),
    /public key is missing/i,
  )
})

test('getUpdateUnavailableReasonMessage falls back to generic guidance', () => {
  assert.match(getUpdateUnavailableReasonMessage('UNKNOWN_REASON', 'zh-CN'), /签名发布产物/)
  assert.match(getUpdateUnavailableReasonMessage(null, 'en-US'), /signed release artifacts/i)
})
