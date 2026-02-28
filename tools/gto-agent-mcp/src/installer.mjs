import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_ID = 'gto-agent-bridge'

function tomlQuote(value) {
  return `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

async function readJsonOrEmpty(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

async function writeJson(filePath, value) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })
  await fs.writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}

async function ensureJsonMcpServer(filePath, entry) {
  const root = await readJsonOrEmpty(filePath)
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error(`invalid JSON root for ${filePath}`)
  }

  if (!root.mcpServers || typeof root.mcpServers !== 'object' || Array.isArray(root.mcpServers)) {
    root.mcpServers = {}
  }

  root.mcpServers[SERVER_ID] = {
    command: entry.command,
    args: entry.args,
  }

  await writeJson(filePath, root)
}

function toClaudeMcpEntry(entry) {
  return {
    type: 'stdio',
    command: entry.command,
    args: entry.args,
    env: {},
  }
}

async function ensureClaudeProjectMcpServer(filePath, entry, workspaceRoot) {
  const root = await readJsonOrEmpty(filePath)
  if (!root || typeof root !== 'object' || Array.isArray(root)) {
    throw new Error(`invalid JSON root for ${filePath}`)
  }

  if (!root.projects || typeof root.projects !== 'object' || Array.isArray(root.projects)) {
    root.projects = {}
  }
  const workspaceKey = path.resolve(workspaceRoot)
  if (
    !root.projects[workspaceKey] ||
    typeof root.projects[workspaceKey] !== 'object' ||
    Array.isArray(root.projects[workspaceKey])
  ) {
    root.projects[workspaceKey] = {}
  }

  const project = root.projects[workspaceKey]
  if (!project.mcpServers || typeof project.mcpServers !== 'object' || Array.isArray(project.mcpServers)) {
    project.mcpServers = {}
  }
  project.mcpServers[SERVER_ID] = toClaudeMcpEntry(entry)

  // Keep a global fallback for clients that still read top-level mcpServers.
  if (!root.mcpServers || typeof root.mcpServers !== 'object' || Array.isArray(root.mcpServers)) {
    root.mcpServers = {}
  }
  root.mcpServers[SERVER_ID] = toClaudeMcpEntry(entry)

  await writeJson(filePath, root)
}

async function ensureCodexToml(filePath, entry) {
  await fs.mkdir(path.dirname(filePath), { recursive: true })

  let current = ''
  try {
    current = await fs.readFile(filePath, 'utf8')
  } catch {
    current = ''
  }

  const begin = '# BEGIN gto-agent-bridge'
  const end = '# END gto-agent-bridge'
  const argsLiteral = entry.args.map((value) => tomlQuote(value)).join(', ')
  const block = [
    begin,
    `[mcp_servers.${SERVER_ID}]`,
    `command = ${tomlQuote(entry.command)}`,
    `args = [${argsLiteral}]`,
    'startup_timeout_sec = 20',
    end,
    '',
  ].join('\n')

  const markerBlockPattern = new RegExp(`# BEGIN ${SERVER_ID}[\\s\\S]*?# END ${SERVER_ID}\\n?`, 'g')
  const tableName = SERVER_ID.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const tableBlockPattern = new RegExp(
    `\\n?\\[mcp_servers\\.${tableName}\\][\\s\\S]*?(?=\\n\\[[^\\n]+\\]|\\s*$)`,
    'g',
  )

  let next = current.replace(markerBlockPattern, '')
  next = next.replace(tableBlockPattern, '')
  next = next.trimEnd()
  if (next.length > 0) {
    next += '\n\n'
  }
  next += block

  await fs.writeFile(filePath, next, 'utf8')
}

function defaultServerEntry() {
  const commandOverride = process.env.GTO_MCP_COMMAND
  if (commandOverride && commandOverride.trim()) {
    return {
      command: commandOverride.trim(),
      args: ['serve'],
    }
  }

  const runtimePath =
    process.env.GTO_MCP_RUNTIME_FILE || path.join(os.homedir(), '.gtoffice', 'mcp', 'runtime.json')
  try {
    const runtimeRaw = fsSync.readFileSync(runtimePath, 'utf8')
    const runtime = JSON.parse(runtimeRaw)
    const runtimeCommand = runtime?.mcpCommand?.command
    const runtimeArgs = runtime?.mcpCommand?.args
    if (
      typeof runtimeCommand === 'string' &&
      runtimeCommand.trim() &&
      Array.isArray(runtimeArgs) &&
      runtimeArgs.every((item) => typeof item === 'string')
    ) {
      return {
        command: runtimeCommand.trim(),
        args: runtimeArgs,
      }
    }
  } catch {
    // ignore runtime read failures and fall back to node script mode
  }

  const currentFile = fileURLToPath(import.meta.url)
  const serverScriptPath = path.resolve(
    path.dirname(currentFile),
    '../bin/gto-agent-mcp.mjs',
  )
  return {
    command: process.execPath,
    args: [serverScriptPath, 'serve'],
  }
}

export function getDefaultInstallTargets(homeDir = os.homedir()) {
  return {
    claudeLegacy: path.join(homeDir, '.claude', 'settings.json'),
    claudeModern: path.join(homeDir, '.claude.json'),
    codex: path.join(homeDir, '.codex', 'config.toml'),
    gemini: path.join(homeDir, '.gemini', 'settings.json'),
    qwen: path.join(homeDir, '.qwen', 'settings.json'),
  }
}

export async function installAll(options = {}) {
  const homeDir = options.homeDir ? path.resolve(options.homeDir) : os.homedir()
  const workspaceRoot = options.workspaceRoot ? path.resolve(options.workspaceRoot) : process.cwd()
  const entry = {
    ...defaultServerEntry(),
    ...(options.serverEntry || {}),
  }
  const targets = getDefaultInstallTargets(homeDir)

  const report = []

  const writers = [
    {
      name: 'claude',
      run: async () => {
        await ensureJsonMcpServer(targets.claudeLegacy, entry)
        await ensureClaudeProjectMcpServer(targets.claudeModern, entry, workspaceRoot)
      },
      path: `${targets.claudeModern}, ${targets.claudeLegacy}`,
    },
    {
      name: 'codex',
      run: () => ensureCodexToml(targets.codex, entry),
      path: targets.codex,
    },
    {
      name: 'gemini',
      run: () => ensureJsonMcpServer(targets.gemini, entry),
      path: targets.gemini,
    },
    {
      name: 'qwen',
      run: () => ensureJsonMcpServer(targets.qwen, entry),
      path: targets.qwen,
    },
  ]

  for (const writer of writers) {
    try {
      await writer.run()
      report.push({ target: writer.name, ok: true, path: writer.path })
    } catch (error) {
      report.push({
        target: writer.name,
        ok: false,
        path: writer.path,
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  return {
    serverId: SERVER_ID,
    entry,
    report,
  }
}
