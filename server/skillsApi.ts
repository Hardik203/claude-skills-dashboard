import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs/promises'
import { createReadStream, existsSync } from 'node:fs'
import readline from 'node:readline'
import crypto from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import YAML from 'yaml'
import type {
  ActionResult,
  AvailablePlugin,
  InstalledPlugin,
  Overview,
  GitScanResult,
  GitScanSkill,
  Skill,
  UsageReport,
} from '../shared/types.ts'
import { categorize, categorizePlugin } from '../shared/categories.ts'

const run = promisify(execFile)

const HOME = os.homedir()
const CLAUDE_DIR = path.join(HOME, '.claude')
const SKILLS_DIR = path.join(CLAUDE_DIR, 'skills')
// Claude Code only loads ~/.claude/skills, so parking a folder here disables it reversibly.
const DISABLED_DIR = path.join(CLAUDE_DIR, 'skills-disabled')
const TRASH_DIR = process.platform === 'darwin' ? path.join(HOME, '.Trash') : path.join(CLAUDE_DIR, '.skills-trash')

const SKILL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/
const PLUGIN_ID = /^[a-zA-Z0-9][a-zA-Z0-9._-]*@[a-zA-Z0-9][a-zA-Z0-9._-]*$/

class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

// ---------- helpers ----------

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/

