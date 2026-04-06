# CodeMirror 语言扩展实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 扩展 CodeMirror 编辑器支持 16+ 种新编程语言的语法高亮

**Architecture:** 在现有 `CodeMirrorEditor.tsx` 基础上，新增 `languages/` 模块封装所有语言扩展配置，使用 Compartment 实现动态语言切换。

**Tech Stack:** CodeMirror 6, TypeScript, React

---

## 文件结构

```
apps/desktop-web/src/components/editor/
├── index.ts                    # 导出（修改）
├── CodeMirrorEditor.tsx        # 主编辑器（修改）
├── CodeMirrorEditor.scss       # 样式（不变）
├── lucide-icon-nodes.ts        # 图标（不变）
└── languages/                  # 新建目录
    ├── index.ts                # 导出入口
    └── language-extensions.ts  # 语言扩展配置
```

---

## Task 1: 添加 CodeMirror 语言包依赖

**Files:**
- Modify: `apps/desktop-web/package.json`

- [ ] **Step 1: 添加语言包依赖到 package.json**

在 `dependencies` 中添加：

```json
"@codemirror/lang-shell": "^6.0.0",
"@codemirror/lang-yaml": "^6.0.0",
"@codemirror/lang-toml": "^6.0.0",
"@codemirror/lang-sql": "^6.0.0",
"@codemirror/lang-xml": "^6.0.0",
"@codemirror/lang-java": "^6.0.0",
"@codemirror/lang-cpp": "^6.0.0",
"@codemirror/lang-csharp": "^6.0.0",
"@codemirror/lang-go": "^6.0.0",
"@codemirror/lang-php": "^6.0.0",
"@codemirror/lang-kotlin": "^6.0.0",
"@codemirror/lang-swift": "^6.0.0",
"@codemirror/lang-ruby": "^6.0.0",
"@codemirror/lang-lua": "^6.0.0",
"@codemirror/lang-vue": "^6.0.0",
"@codemirror/lang-svelte": "^6.0.0"
```

- [ ] **Step 2: 安装依赖**

Run: `cd apps/desktop-web && pnpm install`
Expected: 所有依赖安装成功，无版本冲突

- [ ] **Step 3: 验证安装**

Run: `cd apps/desktop-web && pnpm ls @codemirror/lang-shell`
Expected: 显示 `@codemirror/lang-shell 6.x.x`

- [ ] **Step 4: 提交依赖变更**

```bash
git add apps/desktop-web/package.json apps/desktop-web/pnpm-lock.yaml
git commit -m "feat(editor): add CodeMirror language packages for 16+ languages

- Add shell, yaml, toml, sql, xml language support
- Add java, cpp, csharp, go, php language support
- Add kotlin, swift, ruby, lua language support
- Add vue, svelte framework support

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 2: 创建语言扩展模块

**Files:**
- Create: `apps/desktop-web/src/components/editor/languages/index.ts`
- Create: `apps/desktop-web/src/components/editor/languages/language-extensions.ts`

- [ ] **Step 1: 创建 languages 目录**

Run: `mkdir -p apps/desktop-web/src/components/editor/languages`

- [ ] **Step 2: 创建 language-extensions.ts**

```typescript
// language-extensions.ts
import type { Extension } from '@codemirror/state'

// 已安装的语言包（现有）
import { javascript } from '@codemirror/lang-javascript'
import { python } from '@codemirror/lang-python'
import { rust } from '@codemirror/lang-rust'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'

// 新增官方语言包
import { shell } from '@codemirror/lang-shell'
import { yaml } from '@codemirror/lang-yaml'
import { toml } from '@codemirror/lang-toml'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { java } from '@codemirror/lang-java'
import { cpp } from '@codemirror/lang-cpp'
import { csharp } from '@codemirror/lang-csharp'
import { go } from '@codemirror/lang-go'
import { php } from '@codemirror/lang-php'
import { kotlin } from '@codemirror/lang-kotlin'
import { swift } from '@codemirror/lang-swift'
import { ruby } from '@codemirror/lang-ruby'
import { lua } from '@codemirror/lang-lua'
import { vue } from '@codemirror/lang-vue'
import { svelte } from '@codemirror/lang-svelte'

/**
 * 支持的语言 ID
 */
