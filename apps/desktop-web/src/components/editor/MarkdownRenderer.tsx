import { useDeferredValue, useMemo, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { convertFileSrc } from '@tauri-apps/api/core'
import { resolveMediaPreviewPath } from '@features/file-preview/previewers/media-preview-path'

function isWindowsAbsolutePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\\?\\[A-Za-z]:[\\/]/.test(path)
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || isWindowsAbsolutePath(path)
}

function splitResourceSuffix(path: string): { pathname: string; suffix: string } {
  const hashIndex = path.indexOf('#')
  const queryIndex = path.indexOf('?')
  const cutoff =
    hashIndex === -1
      ? queryIndex
      : queryIndex === -1
        ? hashIndex
        : Math.min(hashIndex, queryIndex)

  if (cutoff === -1) {
    return { pathname: path, suffix: '' }
  }

  return {
    pathname: path.slice(0, cutoff),
    suffix: path.slice(cutoff),
  }
}

function normalizePathSeparators(path: string): string {
  return path.replace(/\\/g, '/')
}

function dirname(path: string): string {
  const normalized = normalizePathSeparators(path).replace(/\/+$/, '')
  const lastSlash = normalized.lastIndexOf('/')
  if (lastSlash < 0) {
    return ''
  }
  if (lastSlash === 0) {
    return '/'
  }
  return normalized.slice(0, lastSlash)
}

function normalizeJoinedPath(baseDir: string, relativePath: string): string {
  const normalizedBase = normalizePathSeparators(baseDir)
  const normalizedRelative = normalizePathSeparators(relativePath)
  const prefixMatch = normalizedBase.match(/^(?:[A-Za-z]:|\/\/[^/]+\/[^/]+|\/)/)
  const prefix = prefixMatch?.[0] ?? ''
  const baseWithoutPrefix = prefix ? normalizedBase.slice(prefix.length) : normalizedBase
  const parts = `${baseWithoutPrefix}/${normalizedRelative}`
    .split('/')
    .filter((part) => part.length > 0)
  const resolved: string[] = []

  for (const part of parts) {
    if (part === '.') {
      continue
    }
    if (part === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop()
      } else if (!prefix) {
        resolved.push(part)
      }
      continue
    }
    resolved.push(part)
  }

  const joined = resolved.join('/')
  if (!prefix) {
    return joined
  }
  if (prefix === '/') {
    return joined ? `/${joined}` : '/'
  }
  return joined ? `${prefix}/${joined}` : prefix
}

function safeConvertFileSrc(filePath: string): string | null {
  try {
    return convertFileSrc(filePath)
  } catch {
    return null
  }
}

function resolveMarkdownImageSource(
  src: string | undefined,
  filePath: string,
  workspaceRoot: string | null,
): string | undefined {
  const trimmed = src?.trim()
  if (!trimmed) {
    return src
  }
  if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(trimmed)) {
    return trimmed
  }

  const resolvedMarkdownPath = resolveMediaPreviewPath(workspaceRoot, filePath)
  if (!resolvedMarkdownPath) {
    return src
  }

  const { pathname, suffix } = splitResourceSuffix(trimmed)
  const localPath = isAbsolutePath(pathname)
    ? pathname
    : normalizeJoinedPath(dirname(resolvedMarkdownPath), pathname)
  const converted = safeConvertFileSrc(localPath)
  return converted ? `${converted}${suffix}` : src
}

interface MarkdownRendererProps {
  content: string
  filePath: string
  workspaceRoot: string | null
}

export function MarkdownRenderer({ content, filePath, workspaceRoot }: MarkdownRendererProps) {
  const deferredContent = useDeferredValue(content)
  const markdownComponents = useMemo(
    () => ({
      a: ({ href, children }: { href?: string; children?: ReactNode }) => {
        const isExternal = href?.startsWith('http://') || href?.startsWith('https://')
        return (
          <a
            href={href}
            target={isExternal ? '_blank' : undefined}
            rel={isExternal ? 'noopener noreferrer' : undefined}
          >
            {children}
          </a>
        )
      },
      img: ({ src, alt }: { src?: string; alt?: string }) => (
        <img
          src={resolveMarkdownImageSource(src, filePath, workspaceRoot)}
          alt={alt}
          loading="lazy"
        />
      ),
    }),
    [filePath, workspaceRoot],
  )

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeHighlight]}
      components={markdownComponents}
    >
      {deferredContent}
    </ReactMarkdown>
  )
}