function parseFrontmatter(text: string): Record<string, unknown> {
  const match = FRONTMATTER.exec(text)
  if (!match) return {}
  try {
    const data = YAML.parse(match[1])
    return data && typeof data === 'object' ? data : {}
  } catch {
    // Loose fallback for frontmatter that isn't strictly valid YAML
    const out: Record<string, string> = {}
    for (const line of match[1].split(/\r?\n/)) {
      const kv = /^([a-zA-Z_-]+):\s*(.*)$/.exec(line)
      if (kv) out[kv[1]] = kv[2].replace(/^["']|["']$/g, '')
    }
    return out
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : ''
}

// Token estimates mirror `claude plugin details`: ~4 chars per token. The always-on
// cost is the `- name: description` listing line; on-invoke is the body after frontmatter.
// Checked against the CLI's projection for ecc@ecc (448 entries): within ~0.2%.
function listingTokens(name: string, description: string) {
  return Math.round(`- ${name}: ${description}\n`.length / 4)
}

function bodyTokens(text: string) {
  return Math.round(text.replace(FRONTMATTER, '').length / 4)
}

interface MarkdownMeta {
  valid: boolean
  name: string
  description: string
  category: string
  bodyTokens: number
}

async function readMarkdown(file: string): Promise<MarkdownMeta> {
  try {
    const text = await fs.readFile(file, 'utf8')
    const fm = parseFrontmatter(text)
    return {
      valid: true,
      name: str(fm.name),
      description: str(fm.description),
      category: str(fm.category),
      bodyTokens: bodyTokens(text),
    }
  } catch {
    return { valid: false, name: '', description: '', category: '', bodyTokens: 0 }
  }
}

async function readDirSafe(dir: string) {
  try {
    return await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return []
  }
}

function readSkillFolder(dir: string) {
  return readMarkdown(path.join(dir, 'SKILL.md'))
}

function assertSkillName(name: unknown): string {
  if (typeof name !== 'string' || !SKILL_NAME.test(name) || name === '.' || name === '..') {
    throw new HttpError(400, 'Invalid skill name. Use letters, numbers, dots, dashes or underscores.')
  }
  return name
}

async function uniquePath(dir: string, base: string) {
  let candidate = path.join(dir, base)
  for (let i = 1; existsSync(candidate); i++) candidate = path.join(dir, `${base} ${i}`)
  return candidate
}

async function claudeCli(args: string[]) {
  try {
    const { stdout } = await run('claude', args, { timeout: 180_000, maxBuffer: 32 * 1024 * 1024 })
    return stdout
  } catch (err) {
    const e = err as { stderr?: string; stdout?: string; message: string }
    const detail = (e.stderr || e.stdout || e.message).trim()
    throw new HttpError(500, `claude ${args.slice(0, 2).join(' ')} failed: ${detail.slice(0, 800)}`)
  }
}

// ---------- reads ----------

async function listPersonalSkills(): Promise<Skill[]> {
  const out: Skill[] = []
  for (const [dir, enabled] of [[SKILLS_DIR, true], [DISABLED_DIR, false]] as const) {
    for (const entry of await readDirSafe(dir)) {
      if (entry.name.startsWith('.')) continue
      const full = path.join(dir, entry.name)
      const isSymlink = entry.isSymbolicLink()
      if (!entry.isDirectory() && !isSymlink) continue
      if (isSymlink) {
        const stat = await fs.stat(full).catch(() => null)
        if (!stat?.isDirectory()) continue
      }
      const meta = await readSkillFolder(full)
      out.push({
        id: `personal:${entry.name}`,
        name: entry.name,
        description: meta.description,
        source: 'personal',
        kind: 'skill',
        enabled,
        path: full,
        isSymlink,
        valid: meta.valid,
        // A folder without SKILL.md isn't loaded, so it costs nothing
        tokens: meta.valid
          ? { alwaysOn: listingTokens(meta.name || entry.name, meta.description), onInvoke: meta.bodyTokens }
          : { alwaysOn: 0, onInvoke: 0 },
        category: categorize(entry.name, meta.description, meta.category),
        invokeName: meta.name || entry.name,
      })
    }
  }
  return out
}

interface CliPlugin {
  id: string
  version: string
  enabled: boolean
  installPath: string
  installedAt?: string
}

async function listPlugins(): Promise<{ plugins: InstalledPlugin[]; skills: Skill[] }> {
  const raw = JSON.parse(await claudeCli(['plugin', 'list', '--json'])) as CliPlugin[]
  const plugins: InstalledPlugin[] = []
  const skills: Skill[] = []

  for (const p of raw) {
    const [name, marketplace] = p.id.split('@')
    let skillCount = 0
    let commandCount = 0
    let alwaysOnTokens = 0

    for (const entry of await readDirSafe(path.join(p.installPath, 'skills'))) {
      if (!entry.isDirectory()) continue
      const dir = path.join(p.installPath, 'skills', entry.name)
      const meta = await readSkillFolder(dir)
      if (!meta.valid) continue
      skillCount++
      const skillName = meta.name || entry.name
      const tokens = { alwaysOn: listingTokens(skillName, meta.description), onInvoke: meta.bodyTokens }
      alwaysOnTokens += tokens.alwaysOn
      skills.push({
        id: `plugin:${p.id}:skill:${entry.name}`,
        name: `${name}:${skillName}`,
        description: meta.description,
        source: 'plugin',
        kind: 'skill',
        enabled: p.enabled,
        path: dir,
        pluginId: p.id,
        valid: true,
        tokens,
        category: categorize(skillName, meta.description, meta.category),
        invokeName: `${name}:${skillName}`,
      })
    }

    for (const entry of await readDirSafe(path.join(p.installPath, 'commands'))) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const file = path.join(p.installPath, 'commands', entry.name)
      const meta = await readMarkdown(file)
      commandCount++
      const cmd = entry.name.replace(/\.md$/, '')
      const tokens = { alwaysOn: listingTokens(cmd, meta.description), onInvoke: meta.bodyTokens }
      alwaysOnTokens += tokens.alwaysOn
      skills.push({
        id: `plugin:${p.id}:command:${cmd}`,
        name: `${name}:${cmd}`,
        description: meta.description,
        source: 'plugin',
        kind: 'command',
        enabled: p.enabled,
        path: file,
        pluginId: p.id,
        valid: true,
        tokens,
        category: categorize(cmd, meta.description, meta.category),
        invokeName: `${name}:${cmd}`,
      })
    }

    // Agents aren't skills, but their descriptions are also loaded into every session
    let agentCount = 0
    let agentTokens = 0
    for (const entry of await readDirSafe(path.join(p.installPath, 'agents'))) {
      if (!entry.isFile() || !entry.name.endsWith('.md')) continue
      const meta = await readMarkdown(path.join(p.installPath, 'agents', entry.name))
      agentCount++
      agentTokens += listingTokens(meta.name || entry.name.replace(/\.md$/, ''), meta.description)
    }
    alwaysOnTokens += agentTokens

    const manifest = (await fs
      .readFile(path.join(p.installPath, '.claude-plugin', 'plugin.json'), 'utf8')
      .then(JSON.parse)
      .catch(() => ({}))) as Record<string, unknown>
    const hasHooks = 'hooks' in manifest || existsSync(path.join(p.installPath, 'hooks', 'hooks.json'))
    const hasMcp = 'mcpServers' in manifest || existsSync(path.join(p.installPath, '.mcp.json'))

    plugins.push({
      id: p.id,
      name,
      marketplace: marketplace ?? '',
      version: p.version,
      enabled: p.enabled,
      installPath: p.installPath,
      installedAt: p.installedAt,
      skillCount,
      commandCount,
      agentCount,
      agentTokens,
      alwaysOnTokens,
      hasHooks,
      hasMcp,
    })
  }

  plugins.sort((a, b) => a.name.localeCompare(b.name))
  return { plugins, skills }
}

async function getOverview(): Promise<Overview> {
  const [personal, { plugins, skills }] = await Promise.all([listPersonalSkills(), listPlugins()])
  const all = [...personal, ...skills].sort((a, b) => a.name.localeCompare(b.name))
  return { skills: all, plugins, paths: { skillsDir: SKILLS_DIR, disabledDir: DISABLED_DIR } }
}

async function readSkillContent(id: string, overview: Overview) {
  const skill = overview.skills.find((s) => s.id === id)
  if (!skill) throw new HttpError(404, 'Skill not found')
  const file = skill.kind === 'command' ? skill.path : path.join(skill.path, 'SKILL.md')
  const content = await fs.readFile(file, 'utf8').catch(() => '(no SKILL.md in this folder)')
  return { path: file, content }
}

/** `category` per plugin name, read from each known marketplace's manifest (the CLI doesn't report it). */
async function readMarketplaceCategories(): Promise<Map<string, string>> {
  const out = new Map<string, string>()
  let known: Record<string, { installLocation?: string }> = {}
  try {
    known = JSON.parse(await fs.readFile(path.join(CLAUDE_DIR, 'plugins', 'known_marketplaces.json'), 'utf8'))
  } catch {
    return out
  }
  await Promise.all(
    Object.entries(known).map(async ([market, info]) => {
      if (!info.installLocation) return
      try {
        const manifest = JSON.parse(
          await fs.readFile(path.join(info.installLocation, '.claude-plugin', 'marketplace.json'), 'utf8'),
        ) as { plugins?: { name?: string; category?: unknown }[] }
        for (const p of manifest.plugins ?? []) {
          if (p.name && typeof p.category === 'string') out.set(`${p.name}@${market}`, p.category)
        }
      } catch {
        // Marketplace without a readable manifest: its plugins just get inferred categories
      }
    }),
  )
  return out
}

async function listAvailablePlugins(): Promise<AvailablePlugin[]> {
  const [data, declared] = await Promise.all([
    claudeCli(['plugin', 'list', '--available', '--json']).then((out) => JSON.parse(out) as { available?: AvailablePlugin[] }),
    readMarketplaceCategories(),
  ])
  return (data.available ?? []).map((p) => {
    const description = p.description ?? ''
    const declaredCategory = declared.get(p.pluginId)
    return {
      pluginId: p.pluginId,
      name: p.name,
      description,
      marketplaceName: p.marketplaceName,
      version: p.version,
      category: categorizePlugin(p.name, description, declaredCategory),
      declaredCategory,
      installCount: typeof p.installCount === 'number' ? p.installCount : undefined,
    }
  })
}

// ---------- usage from session transcripts ----------

const PROJECTS_DIR = path.join(CLAUDE_DIR, 'projects')

interface UsageEvent {
  /** Dedupe key (tool_use id or message uuid): resumed sessions can repeat earlier lines */
  key: string
  name: string
  at: string
}

interface ScannedFile {
  mtimeMs: number
  size: number
  events: UsageEvent[]
  first: string | null
}

// Transcripts are append-only, so a file whose size and mtime haven't changed needn't be re-read.
const scanCache = new Map<string, ScannedFile>()

const COMMAND_TAG = /<command-name>\/?([^<\s]+)<\/command-name>/g
const TIMESTAMP = /"timestamp":"([^"]+)"/

