const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repoRoot = path.join(__dirname, '..', '..')

async function loadBumpModel() {
  return import(path.join(repoRoot, 'scripts/release/bump-model.mjs'))
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'))
}

test('release bump model uses the latest tag as the changelog base', async () => {
  const { resolveReleaseBaseTag } = await loadBumpModel()

  assert.equal(resolveReleaseBaseTag([]), null)
  assert.equal(resolveReleaseBaseTag(['v0.2.0']), 'v0.2.0')
  assert.equal(resolveReleaseBaseTag(['v0.2.0', 'v0.1.9', 'v0.1.8']), 'v0.2.0')
})

test('release bump model increments semver correctly', async () => {
  const { bumpVersion } = await loadBumpModel()

  assert.equal(bumpVersion('0.2.0', 'patch'), '0.2.1')
  assert.equal(bumpVersion('0.2.0', 'minor'), '0.3.0')
  assert.equal(bumpVersion('0.2.0', 'major'), '1.0.0')
  assert.throws(() => bumpVersion('bad', 'patch'), /Invalid semver/)
})

test('release-managed package versions stay aligned with the root version', () => {
  const rootVersion = readJson('package.json').version
  const rootLock = readJson('package-lock.json')
  const tauriVersion = readJson('apps/desktop-tauri/package.json').version
  const sharedTypesVersion = readJson('packages/shared-types/package.json').version
  const gtoVersion = readJson('tools/gto/package.json').version
  const desktopWebVersion = readJson('apps/desktop-web/package.json').version

  assert.equal(rootLock.version, rootVersion)
  assert.equal(rootLock.packages[''].version, rootVersion)
  assert.equal(rootLock.packages['apps/desktop-tauri'].version, rootVersion)
  assert.equal(rootLock.packages['packages/shared-types'].version, rootVersion)
  assert.equal(rootLock.packages['tools/gto'].version, rootVersion)
  assert.equal(tauriVersion, rootVersion)
  assert.equal(sharedTypesVersion, rootVersion)
  assert.equal(gtoVersion, rootVersion)
  assert.equal(desktopWebVersion, '0.0.0')
})

test('release bump model updates nested workspace package-lock versions', async () => {
  const { applyReleaseVersionsToPackageLock } = await loadBumpModel()

  const lock = {
    version: '0.2.0',
    packages: {
      '': { version: '0.2.0' },
      'apps/desktop-tauri': { version: '0.2.0' },
      'packages/shared-types': { version: '0.1.0' },
      'tools/gto': { version: '0.1.0' },
    },
  }

  const next = applyReleaseVersionsToPackageLock(lock, '0.2.1', [
    'apps/desktop-tauri',
    'packages/shared-types',
    'tools/gto',
  ])

  assert.equal(next.version, '0.2.1')
  assert.equal(next.packages[''].version, '0.2.1')
  assert.equal(next.packages['apps/desktop-tauri'].version, '0.2.1')
  assert.equal(next.packages['packages/shared-types'].version, '0.2.1')
  assert.equal(next.packages['tools/gto'].version, '0.2.1')
})

test('dry-run tolerates a dirty working tree and stays read-only', () => {
  const result = spawnSync('node', ['scripts/release/bump.mjs', '--dry-run'], {
    cwd: repoRoot,
    encoding: 'utf8',
  })

  assert.equal(result.status, 0, result.stderr || result.stdout)
  const output = result.stdout + result.stderr

  assert.match(output, /=== Pre-checks ===/)
  assert.match(output, /\[dry-run\] Skipping interactive prompt/)
  assert.match(output, /Working tree is clean|Working tree is not clean/)
})
