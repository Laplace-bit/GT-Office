import { t, type Locale } from '@shell/i18n/ui-locale'
import { MarkdownRenderer } from '@/components/editor'
import type { DesignerBlock } from '../model/designer-blocks'
import { designerBlockKindLabel } from '../model/designer-block-labels'
import { DesignerScreenPreview } from './DesignerScreenPreview'

interface DesignerDocumentProps {
  locale: Locale
  workspaceRoot: string | null
  title: string
  onTitleChange: (title: string) => void
  briefMarkdown: string
  onBriefChange: (markdown: string) => void
  agentBlocks: DesignerBlock[]
  /** When true the editor is mounted read-only (e.g. while a document loads). */
  readOnly?: boolean
}

type JsonRecord = Record<string, unknown>

function asRecord(payload: unknown): JsonRecord {
  return typeof payload === 'object' && payload !== null && !Array.isArray(payload)
    ? (payload as JsonRecord)
    : {}
}

function str(payload: unknown, key: string): string {
  const value = asRecord(payload)[key]
  return typeof value === 'string' ? value : ''
}

function strList(payload: unknown, key: string): string[] {
  const value = asRecord(payload)[key]
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string')
  }
  if (typeof value === 'string') {
    return value
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }
  return []
}

function recordList(payload: unknown, key: string): JsonRecord[] {
  const value = asRecord(payload)[key]
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is JsonRecord => typeof item === 'object' && item !== null && !Array.isArray(item))
}

function field(record: JsonRecord, key: string): string {
  const value = record[key]
  return typeof value === 'string' ? value : ''
}

function boolField(record: JsonRecord, key: string): boolean {
  const value = record[key]
  if (typeof value === 'boolean') {
    return value
  }
  if (typeof value === 'string') {
    return value.toLowerCase() === 'true'
  }
  return false
}

/** Compile an Agent-produced structured block into stable Markdown so it can be
 * rendered read-only inline. The block's title drives the heading. */