async function findTranscripts(dir: string, depth = 3): Promise<string[]> {
  const out: string[] = []
  for (const entry of await readDirSafe(dir)) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory() && depth > 0) out.push(...(await findTranscripts(full, depth - 1)))
    else if (entry.isFile() && entry.name.endsWith('.jsonl')) out.push(full)
  }
  return out
}

/** Text the user actually sent (not tool output) — where a typed /command's tag lives. */
function userText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.map((b) => (b && b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n')
}

async function scanTranscript(file: string, mtimeMs: number, size: number): Promise<ScannedFile> {
  const events: UsageEvent[] = []
  let first: string | null = null
  const lines = readline.createInterface({ input: createReadStream(file, { encoding: 'utf8' }), crlfDelay: Infinity })
  for await (const line of lines) {
    if (!first) first = TIMESTAMP.exec(line)?.[1] ?? null
    // Cheap prefilter: most lines can't contain a skill, agent or plugin-MCP use
    if (
      !line.includes('"Skill"') &&
      !line.includes('<command-name>') &&
      !line.includes('"subagent_type"') &&
      !line.includes('"mcp__plugin_')
    ) {
      continue
    }
    let entry: { type?: string; uuid?: string; timestamp?: string; message?: { content?: unknown } }
    try {
      entry = JSON.parse(line)
    } catch {
      continue
    }
    const at = entry.timestamp ?? first ?? ''
    const content = entry.message?.content
    if (entry.type === 'assistant' && Array.isArray(content)) {
      for (const block of content) {
        if (block?.type !== 'tool_use') continue
        const key = block.id ?? `${entry.uuid}:${block.name}`
        if (block.name === 'Skill' && typeof block.input?.skill === 'string') {
          events.push({ key, name: block.input.skill, at })
        } else if (typeof block.input?.subagent_type === 'string') {
          // Agent/Task calls: plugin agents look like `ecc:code-reviewer`
          events.push({ key, name: block.input.subagent_type, at })
        } else if (typeof block.name === 'string' && block.name.startsWith('mcp__plugin_')) {
          // `mcp__plugin_<plugin>_<server>__<tool>` → count per server
          events.push({ key, name: block.name.slice(0, block.name.lastIndexOf('__')), at })
        }
      }
    } else if (entry.type === 'user') {
      for (const m of userText(content).matchAll(COMMAND_TAG)) {
        events.push({ key: `${entry.uuid}:${m[1]}`, name: m[1], at })
      }
    }
  }
  return { mtimeMs, size, events, first }
}

async function getUsage(): Promise<UsageReport> {
  const files = await findTranscripts(PROJECTS_DIR)
  const scanned = await Promise.all(
    files.map(async (file) => {
      const stat = await fs.stat(file).catch(() => null)
      if (!stat) return null
      const cached = scanCache.get(file)
      if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached
      const result = await scanTranscript(file, stat.mtimeMs, stat.size).catch(() => null)
      if (result) scanCache.set(file, result)
      return result
    }),
  )

  const seen = new Set<string>()
  const uses: UsageReport['uses'] = {}
  let since: string | null = null
  let sessions = 0
  for (const s of scanned) {
    if (!s) continue
    sessions++
    if (s.first && (!since || s.first < since)) since = s.first
    for (const e of s.events) {
      if (seen.has(e.key)) continue
      seen.add(e.key)
      const u = (uses[e.name] ??= { count: 0, lastUsed: e.at })
      u.count++
      if (e.at > u.lastUsed) u.lastUsed = e.at
    }
  }
  return { uses, sessions, since }
}

// ---------- personal skill mutations ----------

async function togglePersonal(nameInput: unknown, enabled: unknown): Promise<ActionResult> {
  const name = assertSkillName(nameInput)
  const from = path.join(enabled ? DISABLED_DIR : SKILLS_DIR, name)
  const to = path.join(enabled ? SKILLS_DIR : DISABLED_DIR, name)
  if (!existsSync(from)) throw new HttpError(404, `Skill "${name}" not found`)
  if (existsSync(to)) throw new HttpError(409, `A skill named "${name}" already exists in the target folder`)
  await fs.mkdir(path.dirname(to), { recursive: true })
  await fs.rename(from, to)
  return { ok: true, message: `${enabled ? 'Enabled' : 'Disabled'} ${name}` }
}

async function deletePersonal(nameInput: unknown): Promise<ActionResult> {
  const name = assertSkillName(nameInput)
  const src = [path.join(SKILLS_DIR, name), path.join(DISABLED_DIR, name)].find((p) => existsSync(p))
  if (!src) throw new HttpError(404, `Skill "${name}" not found`)
  await fs.mkdir(TRASH_DIR, { recursive: true })
  const dest = await uniquePath(TRASH_DIR, `skill-${name}`)
  await fs.rename(src, dest)
  return { ok: true, message: `Moved ${name} to ${dest.replace(HOME, '~')}` }
}

function ensureFree(name: string) {
  if (existsSync(path.join(SKILLS_DIR, name)) || existsSync(path.join(DISABLED_DIR, name))) {
    throw new HttpError(409, `A skill named "${name}" is already installed`)
  }
}

async function createPersonal(body: Record<string, unknown>): Promise<ActionResult> {
  const name = assertSkillName(body.name)
  const description = str(body.description)
  const content = typeof body.content === 'string' ? body.content : ''
  if (!description) throw new HttpError(400, 'Description is required — Claude uses it to decide when to load the skill.')
  ensureFree(name)
  const fm = YAML.stringify({ name, description }).trimEnd()
  const md = `---\n${fm}\n---\n\n${content.trim() || `# ${name}\n\nDescribe how Claude should perform this skill.`}\n`
  const dir = path.join(SKILLS_DIR, name)
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(path.join(dir, 'SKILL.md'), md, 'utf8')
  return { ok: true, message: `Created ${name}`, installed: [name] }
}

async function findSkillDirs(root: string, depth = 4): Promise<string[]> {
  if (existsSync(path.join(root, 'SKILL.md'))) return [root]
  if (depth === 0) return []
  const found: string[] = []
  for (const entry of await readDirSafe(root)) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === 'node_modules') continue
    found.push(...(await findSkillDirs(path.join(root, entry.name), depth - 1)))
  }
  return found
}