export type LanguageId =
  // JavaScript 家族
  | 'javascript'
  | 'typescript'
  | 'jsx'
  | 'tsx'
  // 脚本语言
  | 'python'
  | 'ruby'
  | 'lua'
  | 'shell'
  // 系统语言
  | 'rust'
  | 'go'
  | 'java'
  | 'kotlin'
  | 'swift'
  | 'c'
  | 'cpp'
  | 'csharp'
  | 'php'
  // 数据格式
  | 'json'
  | 'yaml'
  | 'toml'
  | 'xml'
  | 'sql'
  // 标记语言
  | 'markdown'
  | 'html'
  | 'css'
  // 框架
  | 'vue'
  | 'svelte'
  // 默认
  | 'plain'

/**
 * 语言扩展配置映射
 */
const LANGUAGE_EXTENSIONS: Record<LanguageId, Extension> = {
  // JavaScript 家族
  javascript: javascript(),
  typescript: javascript({ typescript: true }),
  jsx: javascript({ jsx: true }),
  tsx: javascript({ jsx: true, typescript: true }),

  // 脚本语言
  python: python(),
  ruby: ruby(),
  lua: lua(),
  shell: shell(),

  // 系统语言
  rust: rust(),
  go: go(),
  java: java(),
  kotlin: kotlin(),
  swift: swift(),
  c: cpp(),
  cpp: cpp(),
  csharp: csharp(),
  php: php(),

  // 数据格式
  json: json(),
  yaml: yaml(),
  toml: toml(),
  xml: xml(),
  sql: sql(),

  // 标记语言
  markdown: markdown(),
  html: html(),
  css: css(),

  // 框架
  vue: vue(),
  svelte: svelte(),

  // 默认
  plain: [],
}

/**
 * 获取语言扩展配置
 */
export function getLanguageExtension(langId: LanguageId): Extension {
  return LANGUAGE_EXTENSIONS[langId] ?? []
}

/**
 * 扩展名到语言 ID 的映射
 */
const EXTENSION_TO_LANGUAGE: Record<string, LanguageId> = {
  // JavaScript
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',

  // TypeScript
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',

  // JSX/TSX
  jsx: 'jsx',
  tsx: 'tsx',

  // Python
  py: 'python',
  pyw: 'python',
  pyi: 'python',

  // Ruby
  rb: 'ruby',
  rbi: 'ruby',

  // Lua
  lua: 'lua',

  // Shell
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  fish: 'shell',

  // Rust
  rs: 'rust',

  // Go
  go: 'go',

  // Java
  java: 'java',

  // Kotlin
  kt: 'kotlin',
  kts: 'kotlin',

  // Swift
  swift: 'swift',

  // C/C++
  c: 'c',
  h: 'c',
  cc: 'cpp',
  cpp: 'cpp',
  hpp: 'cpp',
  cxx: 'cpp',

  // C#
  cs: 'csharp',

  // PHP
  php: 'php',

  // JSON
  json: 'json',
  jsonc: 'json',
  json5: 'json',

  // YAML
  yaml: 'yaml',
  yml: 'yaml',

  // TOML
  toml: 'toml',

  // XML
  xml: 'xml',

  // SQL
  sql: 'sql',

  // Markdown
  md: 'markdown',
  mdx: 'markdown',
  markdown: 'markdown',

  // HTML
  html: 'html',
  htm: 'html',

  // CSS
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',

  // Vue
  vue: 'vue',

  // Svelte
  svelte: 'svelte',
}

/**
 * 文件名到语言 ID 的映射
 */
const BASENAME_TO_LANGUAGE: Record<string, LanguageId> = {
  dockerfile: 'shell',
  makefile: 'shell',
  justfile: 'shell',
  procfile: 'shell',
}

/**
 * 从文件路径检测语言 ID
 */
export function detectLanguageFromPath(filePath: string | null): LanguageId {
  if (!filePath) return 'plain'

  // 提取文件名
  const normalized = filePath.replaceAll('\\', '/')
  const segments = normalized.split('/')
  const fileName = segments[segments.length - 1] || ''

  // 检查完整文件名（无扩展名）
  const baseName = fileName.toLowerCase()
  if (BASENAME_TO_LANGUAGE[baseName]) {
    return BASENAME_TO_LANGUAGE[baseName]
  }

  // 检查扩展名
  const dotIndex = baseName.lastIndexOf('.')
  if (dotIndex > 0 && dotIndex < baseName.length - 1) {
    const ext = baseName.slice(dotIndex + 1)
    if (EXTENSION_TO_LANGUAGE[ext]) {
      return EXTENSION_TO_LANGUAGE[ext]
    }
  }

  return 'plain'
}
```

- [ ] **Step 3: 创建 index.ts 导出**

```typescript
// index.ts
export {
  type LanguageId,
  getLanguageExtension,
  detectLanguageFromPath,
} from './language-extensions'
```

- [ ] **Step 4: 验证类型检查**

Run: `cd apps/desktop-web && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 5: 提交语言模块**

