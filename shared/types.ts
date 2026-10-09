import type { Category } from './categories.ts'

export type SkillSource = 'personal' | 'plugin'
export type SkillKind = 'skill' | 'command'

/**
 * Estimated tokens, using the same chars/4 heuristic as `claude plugin details`.
 * alwaysOn: the `- name: description` line Claude Code puts in every session's system prompt.
 * onInvoke: the SKILL.md body, loaded only when the skill actually runs.
 */
export interface TokenCost {
  alwaysOn: number
  onInvoke: number
}

export interface Skill {
  /** Stable id: `personal:<dir>` or `plugin:<pluginId>:<kind>:<name>` */
  id: string
  name: string
  description: string
  source: SkillSource
  kind: SkillKind
  enabled: boolean
  path: string
  pluginId?: string
  isSymlink?: boolean
  /** False when a personal skill folder has no SKILL.md (Claude Code ignores it) */
  valid: boolean
  tokens: TokenCost
  /** Topic inferred from name + description (or a declared frontmatter `category`) */
  category: Category
  /** Name Claude Code uses to invoke it (`plugin:skill`, or a personal skill's frontmatter name) */
  invokeName: string
}

export interface InstalledPlugin {
  id: string
  name: string
  marketplace: string
  version: string
  enabled: boolean
  installPath: string
  installedAt?: string
  skillCount: number
  commandCount: number
  agentCount: number
  /** Always-on tokens from the plugin's agents (not listed as skills, but loaded every session) */
  agentTokens: number
  /** Skills + commands + agents, whether or not the plugin is currently enabled */
  alwaysOnTokens: number
  /** Runs hooks automatically — can be "in use" with no recorded skill calls */
  hasHooks: boolean
  /** Ships an MCP server */
  hasMcp: boolean
}

export interface AvailablePlugin {
  pluginId: string
  name: string
  description: string
  marketplaceName: string
  version?: string
  /** Shared topic taxonomy (same as skills): the marketplace's declared category when it maps cleanly, else inferred */
  category: Category
  /** Raw `category` from the marketplace manifest, if any */
  declaredCategory?: string
  /** Install count reported by the marketplace; absent for marketplaces that don't publish one */
  installCount?: number
}

export interface Overview {
  skills: Skill[]
  plugins: InstalledPlugin[]
  paths: { skillsDir: string; disabledDir: string }
}

export interface SkillUsage {
  count: number
  lastUsed: string
}

/** How often each skill was used, from local Claude Code session transcripts */
export interface UsageReport {
  /**
   * Keyed by invoke name: skills/commands (`superpowers:brainstorming`, `graphify`), plugin agents
   * (`ecc:code-reviewer`), and plugin MCP servers (`mcp__plugin_repowise_repowise`).
   */
  uses: Record<string, SkillUsage>
  sessions: number
  /** Earliest timestamp seen — usage before this is unknown (old transcripts get cleaned up) */
  since: string | null
}

/** A skill found in a GitHub repo, before installing */
export interface GitScanSkill {
  /** Folder inside the repo ('.' for the repo root) */
  path: string
  name: string
  description: string
  tokens: TokenCost
  category: Category
  /** Why it can't be installed (e.g. already installed), if it can't */
  conflict?: string
}

export interface GitScanResult {
  /** Pass back to /personal/install-git; the clone is kept for 10 minutes */
  scanId: string
  repo: string
  ref: string | null
  subdir: string | null
  skills: GitScanSkill[]
}

export interface ActionResult {
  ok: true
  message: string
  installed?: string[]
  /** What a bulk toggle actually changed — used for Undo */
  affected?: { personal: string[]; plugins: string[] }
}
