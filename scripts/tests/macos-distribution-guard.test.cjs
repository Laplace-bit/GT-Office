const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')

function loadMacOsDistributionGuard() {
  const modulePath = path.join(__dirname, '..', 'macos-distribution-guard.cjs')
  try {
    return require(modulePath)
  } catch (error) {
    assert.fail(`Expected macOS distribution guard module at ${modulePath}: ${error.message}`)
  }
}

test('rejects ad-hoc macOS app bundles that Gatekeeper would flag as damaged', () => {
  const { assertMacOsAppBundleReadyForDistribution } = loadMacOsDistributionGuard()

  assert.throws(
    () =>
      assertMacOsAppBundleReadyForDistribution('/tmp/GT Office.app', {
        codesignVerifyStatus: 1,
        codesignVerifyOutput: 'code has no resources but signature indicates they must be present',
        codesignDisplayOutput: [
          'Signature=adhoc',
          'TeamIdentifier=not set',
          'Sealed Resources=none',
        ].join('\n'),
        spctlStatus: 1,
        spctlOutput: '/tmp/GT Office.app: rejected\nsource=no usable signature',
      }),
    (error) => {
      assert.match(error.message, /macOS release bundle is not ready for distribution/i)
      assert.match(error.message, /no usable signature/i)
      assert.match(error.message, /adhoc/i)
      assert.match(error.message, /TeamIdentifier=not set/i)
      assert.match(error.message, /GTO_ALLOW_UNSIGNED_MACOS_BUNDLE=1/i)
      return true
    },
  )
})

test('accepts macOS app bundles that pass codesign verification and Gatekeeper assessment', () => {
  const { assertMacOsAppBundleReadyForDistribution } = loadMacOsDistributionGuard()

  assert.doesNotThrow(() =>
    assertMacOsAppBundleReadyForDistribution('/tmp/GT Office.app', {
      codesignVerifyStatus: 0,
      codesignVerifyOutput: '',
      codesignDisplayOutput: [
        'Authority=Developer ID Application: Example Team',
        'TeamIdentifier=ABCDE12345',
        'Signature=Developer ID Application',
      ].join('\n'),
      spctlStatus: 0,
      spctlOutput: '/tmp/GT Office.app: accepted\nsource=Notarized Developer ID',
    }),
  )
})

test('summarizes macOS distribution issues for warning-only local builds', () => {
  const { summarizeMacOsDistributionIssues } = loadMacOsDistributionGuard()

  const summary = summarizeMacOsDistributionIssues({
    codesignVerifyStatus: 1,
    codesignVerifyOutput: 'code has no resources but signature indicates they must be present',
    codesignDisplayOutput: 'Signature=adhoc\nTeamIdentifier=not set',
    spctlStatus: 1,
    spctlOutput: 'source=no usable signature',
  })

  assert.match(summary, /codesign verify failed/i)
  assert.match(summary, /Signature=adhoc/i)
  assert.match(summary, /TeamIdentifier=not set/i)
  assert.match(summary, /no usable signature/i)
})
