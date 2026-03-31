import test from 'node:test'
import assert from 'node:assert/strict'

import {
  buildSettingsAboutSections,
  buildSettingsTabItems,
  normalizeSettingsAboutAppInfo,
} from '../src/features/settings/settings-modal-model.js'

test('orders settings tabs with Agent providers before external channels', () => {
  const tabs = buildSettingsTabItems('zh-CN')

  assert.deepEqual(
    tabs.map((item) => item.id),
    ['general', 'shortcuts', 'ai', 'channels', 'about'],
  )
  assert.equal(tabs.find((item) => item.id === 'ai')?.label, 'Agent 供应商')
  assert.equal(tabs.find((item) => item.id === 'channels')?.label, '外部通道')
})

test('normalizes about app info with safe defaults', () => {
  assert.deepEqual(
    normalizeSettingsAboutAppInfo({
      name: '  ',
      version: null,
      identifier: '',
      tauriVersion: undefined,
      runtime: 'web',
    }),
    {
      name: 'GT Office',
      version: 'Pending detection',
      identifier: 'dev.gtoffice.app',
      tauriVersion: 'Unavailable',
      runtime: 'web',
    },
  )
})

test('builds localized about sections from runtime metadata', () => {
  const sections = buildSettingsAboutSections('en-US', {
    name: 'GT Office',
    version: '0.1.3',
    identifier: 'dev.gtoffice.app',
    tauriVersion: '2.10.1',
    runtime: 'tauri',
  })

  assert.deepEqual(
    sections.map((section) => section.id),
    ['identity', 'footprint', 'runtime'],
  )
  assert.equal(sections[0]?.items[0]?.value, 'GT Office')
  assert.equal(sections[0]?.items[1]?.value, '0.1.3')
  assert.equal(sections[1]?.items[0]?.value, '.gtoffice/config.json')
  assert.equal(sections[2]?.items[0]?.value, 'Desktop (Tauri)')
  assert.equal(sections[2]?.items[1]?.value, '2.10.1')
})
