const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')

const repoRoot = path.join(__dirname, '..', '..')
const generateScript = path.join(repoRoot, 'scripts/release/generate-updater-platform-manifest.cjs')
const mergeScript = path.join(repoRoot, 'scripts/release/merge-updater-manifests.cjs')

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'gto-updater-test-'))
}

test('generate-updater-platform-manifest maps signed archive assets into updater targets', () => {
  const tempDir = makeTempDir()
  const output = path.join(tempDir, 'manifest.json')
  const assetName = 'GT-Office_0.1.6_aarch64.app.tar.gz'

  fs.writeFileSync(path.join(tempDir, assetName), 'archive')
  fs.writeFileSync(path.join(tempDir, `${assetName}.sig`), 'signature-value')
  fs.writeFileSync(path.join(tempDir, 'GT-Office.dmg.sig'), 'ignored')

  execFileSync(process.execPath, [
    generateScript,
    '--assets-dir',
    tempDir,
    '--output',
    output,
    '--os',
    'darwin',
    '--arch',
    'aarch64',
    '--repo',
    'Laplace-bit/GT-Office',
    '--tag',
    'v0.1.6',
  ])

  const manifest = JSON.parse(fs.readFileSync(output, 'utf8'))
  assert.deepEqual(manifest, {
    platforms: {
      'darwin-aarch64-app': {
        url: 'https://github.com/Laplace-bit/GT-Office/releases/download/v0.1.6/GT-Office_0.1.6_aarch64.app.tar.gz',
        signature: 'signature-value',
      },
    },
  })
})

test('merge-updater-manifests falls back to default notes when release notes file is absent', () => {
  const tempDir = makeTempDir()
  const output = path.join(tempDir, 'latest.json')

  fs.writeFileSync(
    path.join(tempDir, 'updater-manifest-macos.json'),
    JSON.stringify({
      platforms: {
        'darwin-aarch64-app': {
          url: 'https://example.com/app.tar.gz',
          signature: 'sig',
        },
      },
    }),
  )

  execFileSync(process.execPath, [
    mergeScript,
    '--input-dir',
    tempDir,
    '--output',
    output,
    '--version',
    '0.1.6',
    '--notes-file',
    path.join(tempDir, 'missing-notes.md'),
  ])

  const latest = JSON.parse(fs.readFileSync(output, 'utf8'))
  assert.equal(latest.version, '0.1.6')
  assert.equal(latest.notes, 'Release 0.1.6')
  assert.deepEqual(Object.keys(latest.platforms), ['darwin-aarch64-app'])
})
