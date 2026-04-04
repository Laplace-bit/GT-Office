import test from 'node:test'
import assert from 'node:assert/strict'

import { t } from '../src/shell/i18n/ui-locale.js'

test('gto enhancements use translated labels instead of raw keys', () => {
  assert.equal(t('zh-CN', 'aiConfig.services.gtoPluginTitle'), 'GTO Plugin')
  assert.equal(t('zh-CN', 'aiConfig.services.gtoPluginInstall'), '安装 GTO Plugin')
  assert.equal(t('zh-CN', 'aiConfig.services.gtoPluginTakeover'), '接管 GTO Plugin')
  assert.equal(t('zh-CN', 'aiConfig.services.gtoPluginUninstall'), '卸载 GTO Plugin')
})

test('gto plugin description no longer shows the old placeholder copy', () => {
  const description = t('zh-CN', 'aiConfig.services.gtoPluginDesc')
  assert.match(description, /gto/)
  assert.doesNotMatch(description, /预留/)
  assert.doesNotMatch(description, /视觉骨架/)
})