function blockToMarkdown(locale: Locale, block: DesignerBlock): string {
  const heading = block.title || designerBlockKindLabel(locale, block.kind)
  const lines: string[] = [`### ${heading}`]
  switch (block.kind) {
    case 'text':
    case 'agentInstruction':
    case 'pseudocode': {
      const body = str(block.payload, 'markdown') || str(block.payload, 'instructions')
      if (body) {
        lines.push(body)
      }
      break
    }
    case 'openQuestions': {
      const questions = strList(block.payload, 'questions')
      if (questions.length) {
        lines.push(questions.map((question) => `- ❓ ${question}`).join('\n'))
      }
      break
    }
    case 'acceptanceCriteria': {
      const criteria = strList(block.payload, 'criteria')
      if (criteria.length) {
        lines.push(criteria.map((criterion) => `- ✅ ${criterion}`).join('\n'))
      }
      break
    }
    case 'technicalStack':
    case 'nonFunctional': {
      const items = strList(block.payload, 'items')
      if (items.length) {
        lines.push(items.map((item) => `- ${item}`).join('\n'))
      }
      break
    }
    case 'glossary': {
      const terms = recordList(block.payload, 'terms')
      if (terms.length) {
        lines.push(
          terms
            .map((term) => `- **${field(term, 'term')}** — ${field(term, 'definition')}`)
            .join('\n'),
        )
      }
      break
    }
    case 'entityModel': {
      const entityName = str(block.payload, 'entityName')
      const fields = recordList(block.payload, 'fields')
      if (entityName) {
        lines.push(`**${entityName}**`)
      }
      if (fields.length) {
        lines.push('')
        lines.push('| field | type | required | description |')
        lines.push('| --- | --- | --- | --- |')
        for (const record of fields) {
          const required = boolField(record, 'required') ? '✓' : ''
          lines.push(
            `| ${field(record, 'name')} | ${field(record, 'type')} | ${required} | ${field(record, 'description')} |`,
          )
        }
      }
      break
    }
    case 'apiContract': {
      const endpoints = recordList(block.payload, 'endpoints')
      const events = strList(block.payload, 'events')
      if (endpoints.length) {
        lines.push('')
        lines.push('| method | path | description |')
        lines.push('| --- | --- | --- |')
        for (const endpoint of endpoints) {
          lines.push(
            `| \`${field(endpoint, 'method')}\` | \`${field(endpoint, 'path')}\` | ${field(endpoint, 'description')} |`,
          )
        }
      }
      if (events.length) {
        lines.push('')
        lines.push(`**${t(locale, 'designer.section.events')}**`)
        lines.push(events.map((event) => `- \`${event}\``).join('\n'))
      }
      break
    }
    case 'businessFlow': {
      const states = strList(block.payload, 'states')
      const transitions = recordList(block.payload, 'transitions')
      if (states.length) {
        lines.push(
          `${t(locale, 'designer.section.states')}: ${states.map((state) => `\`${state}\``).join(' → ')}`,
        )
      }
      if (transitions.length) {
        lines.push('')
        lines.push('| from | event | to | guard |')
        lines.push('| --- | --- | --- | --- |')
        for (const transition of transitions) {
          lines.push(
            `| ${field(transition, 'from')} | ${field(transition, 'event')} | ${field(transition, 'to')} | ${field(transition, 'guard')} |`,
          )
        }
      }
      break
    }
    case 'ruleTable': {
      const rules = recordList(block.payload, 'rules')
      if (rules.length) {
        lines.push('| when | then |')
        lines.push('| --- | --- |')
        for (const rule of rules) {
          lines.push(`| ${field(rule, 'condition')} | ${field(rule, 'action')} |`)
        }
      }
      break
    }
    case 'dataContract': {
      const schema = asRecord(block.payload).schema
      if (schema) {
        const text = typeof schema === 'string' ? schema : JSON.stringify(schema, null, 2)
        lines.push('```json')
        lines.push(text)
        lines.push('```')
      }
      break
    }
    case 'decisionRecord': {
      const context = str(block.payload, 'context')
      const decision = str(block.payload, 'decision')
      const consequences = str(block.payload, 'consequences')
      if (context) {
        lines.push(`**${t(locale, 'designer.section.context')}**\n\n${context}`)
      }
      if (decision) {
        lines.push(`**${t(locale, 'designer.section.decision')}**\n\n${decision}`)
      }
      if (consequences) {
        lines.push(`**${t(locale, 'designer.section.consequences')}**\n\n${consequences}`)
      }
      break
    }
    case 'uiWorkflow':
    case 'objectModel': {
      // free-form structured payload: render as fenced JSON for transparency
      lines.push('```json')
      lines.push(JSON.stringify(block.payload, null, 2))
      lines.push('```')
      break
    }
    default:
      break
  }
  return lines.join('\n')
}

export function DesignerDocument({
  locale,
  workspaceRoot,
  title,
  onTitleChange,
  briefMarkdown,
  onBriefChange,
  agentBlocks,
  readOnly = false,
}: DesignerDocumentProps) {
  return (
    <section className="designer-document" aria-label={t(locale, 'designer.document')}>
      <input
        type="text"
        className="designer-document-title"
        value={title}
        placeholder={t(locale, 'designer.untitled')}
        onChange={(event) => onTitleChange(event.target.value)}
        spellCheck={false}
        aria-label={t(locale, 'designer.documentTitle')}
      />
      <div className="designer-brief-editor">
        <textarea
          className="designer-brief-textarea"
          value={briefMarkdown}
          placeholder={t(locale, 'designer.briefPlaceholder')}
          onChange={(event) => onBriefChange(event.target.value)}
          readOnly={readOnly}
          spellCheck
          aria-label={t(locale, 'designer.brief')}
        />
      </div>
      {agentBlocks.length > 0 ? (
        <div className="designer-agent-sections" aria-label={t(locale, 'designer.agentSections')}>
          <p className="designer-agent-sections-label">
            {t(locale, 'designer.agentSectionsHint')}
          </p>
          {agentBlocks.map((block) => {
            if (block.kind === 'uiScreen') {
              const html = str(block.payload, 'html') ?? ''
              return (
                <article key={block.id} className="designer-agent-section">
                  <DesignerScreenPreview html={html} locale={locale} />
                </article>
              )
            }
            const markdown = blockToMarkdown(locale, block)
            return (
              <article key={block.id} className="designer-agent-section">
                <MarkdownRenderer
                  content={markdown}
                  filePath={`${block.id}.md`}
                  workspaceRoot={workspaceRoot}
                />
              </article>
            )
          })}
        </div>
      ) : null}
    </section>
  )
}
