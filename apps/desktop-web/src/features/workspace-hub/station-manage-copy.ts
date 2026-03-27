import { t, type Locale } from '../../shell/i18n/ui-locale.js'

export interface StationManageModalCopy {
  title: string
  subtitle: string
  submitLabel: string
  deleteLabel: string
  defaultName: string
  namePlaceholder: string
}

export function resolveStationManageModalCopy(
  locale: Locale,
  isEdit: boolean,
): StationManageModalCopy {
  return {
    title: isEdit ? t(locale, '编辑agent', 'Edit Agent') : t(locale, '新增agent', 'Add Agent'),
    subtitle: isEdit
      ? t(
          locale,
          '更新 agent 的核心属性、角色与执行环境。',
          "Update the agent's core profile, role, and execution environment.",
        )
      : t(
          locale,
          '配置 agent 的核心属性、角色与执行环境。',
          "Configure the agent's core profile, role, and execution environment.",
        ),
    submitLabel: isEdit ? t(locale, '保存', 'Save') : t(locale, '新增agent', 'Add Agent'),
    deleteLabel: t(locale, '删除agent', 'Delete Agent'),
    defaultName: t(locale, '新agent', 'New Agent'),
    namePlaceholder: t(locale, '例如：产品agent-09', 'e.g. Product-Agent-09'),
  }
}