interface GitSource {
  cloneUrl: string
  /** Shown to the user, e.g. `anthropics/skills` */
  label: string
  ref?: string
  subdir?: string
}

function cleanSubdir(input: string | undefined): string | undefined {
  if (!input) return undefined
  const norm = path.posix.normalize(input.replace(/\\/g, '/')).replace(/^\.\/|\/+$/g, '')
  if (!norm || norm === '.') return undefined
  if (path.posix.isAbsolute(norm) || norm.split('/').includes('..')) {
    throw new HttpError(400, 'Sub-folder must be a relative path inside the repo')
  }
  return norm
}

/**
 * Accepts `owner/repo`, `https://github.com/owner/repo(.git)`, GitHub folder links
 * (`…/tree/<branch>/<path>` or `…/blob/<branch>/<path>/SKILL.md`), or any other https clone URL.
 * An explicit sub-folder wins over one taken from the link.
 */
function parseGitSource(input: string, subdirInput: string): GitSource {
  const raw = input.trim().replace(/\/+$/, '')
  const explicitSub = cleanSubdir(subdirInput)

  const short = /^([\w.-]+)\/([\w.-]+)$/.exec(raw)
  if (short) {
    const repo = short[2].replace(/\.git$/, '')
    return { cloneUrl: `https://github.com/${short[1]}/${repo}.git`, label: `${short[1]}/${repo}`, subdir: explicitSub }
  }

  const gh = /^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/(?:tree|blob)\/([^/]+)(?:\/(.+))?)?$/.exec(raw)
  if (gh) {
    let linked = gh[4]
    if (linked && /(^|\/)SKILL\.md$/i.test(linked)) linked = path.posix.dirname(linked)
    return {
      cloneUrl: `https://github.com/${gh[1]}/${gh[2]}.git`,
      label: `${gh[1]}/${gh[2]}`,
      ref: gh[3],
      subdir: explicitSub ?? cleanSubdir(linked),
    }
  }

  if (/^https:\/\/[^\s]+$/.test(raw)) return { cloneUrl: raw, label: raw.replace(/^https:\/\//, ''), subdir: explicitSub }
  throw new HttpError(400, 'Enter a GitHub repo like owner/repo, or an https:// git URL')
}

interface ScanCandidate {
  dir: string
  name: string
  /** Why it can't be installed, if it can't */
  conflict?: string
}

interface GitScan {
  tmp: string
  label: string
  candidates: Map<string, ScanCandidate>
  timer: ReturnType<typeof setTimeout>
}

// A scan keeps its clone on disk so the user can pick skills; it's deleted after install or 10 minutes.
const gitScans = new Map<string, GitScan>()
const SCAN_TTL_MS = 10 * 60_000

async function dropScan(id: string) {
  const scan = gitScans.get(id)
  if (!scan) return
  gitScans.delete(id)
  clearTimeout(scan.timer)
  await fs.rm(scan.tmp, { recursive: true, force: true })
}

/**
 * Remove clones orphaned when the server restarted mid-scan (their timers died with it).
 * Age-gated so a second running server's live scans are left alone.
 */
async function sweepStaleScans() {
  const tmpRoot = os.tmpdir()
  for (const entry of await readDirSafe(tmpRoot)) {
    if (!entry.isDirectory() || !entry.name.startsWith('skill-scan-')) continue
    const full = path.join(tmpRoot, entry.name)
    const stat = await fs.stat(full).catch(() => null)
    if (stat && Date.now() - stat.mtimeMs > SCAN_TTL_MS) await fs.rm(full, { recursive: true, force: true })
  }
}

function isInstalled(name: string) {
  return existsSync(path.join(SKILLS_DIR, name)) || existsSync(path.join(DISABLED_DIR, name))
}

async function scanGitRepo(body: Record<string, unknown>): Promise<GitScanResult> {
  const source = parseGitSource(str(body.source), str(body.subdir))
  void sweepStaleScans()
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'skill-scan-'))
  const repoDir = path.join(tmp, 'repo')
  try {
    const args = ['clone', '--depth', '1', ...(source.ref ? ['--branch', source.ref] : []), '--', source.cloneUrl, repoDir]
    try {
      await run('git', args, { timeout: 120_000, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })
    } catch (err) {
      const e = err as { stderr?: string; message: string }
      // Drop git's "Cloning into '/tmp/…'" line — it's noise and leaks the temp path
      const detail = (e.stderr || e.message)
        .split('\n')
        .filter((l) => l.trim() && !l.startsWith('Cloning into'))
        .join(' ')
        .trim()
      const hint = /not found|could not read Username/i.test(detail) ? ' — check the repo exists and is public' : ''
      throw new HttpError(400, `Couldn’t clone ${source.label}${hint}: ${detail.slice(0, 300)}`)
    }

    const searchRoot = source.subdir ? path.join(repoDir, source.subdir) : repoDir
    if (!existsSync(searchRoot)) throw new HttpError(400, `Folder "${source.subdir}" not found in ${source.label}`)
    const dirs = await findSkillDirs(searchRoot)
    if (dirs.length === 0) throw new HttpError(400, `No SKILL.md found in ${source.label}${source.subdir ? `/${source.subdir}` : ''}`)

    const candidates = new Map<string, ScanCandidate>()
    const seen = new Set<string>()
    const skills: GitScanSkill[] = []
    for (const dir of dirs.sort()) {
      const meta = await readSkillFolder(dir)
      const rel = path.relative(repoDir, dir) || '.'
      const fallback = dir === repoDir ? source.label.split('/').pop()!.replace(/\.git$/, '') : path.basename(dir)
      const name = SKILL_NAME.test(meta.name) ? meta.name : fallback
      let conflict: string | undefined
      if (!SKILL_NAME.test(name)) conflict = 'Invalid name'
      else if (isInstalled(name)) conflict = 'Already installed'
      else if (seen.has(name)) conflict = 'Duplicate name in repo'
      seen.add(name)
      candidates.set(rel, { dir, name, conflict })
      skills.push({
        path: rel,
        name,
        description: meta.description,
        tokens: { alwaysOn: listingTokens(name, meta.description), onInvoke: meta.bodyTokens },
        category: categorize(name, meta.description, meta.category),
        conflict,
      })
    }

    const scanId = crypto.randomUUID()
    const timer = setTimeout(() => void dropScan(scanId), SCAN_TTL_MS)
    timer.unref?.()
    gitScans.set(scanId, { tmp, label: source.label, candidates, timer })
    return { scanId, repo: source.label, ref: source.ref ?? null, subdir: source.subdir ?? null, skills }
  } catch (err) {
    await fs.rm(tmp, { recursive: true, force: true })
    throw err
  }
}

