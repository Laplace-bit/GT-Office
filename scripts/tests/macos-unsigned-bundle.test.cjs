const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

function loadUnsignedBundleHelper() {
  const modulePath = path.join(__dirname, '..', 'macos-unsigned-bundle.cjs')
  try {
    return require(modulePath)
  } catch (error) {
    assert.fail(`Expected macOS unsigned bundle helper at ${modulePath}: ${error.message}`)
  }
}

test('repairs unsigned macOS bundles when codesign verification is already broken', () => {
  const { shouldRepairUnsignedMacOsBundle } = loadUnsignedBundleHelper()

  assert.equal(
    shouldRepairUnsignedMacOsBundle({
      codesignVerifyStatus: 1,
      codesignDisplayOutput: 'Signature=adhoc\nTeamIdentifier=not set',
    }),
    true,
  )
})

test('builds the expected ad-hoc codesign command for local unsigned app bundles', () => {
  const { buildAdhocCodesignArgs } = loadUnsignedBundleHelper()

  assert.deepEqual(buildAdhocCodesignArgs('/tmp/GT Office.app'), [
    '--force',
    '--deep',
    '--sign',
    '-',
    '/tmp/GT Office.app',
  ])
})
