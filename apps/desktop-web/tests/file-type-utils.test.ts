import { describe, it } from 'node:test'
import assert from 'node:assert'
import { categorizeFile, isMediaFile, isPreviewable } from '../src/features/file-preview/utils/file-type-utils.js'

describe('file-type-utils', () => {
  describe('categorizeFile', () => {
    it('categorizes JavaScript files as code', () => {
      const result = categorizeFile('/path/to/file.js')
      assert.strictEqual(result.category, 'code')
      assert.strictEqual(result.extension, 'js')
    })

    it('categorizes TypeScript files as code', () => {
      const result = categorizeFile('/path/to/file.ts')
      assert.strictEqual(result.category, 'code')
      assert.strictEqual(result.extension, 'ts')
    })

    it('categorizes TSX files as code', () => {
      const result = categorizeFile('/path/to/component.tsx')
      assert.strictEqual(result.category, 'code')
      assert.strictEqual(result.extension, 'tsx')
    })

    it('categorizes Python files as code', () => {
      const result = categorizeFile('/path/to/script.py')
      assert.strictEqual(result.category, 'code')
      assert.strictEqual(result.extension, 'py')
    })

    it('categorizes Rust files as code', () => {
      const result = categorizeFile('/path/to/main.rs')
      assert.strictEqual(result.category, 'code')
      assert.strictEqual(result.extension, 'rs')
    })

    it('categorizes Go files as code', () => {
      const result = categorizeFile('/path/to/main.go')
      assert.strictEqual(result.category, 'code')
      assert.strictEqual(result.extension, 'go')
    })

    it('categorizes Java files as code', () => {
      const result = categorizeFile('/path/to/Main.java')
      assert.strictEqual(result.category, 'code')
      assert.strictEqual(result.extension, 'java')
    })

    it('categorizes C++ files as code', () => {
      const result = categorizeFile('/path/to/main.cpp')
      assert.strictEqual(result.category, 'code')
      assert.strictEqual(result.extension, 'cpp')
    })

    it('categorizes Shell files as code', () => {
      const result = categorizeFile('/path/to/script.sh')
      assert.strictEqual(result.category, 'code')
      assert.strictEqual(result.extension, 'sh')
    })

    it('categorizes YAML files as code', () => {
      const result = categorizeFile('/path/to/config.yaml')
      assert.strictEqual(result.category, 'code')
      assert.strictEqual(result.extension, 'yaml')
    })

    it('categorizes JSON files as code', () => {
      const result = categorizeFile('/path/to/data.json')
      assert.strictEqual(result.category, 'code')
      assert.strictEqual(result.extension, 'json')
    })

    it('categorizes Markdown files as markdown', () => {
      const result = categorizeFile('/path/to/README.md')
      assert.strictEqual(result.category, 'markdown')
      assert.strictEqual(result.extension, 'md')
    })

    it('categorizes MDX files as markdown', () => {
      const result = categorizeFile('/path/to/page.mdx')
      assert.strictEqual(result.category, 'markdown')
      assert.strictEqual(result.extension, 'mdx')
    })

    it('categorizes PNG files as image', () => {
      const result = categorizeFile('/path/to/image.png')
      assert.strictEqual(result.category, 'image')
      assert.strictEqual(result.extension, 'png')
    })

    it('categorizes JPG files as image', () => {
      const result = categorizeFile('/path/to/photo.jpg')
      assert.strictEqual(result.category, 'image')
      assert.strictEqual(result.extension, 'jpg')
    })

    it('categorizes GIF files as image', () => {
      const result = categorizeFile('/path/to/animation.gif')
      assert.strictEqual(result.category, 'image')
      assert.strictEqual(result.extension, 'gif')
    })

    it('categorizes SVG files as image', () => {
      const result = categorizeFile('/path/to/icon.svg')
      assert.strictEqual(result.category, 'image')
      assert.strictEqual(result.extension, 'svg')
    })

    it('categorizes WebP files as image', () => {
      const result = categorizeFile('/path/to/pic.webp')
      assert.strictEqual(result.category, 'image')
      assert.strictEqual(result.extension, 'webp')
    })

    it('categorizes MP4 files as video', () => {
      const result = categorizeFile('/path/to/video.mp4')
      assert.strictEqual(result.category, 'video')
      assert.strictEqual(result.extension, 'mp4')
    })

    it('categorizes WebM files as video', () => {
      const result = categorizeFile('/path/to/clip.webm')
      assert.strictEqual(result.category, 'video')
      assert.strictEqual(result.extension, 'webm')
    })

    it('categorizes MOV files as video', () => {
      const result = categorizeFile('/path/to/movie.mov')
      assert.strictEqual(result.category, 'video')
      assert.strictEqual(result.extension, 'mov')
    })

    it('categorizes MP3 files as audio', () => {
      const result = categorizeFile('/path/to/song.mp3')
      assert.strictEqual(result.category, 'audio')
      assert.strictEqual(result.extension, 'mp3')
    })

    it('categorizes WAV files as audio', () => {
      const result = categorizeFile('/path/to/sound.wav')
      assert.strictEqual(result.category, 'audio')
      assert.strictEqual(result.extension, 'wav')
    })

    it('categorizes FLAC files as audio', () => {
      const result = categorizeFile('/path/to/lossless.flac')
      assert.strictEqual(result.category, 'audio')
      assert.strictEqual(result.extension, 'flac')
    })

    it('categorizes PDF files as pdf', () => {
      const result = categorizeFile('/path/to/document.pdf')
      assert.strictEqual(result.category, 'pdf')
      assert.strictEqual(result.extension, 'pdf')
    })

    it('categorizes EXE files as binary', () => {
      const result = categorizeFile('/path/to/program.exe')
      assert.strictEqual(result.category, 'binary')
      assert.strictEqual(result.extension, 'exe')
    })

    it('categorizes unknown files as unknown', () => {
      const result = categorizeFile('/path/to/file.xyz')
      assert.strictEqual(result.category, 'unknown')
      assert.strictEqual(result.extension, 'xyz')
    })

    it('handles null path gracefully', () => {
      const result = categorizeFile(null)
      assert.strictEqual(result.category, 'unknown')
      assert.strictEqual(result.extension, '')
    })

    it('handles empty string path', () => {
      const result = categorizeFile('')
      assert.strictEqual(result.category, 'unknown')
      assert.strictEqual(result.extension, '')
    })

    it('handles paths with multiple dots', () => {
      const result = categorizeFile('/path/to/file.test.ts')
      assert.strictEqual(result.category, 'code')
      assert.strictEqual(result.extension, 'ts')
    })

    it('handles Windows-style paths', () => {
      const result = categorizeFile('C:\\Users\\file.py')
      assert.strictEqual(result.category, 'code')
      assert.strictEqual(result.extension, 'py')
    })
  })

  describe('isMediaFile', () => {
    it('returns true for image files', () => {
      assert.strictEqual(isMediaFile('/path/to/image.png'), true)
      assert.strictEqual(isMediaFile('/path/to/photo.jpg'), true)
      assert.strictEqual(isMediaFile('/path/to/icon.svg'), true)
    })

    it('returns true for video files', () => {
      assert.strictEqual(isMediaFile('/path/to/video.mp4'), true)
      assert.strictEqual(isMediaFile('/path/to/clip.webm'), true)
    })

    it('returns true for audio files', () => {
      assert.strictEqual(isMediaFile('/path/to/song.mp3'), true)
      assert.strictEqual(isMediaFile('/path/to/sound.wav'), true)
    })

    it('returns false for code files', () => {
      assert.strictEqual(isMediaFile('/path/to/script.py'), false)
      assert.strictEqual(isMediaFile('/path/to/index.js'), false)
    })

    it('returns false for markdown files', () => {
      assert.strictEqual(isMediaFile('/path/to/README.md'), false)
    })

    it('returns false for PDF files', () => {
      assert.strictEqual(isMediaFile('/path/to/document.pdf'), false)
    })

    it('returns false for null path', () => {
      assert.strictEqual(isMediaFile(null), false)
    })
  })

  describe('isPreviewable', () => {
    it('returns true for image files', () => {
      assert.strictEqual(isPreviewable('/path/to/image.png'), true)
    })

    it('returns true for video files', () => {
      assert.strictEqual(isPreviewable('/path/to/video.mp4'), true)
    })

    it('returns true for audio files', () => {
      assert.strictEqual(isPreviewable('/path/to/song.mp3'), true)
    })

    it('returns true for PDF files', () => {
      assert.strictEqual(isPreviewable('/path/to/document.pdf'), true)
    })

    it('returns true for Markdown files', () => {
      assert.strictEqual(isPreviewable('/path/to/README.md'), true)
    })

    it('returns false for code files', () => {
      assert.strictEqual(isPreviewable('/path/to/script.py'), false)
      assert.strictEqual(isPreviewable('/path/to/index.js'), false)
    })

    it('returns false for unknown files', () => {
      assert.strictEqual(isPreviewable('/path/to/file.xyz'), false)
    })

    it('returns false for null path', () => {
      assert.strictEqual(isPreviewable(null), false)
    })
  })
})