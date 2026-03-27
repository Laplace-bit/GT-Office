import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveStationManageModalCopy } from '../src/features/workspace-hub/station-manage-copy.js'

test('uses add-agent copy for the create modal', () => {
  const copy = resolveStationManageModalCopy('zh-CN', false)

  assert.equal(copy.title, '新增agent')
  assert.equal(copy.subtitle, '配置 agent 的核心属性、角色与执行环境。')
  assert.equal(copy.submitLabel, '新增agent')
})

test('uses agent wording for edit and delete actions in the modal', () => {
  const copy = resolveStationManageModalCopy('zh-CN', true)

  assert.equal(copy.title, '编辑agent')
  assert.equal(copy.subtitle, '更新 agent 的核心属性、角色与执行环境。')
  assert.equal(copy.deleteLabel, '删除agent')
})