async function installFromScan(body: Record<string, unknown>): Promise<ActionResult> {
  const scanId = str(body.scanId)
  const scan = gitScans.get(scanId)
  if (!scan) throw new HttpError(410, 'That search expired — find the skills again')
  if (!Array.isArray(body.paths) || body.paths.length === 0) throw new HttpError(400, 'Pick at least one skill')

  const installed: string[] = []
  const skipped: string[] = []
  try {
    for (const rel of body.paths) {
      // Only folders this scan actually found can be installed
      const c = typeof rel === 'string' ? scan.candidates.get(rel) : undefined
      if (!c) throw new HttpError(400, 'Unknown skill in selection')
      if (c.conflict || isInstalled(c.name)) {
        skipped.push(c.name)
        continue
      }
      await fs.cp(c.dir, path.join(SKILLS_DIR, c.name), {
        recursive: true,
        // Skip git metadata and symlinks: a repo shouldn't be able to plant links to files elsewhere
        filter: async (src) => path.basename(src) !== '.git' && !(await fs.lstat(src)).isSymbolicLink(),
      })
      installed.push(c.name)
    }
  } finally {
    await dropScan(scanId)
  }
  if (installed.length === 0) throw new HttpError(409, `Nothing installed — already present: ${skipped.join(', ')}`)
  const note = skipped.length ? ` (skipped: ${skipped.join(', ')})` : ''
  return { ok: true, message: `Installed ${installed.join(', ')} from ${scan.label}${note}`, installed }
}