```bash
git add apps/desktop-web/src/components/editor/languages/
git commit -m "feat(editor): create language extensions module with 16+ languages

- Define LanguageId type for all supported languages
- Implement detectLanguageFromPath for file-based detection
- Map file extensions and basenames to language IDs
- Export getLanguageExtension for CodeMirror configuration

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 3: 集成到 CodeMirrorEditor

**Files:**
- Modify: `apps/desktop-web/src/components/editor/CodeMirrorEditor.tsx`
- Modify: `apps/desktop-web/src/components/editor/index.ts`

- [ ] **Step 1: 更新 CodeMirrorEditor.tsx 导入**

在文件顶部，替换现有的语言导入：

```typescript
// 替换现有导入
// import { javascript } from '@codemirror/lang-javascript'
// import { python } from '@codemirror/lang-python'
// ... 其他语言导入

// 使用新的语言模块
import {
  detectLanguageFromPath,
  getLanguageExtension,
  type LanguageId,
} from './languages'
```

- [ ] **Step 2: 移除旧的 detectLanguage 和 getLanguageExtension**

删除文件中的以下旧函数：
- `detectLanguage` 函数（约 74-88 行）
- `getLanguageExtension` 函数（约 90-102 行）
- `LanguageId` 类型定义（约 65 行）

- [ ] **Step 3: 更新编辑器初始化**

在 `useEffect` 中，更新语言配置：

```typescript
// 初始化编辑器 - 只执行一次
useEffect(() => {
  const container = containerRef.current
  if (!container || viewRef.current) return

  const langId = detectLanguageFromPath(filePathRef.current)
  const langExt = getLanguageExtension(langId)

  const extensions: Extension[] = [
    minimalSetup,
    themeExtension,
    languageCompartment.current.of(langExt ?? []),
    // ... 其他配置
  ]

  // ... 其余代码不变
}, [])
```

- [ ] **Step 4: 更新文件路径变化处理**

在监听 `filePath` 变化的 `useEffect` 中：

```typescript
// 文件路径变化时更新语言（不重建编辑器）
useEffect(() => {
  const view = viewRef.current
  if (!view || filePath === filePathRef.current) return

  filePathRef.current = filePath
  const langId = detectLanguageFromPath(filePath)
  const langExt = getLanguageExtension(langId)

  view.dispatch({
    effects: languageCompartment.current.reconfigure(langExt ?? []),
  })
}, [filePath])
```

- [ ] **Step 5: 更新 index.ts 导出**

```typescript
// index.ts
export * from './CodeMirrorEditor'
export * from './languages'
```

- [ ] **Step 6: 验证类型检查**

Run: `cd apps/desktop-web && pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 7: 运行开发服务器测试**

Run: `cd apps/desktop-web && pnpm dev`
Expected: 开发服务器启动成功

- [ ] **Step 8: 提交集成变更**

```bash
git add apps/desktop-web/src/components/editor/
git commit -m "feat(editor): integrate language extensions module into CodeMirrorEditor

- Replace inline language detection with module-based approach
- Use detectLanguageFromPath and getLanguageExtension from languages/
- Remove duplicate language configuration from CodeMirrorEditor.tsx
- Update exports to include language module

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>"
```

---

## Task 4: 验证和测试

**Files:**
- 无新文件

- [ ] **Step 1: 创建测试文件验证语言高亮**

在项目目录创建临时测试文件（不提交）：

```bash
# 创建测试文件
echo 'console.log("hello")' > /tmp/test.js
echo 'def hello(): pass' > /tmp/test.py
echo 'fn main() {}' > /tmp/test.rs
echo 'package main' > /tmp/test.go
echo 'func main() {}' > /tmp/test.go
```

- [ ] **Step 2: 运行完整构建**

Run: `pnpm build:tauri`
Expected: 构建成功，无错误

- [ ] **Step 3: 运行类型检查**

Run: `pnpm typecheck`
Expected: 无类型错误

- [ ] **Step 4: 运行 lint**

Run: `pnpm lint`
Expected: 无 lint 错误（或仅有 warning）

---

## 验收标准

- [ ] 所有 16+ 新语言包正确安装
- [ ] `detectLanguageFromPath` 正确识别文件类型
- [ ] `getLanguageExtension` 返回正确的 CodeMirror 扩展
- [ ] CodeMirrorEditor 正确加载语言扩展
- [ ] 类型检查通过
- [ ] 构建成功