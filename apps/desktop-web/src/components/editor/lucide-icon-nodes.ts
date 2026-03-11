// Derived from lucide-react v0.577.0 icon nodes to avoid pulling react-dom/server
// into the client bundle for CodeMirror's imperative search panel DOM.

export type EditorLucideIconNode = Array<
  [tagName: string, attrs: Record<string, string>]
>

export const chevronDownIconNode: EditorLucideIconNode = [
  ['path', { d: 'm6 9 6 6 6-6' }],
]

export const chevronUpIconNode: EditorLucideIconNode = [
  ['path', { d: 'm18 15-6-6-6 6' }],
]

export const listIconNode: EditorLucideIconNode = [
  ['path', { d: 'M3 12h18' }],
  ['path', { d: 'M3 6h18' }],
  ['path', { d: 'M3 18h18' }],
]

export const replaceIconNode: EditorLucideIconNode = [
  ['path', { d: 'M14 4h6v6' }],
  ['path', { d: 'm20 4-7 7' }],
  ['path', { d: 'm3 20 7-7' }],
  ['path', { d: 'M9 20H3v-6' }],
]

export const replaceAllIconNode: EditorLucideIconNode = [
  ['path', { d: 'M14 4h6v6' }],
  ['path', { d: 'm20 4-7 7' }],
  ['path', { d: 'm3 20 7-7' }],
  ['path', { d: 'M9 20H3v-6' }],
  ['path', { d: 'M14 14h7' }],
  ['path', { d: 'M14 18h7' }],
]

export const xIconNode: EditorLucideIconNode = [
  ['path', { d: 'M18 6 6 18' }],
  ['path', { d: 'm6 6 12 12' }],
]

export const caseSensitiveIconNode: EditorLucideIconNode = [
  ['path', { d: 'm3 15 4-8 4 8' }],
  ['path', { d: 'M4 13h6' }],
  ['path', { d: 'M15 11h1a2 2 0 0 1 0 4h-1v-4Z' }],
  ['path', { d: 'M15 19h3' }],
]

export const regexIconNode: EditorLucideIconNode = [
  ['path', { d: 'M17 3v10' }],
  ['path', { d: 'm12.67 5.5 8.66 5' }],
  ['path', { d: 'm12.67 10.5 8.66-5' }],
  ['path', { d: 'M9 17a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2z' }],
]

export const wholeWordIconNode: EditorLucideIconNode = [
  ['circle', { cx: '7', cy: '12', r: '3' }],
  ['path', { d: 'M10 9v6' }],
  ['circle', { cx: '17', cy: '12', r: '3' }],
  ['path', { d: 'M14 7v8' }],
  ['path', { d: 'M22 17v1c0 .5-.5 1-1 1H3c-.5 0-1-.5-1-1v-1' }],
]