// ---------- plugin mutations ----------

function assertPluginId(id: unknown): string {
  if (typeof id !== 'string' || !PLUGIN_ID.test(id)) throw new HttpError(400, 'Invalid plugin id (expected name@marketplace)')
  return id
}

async function togglePlugin(idInput: unknown, enabled: unknown): Promise<ActionResult> {
  const id = assertPluginId(idInput)
  await claudeCli(['plugin', enabled ? 'enable' : 'disable', id])
  return { ok: true, message: `${enabled ? 'Enabled' : 'Disabled'} plugin ${id}` }
}

/** Toggle many personal skills and plugins in one request (used by "Disable unused" and its Undo). */
async function bulkToggle(body: Record<string, unknown>): Promise<ActionResult> {
  const enabled = body.enabled === true
  const names = Array.isArray(body.personal) ? [...new Set(body.personal.map(assertSkillName))] : []
  const ids = Array.isArray(body.plugins) ? [...new Set(body.plugins.map(assertPluginId))] : []
  if (names.length + ids.length === 0) throw new HttpError(400, 'Nothing to change')
  if (names.length + ids.length > 1000) throw new HttpError(400, 'Too many items in one request')

  const affected = { personal: [] as string[], plugins: [] as string[] }
  const failed: string[] = []
  for (const name of names) {
    try {
      await togglePersonal(name, enabled)
      affected.personal.push(name)
    } catch {
      failed.push(name)
    }
  }
  // Sequential on purpose: each CLI call rewrites ~/.claude/settings.json
  for (const id of ids) {
    try {
      await claudeCli(['plugin', enabled ? 'enable' : 'disable', id])
      affected.plugins.push(id)
    } catch {
      failed.push(id.split('@')[0])
    }
  }
  if (affected.personal.length + affected.plugins.length === 0) {
    throw new HttpError(500, `Nothing changed — failed: ${failed.join(', ')}`)
  }
  const parts = [
    affected.personal.length && `${affected.personal.length} skill${affected.personal.length === 1 ? '' : 's'}`,
    affected.plugins.length && `${affected.plugins.length} plugin${affected.plugins.length === 1 ? '' : 's'}`,
  ].filter(Boolean)
  const note = failed.length ? ` — failed: ${failed.join(', ')}` : ''
  return { ok: true, message: `${enabled ? 'Enabled' : 'Disabled'} ${parts.join(' and ')}${note}`, affected }
}

