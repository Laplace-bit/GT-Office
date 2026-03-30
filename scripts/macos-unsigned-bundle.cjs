function shouldRepairUnsignedMacOsBundle(details) {
  const displayOutput = details?.codesignDisplayOutput || ''
  return (
    details?.codesignVerifyStatus !== 0 ||
    /Signature=adhoc/i.test(displayOutput) ||
    /TeamIdentifier=not set/i.test(displayOutput)
  )
}

function buildAdhocCodesignArgs(appBundlePath) {
  return ['--force', '--deep', '--sign', '-', appBundlePath]
}

module.exports = {
  shouldRepairUnsignedMacOsBundle,
  buildAdhocCodesignArgs,
}
