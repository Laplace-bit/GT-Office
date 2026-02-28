#!/usr/bin/env node
import { startMcpServer } from '../src/mcp-server.mjs'
import { installAll } from '../src/installer.mjs'

const command = process.argv[2] || 'serve'

if (command === 'serve') {
  startMcpServer()
} else if (command === 'install') {
  const result = await installAll()
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  process.exit(result.report.some((item) => !item.ok) ? 1 : 0)
} else {
  process.stderr.write(`unknown command: ${command}\n`)
  process.exit(1)
}
