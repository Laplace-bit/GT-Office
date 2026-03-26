#!/usr/bin/env node

const fs = require('node:fs')
const net = require('node:net')
const os = require('node:os')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')
const { assertSupportedBundlesForHost } = require('./tauri-bundle-guards.cjs')

const repoRoot = path.resolve(__dirname, '..')
const workspacePath = path.join(repoRoot, 'apps', 'desktop-tauri')
const ensureScriptPath = path.join(__dirname, 'ensure-tauri-cli-binding.cjs')
const sidecarBuildScriptPath = path.join(__dirname, 'build-mcp-sidecar.cjs')
const frontendPortDefault = 5173
const frontendPortScanMax = 50

function runNodeScript(scriptPath, extraArgs, env) {
  const result = spawnSync(process.execPath, [scriptPath, ...extraArgs], {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    env,
  })
  return result
}

function hasCargo(env) {
  const result = spawnSync('cargo', ['--version'], {
    cwd: workspacePath,
    stdio: 'ignore',
    shell: false,
    env,
  })
  return result.status === 0
}

function collectCargoBinCandidates() {
  const candidates = []
  if (process.platform === 'win32') {
    if (process.env.USERPROFILE) {
      candidates.push(path.join(process.env.USERPROFILE, '.cargo', 'bin'))
    }
    if (process.env.HOMEDRIVE && process.env.HOMEPATH) {
      candidates.push(path.join(`${process.env.HOMEDRIVE}${process.env.HOMEPATH}`, '.cargo', 'bin'))
    }
  } else {
    if (process.env.HOME) {
      candidates.push(path.join(process.env.HOME, '.cargo', 'bin'))
    }
  }
  return Array.from(new Set(candidates))
}

function ensureCargoEnv(baseEnv) {
  if (hasCargo(baseEnv)) {
    return baseEnv
  }

  const nextEnv = { ...baseEnv }
  const pathKey = process.platform === 'win32' ? 'Path' : 'PATH'
  const separator = process.platform === 'win32' ? ';' : ':'
  const currentPath = nextEnv[pathKey] || nextEnv.PATH || ''

  for (const dir of collectCargoBinCandidates()) {
    const cargoBinary = process.platform === 'win32' ? path.join(dir, 'cargo.exe') : path.join(dir, 'cargo')
    if (!fs.existsSync(cargoBinary)) {
      continue
    }
    nextEnv[pathKey] = currentPath.length > 0 ? `${dir}${separator}${currentPath}` : dir
    if (pathKey !== 'PATH') {
      nextEnv.PATH = nextEnv[pathKey]
    }
    if (hasCargo(nextEnv)) {
      return nextEnv
    }
  }

  return null
}

function failWithCargoHint() {
  const installHint =
    process.platform === 'win32'
      ? 'Install Rust from https://rustup.rs and reopen terminal, or ensure %USERPROFILE%\\.cargo\\bin is in PATH.'
      : 'Install Rust from https://rustup.rs and ensure ~/.cargo/bin is in PATH.'
  console.error(`[GT Office] cargo not found. ${installHint}`)
  process.exit(1)
}

function resolvePlatformTargetDir() {
  if (process.platform === 'win32') {
    return 'windows'
  }
  if (process.platform === 'darwin') {
    return 'macos'
  }
  return 'linux'
}

function ensureCargoTargetDir(baseEnv) {
  const nextEnv = { ...baseEnv }
  const existing = nextEnv.CARGO_TARGET_DIR
  if (typeof existing === 'string' && existing.trim().length > 0) {
    return nextEnv
  }
  nextEnv.CARGO_TARGET_DIR = path.join(repoRoot, 'target', resolvePlatformTargetDir())
  return nextEnv
}

function stripWindowsLongPathPrefix(value) {
  if (typeof value !== 'string') {
    return value
  }
  if (value.startsWith('\\\\?\\')) {
    return value.slice(4)
  }
  return value
}

function normalizePathForCompare(value) {
  const normalized = path.resolve(stripWindowsLongPathPrefix(value))
  if (process.platform === 'win32') {
    return normalized.toLowerCase()
  }
  return normalized
}

function isPathWithin(parentPath, childPath) {
  const parent = normalizePathForCompare(parentPath)
  const child = normalizePathForCompare(childPath)
  if (parent === child) {
    return true
  }
  const relative = path.relative(parent, child)
  return relative.length > 0 && !relative.startsWith('..') && !path.isAbsolute(relative)
}

