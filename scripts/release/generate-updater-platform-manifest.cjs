#!/usr/bin/env node

const fs = require('node:fs')
const path = require('node:path')

function readFlag(name) {
  const index = process.argv.indexOf(`--${name}`)
  if (index === -1 || index === process.argv.length - 1) {
    return null
  }
  return process.argv[index + 1]
}

function requireFlag(name) {
  const value = readFlag(name)
  if (!value) {
    throw new Error(`Missing --${name}`)
  }
  return value
}

function toInstallerSuffix(filename) {
  const lower = filename.toLowerCase()
  if (lower.endsWith('.appimage')) return 'appimage'
  if (lower.endsWith('.deb')) return 'deb'
  if (lower.endsWith('.rpm')) return 'rpm'
  if (lower.endsWith('.msi')) return 'msi'
  if (lower.endsWith('.exe')) return 'nsis'
  if (lower.endsWith('.app.tar.gz') || lower.endsWith('.app.zip') || lower.endsWith('-macos.zip')) return 'app'
  return null
}

function main() {
  const assetsDir = path.resolve(requireFlag('assets-dir'))
  const output = path.resolve(requireFlag('output'))
  const os = requireFlag('os')
  const arch = requireFlag('arch')
  const repo = requireFlag('repo')
  const tag = requireFlag('tag')

  const releaseBaseUrl = `https://github.com/${repo}/releases/download/${tag}`
  const platforms = {}

  for (const entry of fs.readdirSync(assetsDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.sig')) {
      continue
    }

    const assetName = entry.name.slice(0, -4)
    const installer = toInstallerSuffix(assetName)
    if (!installer) {
      continue
    }

    const assetPath = path.join(assetsDir, assetName)
    if (!fs.existsSync(assetPath)) {
      continue
    }

    const signature = fs.readFileSync(path.join(assetsDir, entry.name), 'utf8').trim()
    if (!signature) {
      continue
    }

    const target = `${os}-${arch}-${installer}`
    platforms[target] = {
      url: `${releaseBaseUrl}/${encodeURIComponent(assetName)}`,
      signature,
    }
  }

  fs.writeFileSync(output, JSON.stringify({ platforms }, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
