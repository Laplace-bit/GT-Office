import fs from 'node:fs/promises'
import fsSync from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SERVER_ID = 'gto-agent-bridge'
const INSTALL_MODE_LOCAL = 'local'
const INSTALL_MODE_NPX = 'npx'
const INSTALL_MODE_AUTO = 'auto'
const DEFAULT_NPX_COMMAND = 'npx'
const DEFAULT_NPX_PACKAGE = '@gtoffice/agent-mcp-bridge'
const DEFAULT_NPX_VERSION = '0.1.0'

const currentFile = fileURLToPath(import.meta.url)
const packageRoot = path.resolve(path.dirname(currentFile), '..')
const packageJsonPath = path.join(packageRoot, 'package.json')

function runtimePathCandidates(homeDir = os.homedir()) {
  const overridePath = process.env.GTO_MCP_RUNTIME_FILE
  if (overridePath && overridePath.trim()) {
    return [path.resolve(overridePath.trim())]
  }

  const candidates = []
  const pushCandidate = (value) => {
    if (!value) {
      return
    }
    const resolved = path.resolve(value)
    if (!candidates.includes(resolved)) {
      candidates.push(resolved)
    }
  }

  pushCandidate(path.join(homeDir, '.gtoffice', 'mcp', 'runtime.json'))

  if (process.env.WSL_DISTRO_NAME) {
    pushCandidate(path.join('/mnt/c/Users', os.userInfo().username, '.gtoffice', 'mcp', 'runtime.json'))
  }

  if (process.env.USERPROFILE && process.env.USERPROFILE.trim()) {
    pushCandidate(path.join(process.env.USERPROFILE.trim(), '.gtoffice', 'mcp', 'runtime.json'))
  }

  candidates.sort((left, right) => safeMtimeMs(right) - safeMtimeMs(left))
  return candidates
}

function safeMtimeMs(filePath) {
  try {
    return fsSync.statSync(filePath).mtimeMs || 0
  } catch {
    return 0
  }
}

function preferredRuntimePath(homeDir = os.homedir()) {
  return runtimePathCandidates(homeDir)[0] || path.join(homeDir, '.gtoffice', 'mcp', 'runtime.json')
}

function loadPackageMetadata() {
  try {
    const raw = fsSync.readFileSync(packageJsonPath, 'utf8')
    const pkg = JSON.parse(raw)
    return {
      name: typeof pkg.name === 'string' && pkg.name.trim() ? pkg.name.trim() : DEFAULT_NPX_PACKAGE,
      version:
        typeof pkg.version === 'string' && pkg.version.trim() ? pkg.version.trim() : DEFAULT_NPX_VERSION,
    }
  } catch {
    return {
      name: DEFAULT_NPX_PACKAGE,
      version: DEFAULT_NPX_VERSION,
    }
  }
}

function normalizeInstallMode(value, fallback = INSTALL_MODE_LOCAL) {
  const normalized = String(value || fallback).trim().toLowerCase()
  if ([INSTALL_MODE_LOCAL, INSTALL_MODE_NPX, INSTALL_MODE_AUTO].includes(normalized)) {
    return normalized
  }
  throw new Error(`unsupported install mode: ${value}`)
}

function resolveNpxPackageSpec() {
  const pkg = loadPackageMetadata()
  const packageName = (process.env.GTO_MCP_NPX_PACKAGE || pkg.name || DEFAULT_NPX_PACKAGE).trim()
  const version = (process.env.GTO_MCP_NPX_VERSION || pkg.version || DEFAULT_NPX_VERSION).trim()
  if (!packageName) {
    throw new Error('GTO_MCP_NPX_PACKAGE is required when install mode is npx')
  }
  if (!version || version === 'latest') {
    return packageName
  }
  return `${packageName}@${version}`
}

function resolveLocalServerEntry() {
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

  const serverScriptPath = path.resolve(packageRoot, 'bin/gto-agent-mcp.mjs')
  return {
    command: process.execPath,
    args: [serverScriptPath, 'serve'],
  }
}

function resolveNpxServerEntry() {
  return {
    command: process.env.GTO_MCP_NPX_COMMAND || DEFAULT_NPX_COMMAND,
    args: ['-y', resolveNpxPackageSpec(), 'serve'],
  }
}

function resolveServerEntry(options = {}) {
  const mode = normalizeInstallMode(options.installMode || process.env.GTO_MCP_INSTALL_MODE || INSTALL_MODE_LOCAL)
  if (mode === INSTALL_MODE_LOCAL) {
    return resolveLocalServerEntry()
  }
  if (mode === INSTALL_MODE_NPX) {
    return resolveNpxServerEntry()
  }

  try {
    return resolveNpxServerEntry()
  } catch {
    return resolveLocalServerEntry()
  }
}

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
    env: entry.env,
  }

  await writeJson(filePath, root)
}

function toClaudeMcpEntry(entry) {
  return {
    type: 'stdio',
    command: entry.command,
    args: entry.args,
    env: entry.env,
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
  const envLiteral = Object.entries(entry.env || {})
    .map(([key, value]) => `${key} = ${tomlQuote(value)}`)
    .join(', ')
  const block = [
    begin,
    `[mcp_servers.${SERVER_ID}]`,
    `command = ${tomlQuote(entry.command)}`,
    `args = [${argsLiteral}]`,
    `env = { ${envLiteral} }`,
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
  const runtimePath = preferredRuntimePath(homeDir)
  const entry = {
    ...resolveServerEntry(options),
    env: {
      GTO_MCP_RUNTIME_FILE: runtimePath,
    },
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