async function uninstallPlugin(idInput: unknown): Promise<ActionResult> {
  const id = assertPluginId(idInput)
  await claudeCli(['plugin', 'uninstall', id])
  return { ok: true, message: `Uninstalled plugin ${id}` }
}

async function installPlugin(idInput: unknown): Promise<ActionResult> {
  const id = assertPluginId(idInput)
  await claudeCli(['plugin', 'install', id])
  return { ok: true, message: `Installed plugin ${id}`, installed: [id] }
}

// ---------- HTTP plumbing ----------

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > 1_000_000) throw new HttpError(413, 'Request body too large')
    chunks.push(chunk as Buffer)
  }
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    throw new HttpError(400, 'Invalid JSON body')
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

/** Mutations must come from this page: a custom header forces a CORS preflight that other sites can't pass. */
function assertSameOrigin(req: IncomingMessage) {
  if (req.headers['x-skills-dashboard'] !== '1') throw new HttpError(403, 'Missing dashboard header')
  const origin = req.headers.origin
  if (origin && new URL(origin).host !== req.headers.host) throw new HttpError(403, 'Cross-origin request blocked')
}

/** Identifies this app on /api/health, so a second launch can tell the port is already ours. */
export const APP_ID = 'claude-skills-dashboard'

/**
 * Handles requests under /api. `req.url` must already have the `/api` prefix stripped
 * (connect does that for the Vite middleware; the standalone server does it itself).
 */
