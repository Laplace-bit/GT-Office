#!/usr/bin/env node

const { spawnSync } = require('node:child_process')
const path = require('node:path')

const repoRoot = path.resolve(__dirname, '..')

const platformPackages = {
  'win32-x64': [
    '@rollup/rollup-win32-x64-msvc',
    'lightningcss-win32-x64-msvc',
    '@tailwindcss/oxide-win32-x64-msvc',
  ],
  'win32-arm64': [
    '@rollup/rollup-win32-arm64-msvc',
    'lightningcss-win32-arm64-msvc',
    '@tailwindcss/oxide-win32-arm64-msvc',
  ],
}

function packageInstalled(pkgName) {
  const result = spawnSync(process.execPath, ['-e', `require.resolve(${JSON.stringify(pkgName)})`], {
    cwd: repoRoot,
    stdio: 'ignore',
    shell: false,
    env: process.env,
  })
  return result.status === 0
}

function installPackages(packages) {
  if (packages.length === 0) {
    return
  }

  const npmExecPath = process.env.npm_execpath
  const npmArgs = ['install', '--no-save', '--no-audit', '--no-fund', ...packages]
  const invocations = []

  if (npmExecPath) {
    invocations.push({
      cmd: process.execPath,
      args: [npmExecPath, ...npmArgs],
      label: `node ${npmExecPath}`,
    })
  }

  if (process.platform === 'win32') {
    invocations.push({ cmd: 'npm.cmd', args: npmArgs, label: 'npm.cmd' })
  }
  invocations.push({ cmd: 'npm', args: npmArgs, label: 'npm' })

  const errors = []
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
    errors.push(`${invocation.label} -> ${reason}`)
  }

  throw new Error(`[GT Office] Failed to install web native bindings. Attempts: ${errors.join(' | ')}`)
}

const key = `${process.platform}-${process.arch}`
const requiredPackages = platformPackages[key] ?? []
if (requiredPackages.length === 0) {
  process.exit(0)
}

const missing = requiredPackages.filter((pkg) => !packageInstalled(pkg))
if (missing.length === 0) {
  process.exit(0)
}

console.warn(`[GT Office] Missing web native bindings detected: ${missing.join(', ')}`)
installPackages(missing)
console.warn('[GT Office] Web native bindings repaired successfully.')
