const hostDisplayNames = {
  darwin: 'macOS',
  linux: 'Linux',
  win32: 'Windows',
}

const supportedBundlesByHost = {
  darwin: ['ios', 'app', 'dmg'],
  linux: ['deb', 'rpm', 'appimage'],
  win32: ['msi', 'nsis'],
}

const bundleHostMap = {
  ios: 'darwin',
  app: 'darwin',
  dmg: 'darwin',
  deb: 'linux',
  rpm: 'linux',
  appimage: 'linux',
  msi: 'win32',
  nsis: 'win32',
}

function normalizeBundleValue(rawValue) {
  if (typeof rawValue !== 'string') {
    return []
  }

  return rawValue
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0)
}

function collectRequestedBundles(args) {
  const requestedBundles = []

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--bundles' || arg === '-b') {
      let nextIndex = index + 1
      while (nextIndex < args.length) {
        const nextArg = args[nextIndex]
        if (typeof nextArg === 'string' && nextArg.startsWith('-')) {
          break
        }
        requestedBundles.push(...normalizeBundleValue(nextArg))
        nextIndex += 1
      }
      index = nextIndex - 1
      continue
    }

    if (typeof arg !== 'string') {
      continue
    }

    if (arg.startsWith('--bundles=')) {
      requestedBundles.push(...normalizeBundleValue(arg.slice('--bundles='.length)))
      continue
    }

    if (arg.startsWith('-b=')) {
      requestedBundles.push(...normalizeBundleValue(arg.slice(3)))
      continue
    }

    if (arg.startsWith('-b') && arg.length > 2) {
      requestedBundles.push(...normalizeBundleValue(arg.slice(2)))
    }
  }

  return Array.from(new Set(requestedBundles))
}

function resolveHostDisplayName(hostPlatform) {
  return hostDisplayNames[hostPlatform] ?? hostPlatform
}

function buildUnsupportedBundleMessage(hostPlatform, unsupportedBundles) {
  const supportedBundles = supportedBundlesByHost[hostPlatform] ?? []
  const targetHosts = Array.from(
    new Set(
      unsupportedBundles
        .map((bundle) => bundleHostMap[bundle])
        .filter((platform) => typeof platform === 'string'),
    ),
  )

  const hostName = resolveHostDisplayName(hostPlatform)
  const messageParts = [
    `[GT Office] Unsupported bundle target(s) for ${hostName} host: ${unsupportedBundles.join(', ')}.`,
  ]

  if (supportedBundles.length > 0) {
    messageParts.push(`[GT Office] This Tauri CLI build only supports: ${supportedBundles.join(', ')}.`)
  }

  if (targetHosts.length === 1) {
    const targetHostName = resolveHostDisplayName(targetHosts[0])
    messageParts.push(`[GT Office] Build ${targetHostName} bundles on a ${targetHostName} runner/VM/CI.`)
  } else if (targetHosts.length > 1) {
    const targetHostNames = targetHosts.map((platform) => resolveHostDisplayName(platform))
    messageParts.push(
      `[GT Office] Requested bundles span multiple host platforms (${targetHostNames.join(
        ', ',
      )}); build each installer family on its matching runner/VM/CI.`,
    )
  }

  if (hostPlatform === 'darwin') {
    messageParts.push('[GT Office] For local macOS artifacts, use the default build flow or pass `--bundles app`.')
  }

  return messageParts.join(' ')
}

function assertSupportedBundlesForHost(args, hostPlatform = process.platform) {
  const requestedBundles = collectRequestedBundles(args)
  if (requestedBundles.length === 0) {
    return
  }

  const supportedBundles = supportedBundlesByHost[hostPlatform]
  if (!supportedBundles) {
    return
  }

  const unsupportedBundles = requestedBundles.filter((bundle) => !supportedBundles.includes(bundle))
  if (unsupportedBundles.length === 0) {
    return
  }

  const error = new Error(buildUnsupportedBundleMessage(hostPlatform, unsupportedBundles))
  error.code = 'UNSUPPORTED_BUNDLE_TARGETS'
  error.hostPlatform = hostPlatform
  error.requestedBundles = requestedBundles
  error.unsupportedBundles = unsupportedBundles
  throw error
}

module.exports = {
  assertSupportedBundlesForHost,
  collectRequestedBundles,
  supportedBundlesByHost,
}