export async function apiHandler(req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const route = `${req.method} ${url.pathname}`
  try {
    if (req.method !== 'GET') assertSameOrigin(req)
    switch (route) {
      case 'GET /health':
        return send(res, 200, { app: APP_ID })
      case 'GET /overview':
        return send(res, 200, await getOverview())
      case 'GET /skill-content':
        return send(res, 200, await readSkillContent(url.searchParams.get('id') ?? '', await getOverview()))
      case 'GET /usage':
        return send(res, 200, await getUsage())
      case 'GET /plugins/available':
        return send(res, 200, await listAvailablePlugins())
      case 'POST /personal/toggle': {
        const b = await readJson(req)
        return send(res, 200, await togglePersonal(b.name, b.enabled === true))
      }
      case 'POST /personal/delete':
        return send(res, 200, await deletePersonal((await readJson(req)).name))
      case 'POST /personal/create':
        return send(res, 200, await createPersonal(await readJson(req)))
      case 'POST /personal/scan-git':
        return send(res, 200, await scanGitRepo(await readJson(req)))
      case 'POST /personal/install-git':
        return send(res, 200, await installFromScan(await readJson(req)))
      case 'POST /plugins/toggle': {
        const b = await readJson(req)
        return send(res, 200, await togglePlugin(b.id, b.enabled === true))
      }
      case 'POST /bulk-toggle':
        return send(res, 200, await bulkToggle(await readJson(req)))
      case 'POST /plugins/uninstall':
        return send(res, 200, await uninstallPlugin((await readJson(req)).id))
      case 'POST /plugins/install':
        return send(res, 200, await installPlugin((await readJson(req)).id))
      default:
        return next()
    }
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500
    const message = err instanceof Error ? err.message : String(err)
    send(res, status, { error: message })
  }
}

export function skillsApi(): Plugin {
  return {
    name: 'claude-skills-api',
    configureServer(server) {
      server.middlewares.use('/api', apiHandler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/api', apiHandler)
    },
  }
}
