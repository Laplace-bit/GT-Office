#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')

const repoRoot = path.resolve(__dirname, '..')
const sidecarName = 'gto-agent-mcp-sidecar'
const sidecarManifestPath = path.join(repoRoot, 'tools', 'gto-agent-mcp-sidecar', 'Cargo.toml')

function parseArgs(argv) {
  const args = [...argv]
  const command = args[0] || 'dev'

  let explicitTarget = process.env.CARGO_BUILD_TARGET || ''
  for (let i = 0; i < args.length; i += 1) {
    const value = args[i]
    if (value === '--target' && args[i + 1]) {
      explicitTarget = args[i + 1]
      break
    }
    if (value.startsWith('--target=')) {
      explicitTarget = value.slice('--target='.length)
      break
    }
  }

  return {
    command,
    targetTriple: explicitTarget || detectHostTriple(),
    release: command === 'build',
    shouldBuild: command === 'dev' || command === 'build',
  }
}

function detectHostTriple() {
  const result = spawnSync('rustc', ['-vV'], {
    cwd: repoRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    env: process.env,
  })

  if (result.status !== 0) {
    throw new Error(`failed to run rustc -vV: ${result.stderr || result.stdout || 'unknown error'}`)
  }

  const hostLine = (result.stdout || '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith('host:'))

  if (!hostLine) {
    throw new Error('unable to parse host triple from rustc -vV output')
  }

  const triple = hostLine.replace('host:', '').trim()
  if (!triple) {
    throw new Error('host triple is empty')
  }

  return triple
}

function executableExt(targetTriple) {
  return targetTriple.includes('windows') ? '.exe' : ''
}

function run(command, args, env) {
  return spawnSync(command, args, {
    cwd: repoRoot,
    stdio: 'inherit',
    shell: false,
    env,
  })
}

function ensureSidecarBuild({ targetTriple, release }, env) {
  const cargoArgs = [
    'build',
    '--manifest-path',
    sidecarManifestPath,
    '--bin',
    sidecarName,
    '--target',
    targetTriple,
  ]
  if (release) {
    cargoArgs.push('--release')
  }

  let result = run('cargo', cargoArgs, env)
  if (result.status !== 0) {
    const offlineArgs = [...cargoArgs, '--offline']
    result = run('cargo', offlineArgs, env)
    if (result.status !== 0) {
      process.exit(result.status ?? 1)
    }
  }

  const targetDir =
    env.CARGO_TARGET_DIR || path.join(path.dirname(sidecarManifestPath), 'target')
  const profileDir = release ? 'release' : 'debug'
  const ext = executableExt(targetTriple)
  const source = path.join(targetDir, targetTriple, profileDir, `${sidecarName}${ext}`)
  const destinationDir = path.join(repoRoot, 'apps', 'desktop-tauri', 'src-tauri', 'binaries')
  const destination = path.join(destinationDir, `${sidecarName}-${targetTriple}${ext}`)

  if (!fs.existsSync(source)) {
    throw new Error(`sidecar binary not found: ${source}`)
  }

  fs.mkdirSync(destinationDir, { recursive: true })
  fs.copyFileSync(source, destination)
}

function main() {
  const options = parseArgs(process.argv.slice(2))
  if (!options.shouldBuild) {
    return
  }
  ensureSidecarBuild(options, process.env)
}

try {
  main()
} catch (error) {
  console.error(`[GT Office] Failed to build MCP sidecar: ${error.message || String(error)}`)
  process.exit(1)
}