function collectStaleTauriBuildEntries(targetDir) {
  const buildRoot = path.join(targetDir, 'debug', 'build')
  if (!fs.existsSync(buildRoot)) {
    return []
  }

  const watchedPrefixes = ['tauri-', 'gtoffice-desktop-tauri-']
  const staleEntries = []

  for (const entry of fs.readdirSync(buildRoot, { withFileTypes: true })) {
    if (!entry.isDirectory() || !watchedPrefixes.some((prefix) => entry.name.startsWith(prefix))) {
      continue
    }

    const rootOutputPath = path.join(buildRoot, entry.name, 'root-output')
    if (!fs.existsSync(rootOutputPath)) {
      continue
    }

    const firstLine = fs.readFileSync(rootOutputPath, 'utf8').split(/\r?\n/, 1)[0]?.trim()
    if (!firstLine) {
      continue
    }

    if (!isPathWithin(targetDir, firstLine)) {
      staleEntries.push(entry.name)
    }
  }

  return staleEntries
}

function pruneTauriBuildCache(rootDir, prefixes) {
  if (!fs.existsSync(rootDir)) {
    return 0
  }

  let removed = 0
  for (const name of fs.readdirSync(rootDir)) {
    if (!prefixes.some((prefix) => name.startsWith(prefix))) {
      continue
    }
    fs.rmSync(path.join(rootDir, name), { recursive: true, force: true })
    removed += 1
  }
  return removed
}

function pruneStaleMacOsDmgIntermediates(targetDir) {
  if (process.platform !== 'darwin') {
    return 0
  }

  const profileDirs = ['debug', 'release']
  let removed = 0

  for (const profileDir of profileDirs) {
    const macOsBundleDir = path.join(targetDir, profileDir, 'bundle', 'macos')
    if (!fs.existsSync(macOsBundleDir)) {
      continue
    }

    for (const entry of fs.readdirSync(macOsBundleDir, { withFileTypes: true })) {
      if (!entry.isFile() || !/^rw\..+\.dmg$/i.test(entry.name)) {
        continue
      }

      fs.rmSync(path.join(macOsBundleDir, entry.name), { force: true })
      removed += 1
    }
  }

  return removed
}

function ensureFreshTauriBuildCache(env) {
  const configuredTargetDir = env.CARGO_TARGET_DIR
  if (typeof configuredTargetDir !== 'string' || configuredTargetDir.trim().length === 0) {
    return
  }

  const targetDir = path.resolve(configuredTargetDir)
  const removedDmgIntermediates = pruneStaleMacOsDmgIntermediates(targetDir)
  const staleEntries = collectStaleTauriBuildEntries(targetDir)
  if (staleEntries.length === 0 && removedDmgIntermediates === 0) {
    return
  }

  const watchedPrefixes = ['tauri-', 'gtoffice-desktop-tauri-']
  const buildRoot = path.join(targetDir, 'debug', 'build')
  const fingerprintRoot = path.join(targetDir, 'debug', '.fingerprint')
  const removedBuildEntries = pruneTauriBuildCache(buildRoot, watchedPrefixes)
  const removedFingerprintEntries = pruneTauriBuildCache(fingerprintRoot, watchedPrefixes)

  const logParts = []
  if (staleEntries.length > 0) {
    logParts.push(
      `detected stale Tauri build cache (${staleEntries.length} entries) and cleared ${removedBuildEntries + removedFingerprintEntries} cache folders`,
    )
  }
  if (removedDmgIntermediates > 0) {
    logParts.push(`removed ${removedDmgIntermediates} stale macOS DMG intermediate files`)
  }

  if (logParts.length > 0) {
    console.warn(`[GT Office] ${logParts.join('; ')}.`)
  }
}

function hasTauriConfigArg(args) {
  return args.includes('--config') || args.includes('-c')
}

function hasBundleTargetArg(args) {
  return args.includes('--bundles') || args.includes('-b')
}

function shouldUseCustomMacOsDmgFlow(args) {
  return process.platform === 'darwin' && args[0] === 'build' && !hasBundleTargetArg(args)
}

function resolveMacOsBuildArgs(args) {
  if (!shouldUseCustomMacOsDmgFlow(args)) {
    return args
  }
  return [...args, '--bundles', 'app']
}

function resolveBuildProfile(args) {
  return args.includes('--debug') ? 'debug' : 'release'
}

function resolveMacOsArchSuffix() {
  switch (process.arch) {
    case 'arm64':
      return 'aarch64'
    case 'x64':
      return 'x64'
    default:
      return process.arch
  }
}

function readTauriConfig() {
  const configPath = path.join(workspacePath, 'src-tauri', 'tauri.conf.json')
  return JSON.parse(fs.readFileSync(configPath, 'utf8'))
}

