import { describe, it } from 'node:test'
import assert from 'node:assert'
import { detectLanguageFromPath, type LanguageId } from '../src/components/editor/languages/language-extensions.js'

describe('language-extensions', () => {
  describe('detectLanguageFromPath', () => {
    describe('JavaScript family', () => {
      it('detects JavaScript from .js extension', () => {
        const result = detectLanguageFromPath('/path/to/file.js')
        assert.strictEqual(result, 'javascript')
      })

      it('detects JavaScript from .mjs extension', () => {
        const result = detectLanguageFromPath('/path/to/file.mjs')
        assert.strictEqual(result, 'javascript')
      })

      it('detects JavaScript from .cjs extension', () => {
        const result = detectLanguageFromPath('/path/to/file.cjs')
        assert.strictEqual(result, 'javascript')
      })

      it('detects TypeScript from .ts extension', () => {
        const result = detectLanguageFromPath('/path/to/file.ts')
        assert.strictEqual(result, 'typescript')
      })

      it('detects TypeScript from .mts extension', () => {
        const result = detectLanguageFromPath('/path/to/file.mts')
        assert.strictEqual(result, 'typescript')
      })

      it('detects TypeScript from .cts extension', () => {
        const result = detectLanguageFromPath('/path/to/file.cts')
        assert.strictEqual(result, 'typescript')
      })

      it('detects JSX from .jsx extension', () => {
        const result = detectLanguageFromPath('/path/to/component.jsx')
        assert.strictEqual(result, 'jsx')
      })

      it('detects TSX from .tsx extension', () => {
        const result = detectLanguageFromPath('/path/to/component.tsx')
        assert.strictEqual(result, 'tsx')
      })
    })

    describe('Scripting languages', () => {
      it('detects Python from .py extension', () => {
        const result = detectLanguageFromPath('/path/to/script.py')
        assert.strictEqual(result, 'python')
      })

      it('detects Python from .pyw extension', () => {
        const result = detectLanguageFromPath('/path/to/script.pyw')
        assert.strictEqual(result, 'python')
      })

      it('detects Python from .pyi extension', () => {
        const result = detectLanguageFromPath('/path/to/types.pyi')
        assert.strictEqual(result, 'python')
      })

      it('detects Ruby from .rb extension', () => {
        const result = detectLanguageFromPath('/path/to/script.rb')
        assert.strictEqual(result, 'ruby')
      })

      it('detects Lua from .lua extension', () => {
        const result = detectLanguageFromPath('/path/to/script.lua')
        assert.strictEqual(result, 'lua')
      })

      it('detects Shell from .sh extension', () => {
        const result = detectLanguageFromPath('/path/to/script.sh')
        assert.strictEqual(result, 'shell')
      })

      it('detects Shell from .bash extension', () => {
        const result = detectLanguageFromPath('/path/to/script.bash')
        assert.strictEqual(result, 'shell')
      })

      it('detects Shell from .zsh extension', () => {
        const result = detectLanguageFromPath('/path/to/script.zsh')
        assert.strictEqual(result, 'shell')
      })
    })

    describe('Systems languages', () => {
      it('detects Rust from .rs extension', () => {
        const result = detectLanguageFromPath('/path/to/main.rs')
        assert.strictEqual(result, 'rust')
      })

      it('detects Go from .go extension', () => {
        const result = detectLanguageFromPath('/path/to/main.go')
        assert.strictEqual(result, 'go')
      })

      it('detects Java from .java extension', () => {
        const result = detectLanguageFromPath('/path/to/Main.java')
        assert.strictEqual(result, 'java')
      })

      it('detects Kotlin from .kt extension', () => {
        const result = detectLanguageFromPath('/path/to/Main.kt')
        assert.strictEqual(result, 'kotlin')
      })

      it('detects Swift from .swift extension', () => {
        const result = detectLanguageFromPath('/path/to/Main.swift')
        assert.strictEqual(result, 'swift')
      })

      it('detects C from .c extension', () => {
        const result = detectLanguageFromPath('/path/to/main.c')
        assert.strictEqual(result, 'c')
      })

      it('detects C from .h extension', () => {
        const result = detectLanguageFromPath('/path/to/header.h')
        assert.strictEqual(result, 'c')
      })

      it('detects C++ from .cpp extension', () => {
        const result = detectLanguageFromPath('/path/to/main.cpp')
        assert.strictEqual(result, 'cpp')
      })

      it('detects C++ from .cc extension', () => {
        const result = detectLanguageFromPath('/path/to/main.cc')
        assert.strictEqual(result, 'cpp')
      })

      it('detects C++ from .hpp extension', () => {
        const result = detectLanguageFromPath('/path/to/header.hpp')
        assert.strictEqual(result, 'cpp')
      })

      it('detects C# from .cs extension', () => {
        const result = detectLanguageFromPath('/path/to/Program.cs')
        assert.strictEqual(result, 'csharp')
      })

      it('detects PHP from .php extension', () => {
        const result = detectLanguageFromPath('/path/to/index.php')
        assert.strictEqual(result, 'php')
      })
    })

    describe('Data formats', () => {
      it('detects JSON from .json extension', () => {
        const result = detectLanguageFromPath('/path/to/data.json')
        assert.strictEqual(result, 'json')
      })

      it('detects JSON from .jsonc extension', () => {
        const result = detectLanguageFromPath('/path/to/config.jsonc')
        assert.strictEqual(result, 'json')
      })

      it('detects JSON from .json5 extension', () => {
        const result = detectLanguageFromPath('/path/to/data.json5')
        assert.strictEqual(result, 'json')
      })

      it('detects YAML from .yaml extension', () => {
        const result = detectLanguageFromPath('/path/to/config.yaml')
        assert.strictEqual(result, 'yaml')
      })

      it('detects YAML from .yml extension', () => {
        const result = detectLanguageFromPath('/path/to/config.yml')
        assert.strictEqual(result, 'yaml')
      })

      it('detects TOML from .toml extension', () => {
        const result = detectLanguageFromPath('/path/to/Cargo.toml')
        assert.strictEqual(result, 'toml')
      })

      it('detects XML from .xml extension', () => {
        const result = detectLanguageFromPath('/path/to/data.xml')
        assert.strictEqual(result, 'xml')
      })

      it('detects SQL from .sql extension', () => {
        const result = detectLanguageFromPath('/path/to/query.sql')
        assert.strictEqual(result, 'sql')
      })
    })

    describe('Markup and styling', () => {
      it('detects Markdown from .md extension', () => {
        const result = detectLanguageFromPath('/path/to/README.md')
        assert.strictEqual(result, 'markdown')
      })

      it('detects Markdown from .mdx extension', () => {
        const result = detectLanguageFromPath('/path/to/page.mdx')
        assert.strictEqual(result, 'markdown')
      })

      it('detects Markdown from .markdown extension', () => {
        const result = detectLanguageFromPath('/path/to/README.markdown')
        assert.strictEqual(result, 'markdown')
      })

      it('detects CSS from .css extension', () => {
        const result = detectLanguageFromPath('/path/to/styles.css')
        assert.strictEqual(result, 'css')
      })

      it('detects CSS from .scss extension', () => {
        const result = detectLanguageFromPath('/path/to/styles.scss')
        assert.strictEqual(result, 'css')
      })

      it('detects CSS from .sass extension', () => {
        const result = detectLanguageFromPath('/path/to/styles.sass')
        assert.strictEqual(result, 'css')
      })

      it('detects CSS from .less extension', () => {
        const result = detectLanguageFromPath('/path/to/styles.less')
        assert.strictEqual(result, 'css')
      })

      it('detects HTML from .html extension', () => {
        const result = detectLanguageFromPath('/path/to/index.html')
        assert.strictEqual(result, 'html')
      })

      it('detects HTML from .htm extension', () => {
        const result = detectLanguageFromPath('/path/to/index.htm')
        assert.strictEqual(result, 'html')
      })
    })

    describe('Framework files', () => {
      it('detects Vue from .vue extension', () => {
        const result = detectLanguageFromPath('/path/to/component.vue')
        assert.strictEqual(result, 'vue')
      })

      it('detects Svelte from .svelte extension', () => {
        const result = detectLanguageFromPath('/path/to/component.svelte')
        assert.strictEqual(result, 'svelte')
      })
    })

    describe('Special filenames', () => {
      it('detects Dockerfile as shell', () => {
        const result = detectLanguageFromPath('/path/to/Dockerfile')
        assert.strictEqual(result, 'shell')
      })

      it('detects makefile as shell', () => {
        const result = detectLanguageFromPath('/path/to/makefile')
        assert.strictEqual(result, 'shell')
      })

      it('detects Makefile as shell', () => {
        const result = detectLanguageFromPath('/path/to/Makefile')
        assert.strictEqual(result, 'shell')
      })

      it('detects justfile as shell', () => {
        const result = detectLanguageFromPath('/path/to/justfile')
        assert.strictEqual(result, 'shell')
      })
    })

    describe('Edge cases', () => {
      it('returns plain for null path', () => {
        const result = detectLanguageFromPath(null)
        assert.strictEqual(result, 'plain')
      })

      it('returns plain for empty string', () => {
        const result = detectLanguageFromPath('')
        assert.strictEqual(result, 'plain')
      })

      it('returns plain for unknown extension', () => {
        const result = detectLanguageFromPath('/path/to/file.xyz')
        assert.strictEqual(result, 'plain')
      })

      it('handles files without extension', () => {
        const result = detectLanguageFromPath('/path/to/README')
        assert.strictEqual(result, 'plain')
      })

      it('handles files with multiple dots', () => {
        const result = detectLanguageFromPath('/path/to/file.test.ts')
        assert.strictEqual(result, 'typescript')
      })

      it('handles case-insensitive extensions', () => {
        const result = detectLanguageFromPath('/path/to/FILE.TS')
        assert.strictEqual(result, 'typescript')
      })

      it('handles case-insensitive special filenames', () => {
        const result = detectLanguageFromPath('/path/to/DOCKERFILE')
        assert.strictEqual(result, 'shell')
      })

      it('handles Windows-style paths', () => {
        const result = detectLanguageFromPath('C:\\Users\\test\\file.py')
        assert.strictEqual(result, 'python')
      })
    })
  })
})