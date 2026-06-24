import { t, type Locale, type TranslationKey } from '@shell/i18n/ui-locale'
import type { DesignerBlockKind } from './designer-blocks'

const BLOCK_TITLE_KEYS: Partial<Record<DesignerBlockKind, TranslationKey>> = {
  entityModel: 'designer.section.entityModel',
  apiContract: 'designer.section.apiContract',
  businessFlow: 'designer.section.businessFlow',
  acceptanceCriteria: 'designer.section.acceptanceCriteria',
  openQuestions: 'designer.section.openQuestions',
  glossary: 'designer.section.glossary',
  ruleTable: 'designer.section.ruleTable',
  objectModel: 'designer.section.objectModel',
  dataContract: 'designer.section.dataContract',
  technicalStack: 'designer.section.technicalStack',
  nonFunctional: 'designer.section.nonFunctional',
  decisionRecord: 'designer.section.decisionRecord',
  pseudocode: 'designer.section.pseudocode',
  uiWorkflow: 'designer.section.uiWorkflow',
  agentInstruction: 'designer.section.agentInstruction',
  text: 'designer.section.text',
}

export function designerBlockKindLabel(locale: Locale, kind: DesignerBlockKind | string): string {
  const key = BLOCK_TITLE_KEYS[kind as DesignerBlockKind]
  if (key) {
    return t(locale, key)
  }
  return t(locale, kind, kind)
}
