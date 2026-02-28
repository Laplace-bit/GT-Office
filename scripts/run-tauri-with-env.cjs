#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { createRequire } = require('node:module')

const repoRoot = path.resolve(__dirname, '..')
const workspacePath = path.join(repoRoot, 'apps', 'desktop-tauri')
const ensureScriptPath = path.join(__dirname, 'ensure-tauri-cli-binding.cjs')
const sidecarBuildScriptPath = path.join(__dirname, 'build-mcp-sidecar.cjs')

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

async function main() {
  const passthroughArgs = process.argv.slice(2)
  const env = ensureCargoTargetDir({ ...process.env })

  const ensureResult = runNodeScript(ensureScriptPath, [], env)
  if (ensureResult.status !== 0) {
    process.exit(ensureResult.status ?? 1)
  }

  const cargoEnv = ensureCargoEnv(env)
  if (!cargoEnv) {
    failWithCargoHint()
  }

  const sidecarResult = runNodeScript(sidecarBuildScriptPath, passthroughArgs, cargoEnv)
  if (sidecarResult.status !== 0) {
    process.exit(sidecarResult.status ?? 1)
  }

  const workspaceRequire = createRequire(path.join(workspacePath, 'package.json'))
  let tauriCliModule
  try {
    tauriCliModule = workspaceRequire('@tauri-apps/cli/main.js')
  } catch (error) {
    console.error('[GT Office] Unable to load @tauri-apps/cli module after ensure step.')
    console.error(error && error.message ? error.message : String(error))
    process.exit(1)
    return
  }

  process.chdir(workspacePath)
  Object.assign(process.env, cargoEnv)

  try {
    await tauriCliModule.run(passthroughArgs, 'tauri')
    process.exit(0)
  } catch (error) {
    if (typeof tauriCliModule.logError === 'function') {
      tauriCliModule.logError(error)
    } else {
      console.error(error && error.message ? error.message : String(error))
    }
    process.exit(1)
  }
}

void main()