function normalizeErrorMessage(error) {
  if (typeof error === 'string') {
    return error
  }

  if (error && typeof error.message === 'string' && error.message.length > 0) {
    return error.message
  }

  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

function logNormalizedError(error, tauriCliModule = null) {
  const normalizedErrorMessage = normalizeErrorMessage(error)

  if (tauriCliModule && typeof tauriCliModule.logError === 'function') {
    tauriCliModule.logError(normalizedErrorMessage)
    return
  }

  console.error(normalizedErrorMessage)
}

function runCommandOrThrow(command, args, options) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    ...options,
  })

  if (result.status !== 0) {
    const detail = typeof result.status === 'number' ? `exit code ${result.status}` : 'unknown error'
    throw new Error(`${command} ${args.join(' ')} failed with ${detail}`)
  }
}

function createCustomMacOsDmg(env, tauriArgs) {
  const tauriConfig = readTauriConfig()
  const profileDir = resolveBuildProfile(tauriArgs)
  const targetDir = path.resolve(env.CARGO_TARGET_DIR)
  const bundleRoot = path.join(targetDir, profileDir, 'bundle')
  const appName = `${tauriConfig.productName}.app`
  const appBundlePath = path.join(bundleRoot, 'macos', appName)

  if (!fs.existsSync(appBundlePath)) {
    throw new Error(`Expected app bundle not found at ${appBundlePath}`)
  }

  const dmgDir = path.join(bundleRoot, 'dmg')
  fs.mkdirSync(dmgDir, { recursive: true })

  const stageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gtoffice-dmg-'))
  const stageAppPath = path.join(stageDir, appName)
  const applicationsLinkPath = path.join(stageDir, 'Applications')
  const outputName = `${tauriConfig.productName}_${tauriConfig.version}_${resolveMacOsArchSuffix()}.dmg`
  const outputPath = path.join(dmgDir, outputName)

  try {
    fs.cpSync(appBundlePath, stageAppPath, { recursive: true })
    fs.symlinkSync('/Applications', applicationsLinkPath, 'dir')

    console.log(`[GT Office] Creating DMG at ${outputPath}`)
    runCommandOrThrow(
      'hdiutil',
      ['create', '-volname', tauriConfig.productName, '-srcfolder', stageDir, '-ov', '-format', 'UDZO', outputPath],
      { env },
    )
  } finally {
    fs.rmSync(stageDir, { recursive: true, force: true })
  }
}

function parsePortFromAddressToken(token) {
  if (typeof token !== 'string') {
    return null
  }
  const match = token.match(/:(\d+)\s*$/)
  if (!match) {
    return null
  }
  const value = Number.parseInt(match[1], 10)
  if (Number.isNaN(value) || value <= 0 || value > 65535) {
    return null
  }
  return value
}

function collectListeningPortsFromText(snapshot) {
  const ports = new Set()
  if (typeof snapshot !== 'string' || snapshot.trim().length === 0) {
    return ports
  }

  for (const rawLine of snapshot.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!/LISTEN/i.test(line)) {
      continue
    }
    const tokens = line.split(/\s+/).filter(Boolean)
    const addressToken = tokens.find((token) => parsePortFromAddressToken(token) !== null)
    if (!addressToken) {
      continue
    }
    const port = parsePortFromAddressToken(addressToken)
    if (port !== null) {
      ports.add(port)
    }
  }

  return ports
}

function readListeningPortsSnapshot() {
  const commands = process.platform === 'win32'
    ? [['netstat', ['-ano', '-p', 'tcp']]]
    : [
        ['ss', ['-ltnH']],
        ['netstat', ['-ltn']],
      ]

  for (const [cmd, args] of commands) {
    const result = spawnSync(cmd, args, {
      cwd: repoRoot,
      stdio: ['ignore', 'pipe', 'ignore'],
      encoding: 'utf8',
      shell: false,
    })
    if (result.status !== 0) {
      continue
    }
    const ports = collectListeningPortsFromText(result.stdout || '')
    if (ports.size > 0) {
      return ports
    }
  }

  return null
}

function probePortByBinding(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    let settled = false

    const done = (value) => {
      if (settled) {
        return
      }
      settled = true
      try {
        server.close()
      } catch (_error) {}
      resolve(value)
    }

    server.once('error', (error) => {
      if (error && (error.code === 'EPERM' || error.code === 'EACCES')) {
        done('blocked')
        return
      }
      done('closed')
    })

    server.once('listening', () => {
      server.close(() => done('open'))
    })

    // Match Vite's localhost binding behavior; checking only 127.0.0.1 can miss ::1 conflicts.
    server.listen(port, 'localhost')
  })
}

