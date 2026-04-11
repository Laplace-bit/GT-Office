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

function main() {
  const inputDir = path.resolve(requireFlag('input-dir'))
  const output = path.resolve(requireFlag('output'))
  const version = requireFlag('version')
  const notesFile = path.resolve(requireFlag('notes-file'))

  const mergedPlatforms = {}
  for (const entry of fs.readdirSync(inputDir, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.json') || !entry.name.startsWith('updater-manifest-')) {
      continue
    }
    const payload = JSON.parse(fs.readFileSync(path.join(inputDir, entry.name), 'utf8'))
    const platforms = payload && typeof payload === 'object' ? payload.platforms : null
    if (!platforms || typeof platforms !== 'object') {
      continue
    }
    Object.assign(mergedPlatforms, platforms)
  }

  if (Object.keys(mergedPlatforms).length === 0) {
    throw new Error('No updater platform manifests were found')
  }

  const notes = fs.existsSync(notesFile) ? fs.readFileSync(notesFile, 'utf8').trim() : ''
  const latest = {
    version,
    notes: notes || `Release ${version}`,
    pub_date: new Date().toISOString(),
    platforms: mergedPlatforms,
  }

  fs.writeFileSync(output, JSON.stringify(latest, null, 2))
}

try {
  main()
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
}
