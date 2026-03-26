const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

function loadBundleGuards() {
  const modulePath = path.join(__dirname, '..', 'tauri-bundle-guards.cjs')
  try {
    return require(modulePath)
  } catch (error) {
    assert.fail(`Expected bundle guard module at ${modulePath}: ${error.message}`)
  }
}

test('rejects Linux bundle targets on macOS hosts with an actionable error', () => {
  const { assertSupportedBundlesForHost } = loadBundleGuards()

  assert.throws(
    () => assertSupportedBundlesForHost(['build', '--bundles', 'deb,appimage'], 'darwin'),
    (error) => {
      assert.match(error.message, /Unsupported bundle target\(s\) for macOS host/i)
      assert.match(error.message, /\bdeb\b/i)
      assert.match(error.message, /\bappimage\b/i)
      assert.match(error.message, /Linux runner\/VM\/CI/i)
      assert.match(error.message, /ios, app, dmg/i)
      return true
    },
  )
})

test('allows macOS-native bundle targets on macOS hosts', () => {
  const { assertSupportedBundlesForHost } = loadBundleGuards()

  assert.doesNotThrow(() =>
    assertSupportedBundlesForHost(['build', '--bundles', 'app,dmg'], 'darwin'),
  )
})

test('wrapper exits cleanly without a Node stack trace for unsupported host bundle requests', () => {
  const scriptPath = path.join(__dirname, '..', 'run-tauri-with-env.cjs')
  const result = spawnSync(process.execPath, [scriptPath, 'build', '--bundles', 'deb,appimage'], {
    cwd: path.join(__dirname, '..', '..'),
    encoding: 'utf8',
  })

  assert.equal(result.status, 1)
  assert.match(result.stderr, /Unsupported bundle target\(s\) for macOS host/i)
  assert.doesNotMatch(result.stderr, /\bat assertSupportedBundlesForHost\b/)
})
