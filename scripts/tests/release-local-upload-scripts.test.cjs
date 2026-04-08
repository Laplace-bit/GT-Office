const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const repoRoot = path.join(__dirname, '..', '..')

function readScript(relativePath) {
  const fullPath = path.join(repoRoot, relativePath)
  assert.ok(fs.existsSync(fullPath), `Expected script at ${fullPath}`)
  return fs.readFileSync(fullPath, 'utf8')
}

test('windows release helper accepts parameters and builds NSIS assets before uploading', () => {
  const script = readScript('scripts/release/build-and-upload-windows.ps1')

  assert.match(script, /param\s*\(/i)
  assert.match(script, /\[string\]\$Tag/i)
  assert.match(script, /\[string\]\$Repo/i)
  assert.match(script, /build --bundles nsis/i)
  assert.match(script, /gh release view/i)
  assert.match(script, /gh release create/i)
  assert.match(script, /gh release upload/i)
  assert.match(script, /\.exe/i)
})

test('linux release helper accepts parameters and builds deb assets before uploading', () => {
  const script = readScript('scripts/release/build-and-upload-linux.sh')

  assert.match(script, /TAG=/)
  assert.match(script, /REPO=/)
  assert.match(script, /--bundles appimage,deb/i)
  assert.match(script, /gh release view/i)
  assert.match(script, /gh release create/i)
  assert.match(script, /gh release upload/i)
  assert.match(script, /\.deb/i)
})
