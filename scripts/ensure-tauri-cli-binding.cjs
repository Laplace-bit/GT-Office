#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { createRequire } = require('node:module')
const { spawnSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const workspacePath = path.join(repoRoot, 'apps', 'desktop-tauri')
const workspaceRequire = createRequire(path.join(workspacePath, 'package.json'))

const platformPackageMap = {
  'darwin-arm64': '@tauri-apps/cli-darwin-arm64',
  'darwin-x64': '@tauri-apps/cli-darwin-x64',
  'linux-arm': '@tauri-apps/cli-linux-arm-gnueabihf',
  'linux-arm64': '@tauri-apps/cli-linux-arm64-gnu',
  'linux-riscv64': '@tauri-apps/cli-linux-riscv64-gnu',
  'linux-x64': '@tauri-apps/cli-linux-x64-gnu',
  'win32-arm64': '@tauri-apps/cli-win32-arm64-msvc',
  'win32-ia32': '@tauri-apps/cli-win32-ia32-msvc',
  'win32-x64': '@tauri-apps/cli-win32-x64-msvc',
}

function readJsonFileIfExists(filePath) {
  if (!filePath || !fs.existsSync(filePath)) {
    return null
  }
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }
}

function runNpmInstall(args) {
  const fullArgs = ['install', '--workspace', 'apps/desktop-tauri', '--include=optional', '--no-audit', '--no-fund', ...args]
  const invocations = []

  const npmExecPath = process.env.npm_execpath
  if (typeof npmExecPath === 'string' && npmExecPath.length > 0 && fs.existsSync(npmExecPath)) {
    invocations.push({
      cmd: process.execPath,
      args: [npmExecPath, ...fullArgs],
      label: `node ${npmExecPath}`,
    })
  }

  if (process.platform === 'win32') {
    invocations.push({
      cmd: 'npm.cmd',
      args: fullArgs,
      label: 'npm.cmd',
    })
  }

  invocations.push({
    cmd: 'npm',
    args: fullArgs,
    label: 'npm',
  })

  const failures = []
  for (const invocation of invocations) {
    const result = spawnSync(invocation.cmd, invocation.args, {
      cwd: repoRoot,
      stdio: 'inherit',
      shell: false,
      env: process.env,
    })

    if (result.status === 0) {
      return
    }

    const reason = result.error
      ? `${result.error.code ?? 'ERROR'}: ${result.error.message}`
      : `exit=${result.status ?? 'null'}${result.signal ? `, signal=${result.signal}` : ''}`
    failures.push(`${invocation.label} -> ${reason}`)
  }

  throw new Error(`npm install failed. Attempts: ${failures.join(' | ')}`)
}

function readCliVersion() {
  const resolveCandidates = [
    () => workspaceRequire.resolve('@tauri-apps/cli/package.json'),
    () => path.join(path.dirname(workspaceRequire.resolve('@tauri-apps/cli')), 'package.json'),
    () => path.join(repoRoot, 'node_modules', '@tauri-apps', 'cli', 'package.json'),
  ]

  for (const resolver of resolveCandidates) {
    try {
      const resolvedPath = resolver()
      const content = readJsonFileIfExists(resolvedPath)
      if (content && typeof content.version === 'string' && content.version.length > 0) {
        return content.version
      }
    } catch {
      // Ignore and try next candidate.
    }
  }

  const workspacePkg = readJsonFileIfExists(path.join(workspacePath, 'package.json'))
  const versionRange =
    workspacePkg &&
    workspacePkg.devDependencies &&
    typeof workspacePkg.devDependencies['@tauri-apps/cli'] === 'string'
      ? workspacePkg.devDependencies['@tauri-apps/cli']
      : null
  if (versionRange && versionRange.length > 0) {
    return versionRange
  }

  return null
}

function canLoadTauriCli() {
  try {
    workspaceRequire('@tauri-apps/cli')
    return true
  } catch (error) {
    const message = String(error && error.message ? error.message : error)
    const isBindingError =
      message.includes('Cannot find native binding') ||
      message.includes('MODULE_NOT_FOUND') ||
      message.includes('@tauri-apps/cli-win32') ||
      message.includes('@tauri-apps/cli-linux') ||
      message.includes('@tauri-apps/cli-darwin')

    if (!isBindingError) {
      throw error
    }
    return false
  }
}

function resolveTargetCliPackage() {
  const key = `${process.platform}-${process.arch}`
  return platformPackageMap[key] ?? null
}

if (canLoadTauriCli()) {
  process.exit(0)
}

console.warn('[GT Office] Detected missing @tauri-apps/cli native binding, attempting repair...')
runNpmInstall([])

if (canLoadTauriCli()) {
  console.warn('[GT Office] Tauri CLI binding repaired via npm optional dependency install.')
  process.exit(0)
}

const targetPackage = resolveTargetCliPackage()
const cliVersion = readCliVersion()
if (!targetPackage || !cliVersion) {
  throw new Error(
    '[GT Office] Unable to resolve platform Tauri CLI package automatically. Run `npm install --include=optional` manually.',
  )
}

console.warn(`[GT Office] Installing platform package ${targetPackage}@${cliVersion} ...`)
runNpmInstall([`${targetPackage}@${cliVersion}`, '--no-save'])

if (!canLoadTauriCli()) {
  throw new Error('[GT Office] Tauri CLI native binding still missing after repair.')
}

console.warn('[GT Office] Tauri CLI native binding repaired successfully.')