function isPortOpenByConnectProbe(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const done = (value) => {
      if (settled) {
        return
      }
      settled = true
      socket.destroy()
      resolve(value)
    }

    socket.setTimeout(300)

    socket.once('connect', () => {
      done(false)
    })

    socket.once('timeout', () => {
      done(true)
    })

    socket.once('error', (error) => {
      if (
        error &&
        (error.code === 'ECONNREFUSED' ||
          error.code === 'EHOSTUNREACH' ||
          error.code === 'ENETUNREACH')
      ) {
        done(true)
        return
      }
      done(false)
    })

    socket.connect(port, '127.0.0.1')
  })
}

function parseFrontendStartPort(rawValue) {
  if (typeof rawValue !== 'string' || rawValue.trim().length === 0) {
    return frontendPortDefault
  }

  const parsed = Number.parseInt(rawValue, 10)
  if (Number.isNaN(parsed) || parsed <= 0 || parsed > 65535) {
    return frontendPortDefault
  }
  return parsed
}

async function resolveFrontendPort() {
  const startPort = parseFrontendStartPort(process.env.GTO_FRONTEND_DEV_PORT)
  let hasPermissionBlockedProbe = false

  for (let offset = 0; offset < frontendPortScanMax; offset += 1) {
    const candidate = startPort + offset
    if (candidate > 65535) {
      break
    }
    const status = await probePortByBinding(candidate)
    if (status === 'open') {
      return candidate
    }
    if (status === 'blocked') {
      hasPermissionBlockedProbe = true
    }
  }

  // In restricted shells (e.g. sandbox), bind probes may be blocked.
  if (hasPermissionBlockedProbe) {
    const listeningPorts = readListeningPortsSnapshot()
    if (listeningPorts) {
      for (let offset = 0; offset < frontendPortScanMax; offset += 1) {
        const candidate = startPort + offset
        if (candidate > 65535) {
          break
        }
        if (!listeningPorts.has(candidate)) {
          return candidate
        }
      }
    }
  }

  for (let offset = 0; offset < frontendPortScanMax; offset += 1) {
    const candidate = startPort + offset
    if (candidate > 65535) {
      break
    }
    if (await isPortOpenByConnectProbe(candidate)) {
      return candidate
    }
  }

  throw new Error(
    `[GT Office] No free frontend dev port found in range ${startPort}-${Math.min(
      startPort + frontendPortScanMax - 1,
      65535,
    )}.`,
  )
}

async function resolveTauriArgs(passthroughArgs) {
  const normalizedArgs = resolveMacOsBuildArgs(passthroughArgs)
  const isDevCommand = passthroughArgs[0] === 'dev'
  if (!isDevCommand || hasTauriConfigArg(normalizedArgs)) {
    return normalizedArgs
  }

  const port = await resolveFrontendPort()
  const beforeDevCommand = `cd ../desktop-web && npm run dev -- --port ${port} --strictPort`
  const devUrl = `http://localhost:${port}`
  const configOverride = JSON.stringify({
    build: {
      beforeDevCommand,
      devUrl,
    },
  })

  console.log(`[GT Office] Using frontend dev server ${devUrl}`)
  return [...normalizedArgs, '--config', configOverride]
}

async function main() {
  let tauriCliModule

  try {
    const passthroughArgs = process.argv.slice(2)
    assertSupportedBundlesForHost(passthroughArgs, process.platform)

    const env = ensureCargoTargetDir({ ...process.env })
    const ensureResult = runNodeScript(ensureScriptPath, [], env)
    if (ensureResult.status !== 0) {
      process.exit(ensureResult.status ?? 1)
      return
    }

    const cargoEnv = ensureCargoEnv(env)
    if (!cargoEnv) {
      failWithCargoHint()
      return
    }

    ensureFreshTauriBuildCache(cargoEnv)

    const sidecarResult = runNodeScript(sidecarBuildScriptPath, passthroughArgs, cargoEnv)
    if (sidecarResult.status !== 0) {
      process.exit(sidecarResult.status ?? 1)
      return
    }

    const workspaceRequire = createRequire(path.join(workspacePath, 'package.json'))
    try {
      tauriCliModule = workspaceRequire('@tauri-apps/cli/main.js')
    } catch (error) {
      throw new Error(
        `[GT Office] Unable to load @tauri-apps/cli module after ensure step. ${normalizeErrorMessage(error)}`,
      )
    }

    process.chdir(workspacePath)
    Object.assign(process.env, cargoEnv)
    const tauriArgs = await resolveTauriArgs(passthroughArgs)

    await tauriCliModule.run(tauriArgs, 'tauri')
    if (shouldUseCustomMacOsDmgFlow(passthroughArgs)) {
      createCustomMacOsDmg(cargoEnv, tauriArgs)
    }
    process.exit(0)
  } catch (error) {
    logNormalizedError(error, tauriCliModule)
    process.exit(1)
  }
}

void main()
