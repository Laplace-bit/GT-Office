#!/usr/bin/env node
import path from 'node:path'
import { installAll } from '../src/installer.mjs'

function parseArgs(argv) {
  const options = {
    quiet: false,
    homeDir: undefined,
    workspaceRoot: undefined,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index]
    if (value === '--quiet') {
      options.quiet = true
      continue
    }
    if (value === '--home') {
      const next = argv[index + 1]
      if (!next) {
        throw new Error('--home requires a value')
      }
      options.homeDir = path.resolve(next)
      index += 1
      continue
    }
    if (value === '--workspace') {
      const next = argv[index + 1]
      if (!next) {
        throw new Error('--workspace requires a value')
      }
      options.workspaceRoot = path.resolve(next)
      index += 1
      continue
    }
    throw new Error(`unknown option: ${value}`)
  }

  return options
}

let options
try {
  options = parseArgs(process.argv.slice(2))
} catch (error) {
  process.stderr.write(`${error.message}\n`)
  process.exit(1)
}

const result = await installAll({ homeDir: options.homeDir, workspaceRoot: options.workspaceRoot })
if (!options.quiet) {
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

if (result.report.some((item) => !item.ok)) {
  process.exit(1)
}
