function collectMacOsDistributionIssues(details) {
  const issues = []
  const verifyOutput = details.codesignVerifyOutput || ''
  const displayOutput = details.codesignDisplayOutput || ''
  const spctlOutput = details.spctlOutput || ''

  if (details.codesignVerifyStatus !== 0) {
    issues.push(`codesign verify failed: ${verifyOutput || 'unknown verification error'}`)
  }
  if (/Signature=adhoc/i.test(displayOutput)) {
    issues.push('codesign display shows Signature=adhoc')
  }
  if (/TeamIdentifier=not set/i.test(displayOutput)) {
    issues.push('codesign display shows TeamIdentifier=not set')
  }
  if (details.spctlStatus !== 0) {
    issues.push(`Gatekeeper rejected app: ${spctlOutput || 'unknown spctl error'}`)
  }

  return issues
}

function assertMacOsAppBundleReadyForDistribution(appBundlePath, details) {
  const issues = collectMacOsDistributionIssues(details)
  if (issues.length === 0) {
    return
  }

  throw new Error(
    [
      `macOS release bundle is not ready for distribution: ${appBundlePath}`,
      ...issues.map((issue) => `- ${issue}`),
      'Sign the app with a Developer ID certificate and notarize it before publishing.',
      'If you intentionally want a local unsigned build, rerun with GTO_ALLOW_UNSIGNED_MACOS_BUNDLE=1.',
    ].join('\n'),
  )
}

module.exports = {
  assertMacOsAppBundleReadyForDistribution,
}
