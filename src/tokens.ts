import type { Overview } from '../shared/types.ts'

/** Compact token count, e.g. 70, 830, 2.8k, 28k */
export function fmtTokens(n: number): string {
  if (n < 1000) return String(n)
  return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
}

export function fmtExact(n: number): string {
  return n.toLocaleString()
}

export interface BudgetSource {
  key: string
  label: string
  /** Tokens this source adds right now (0 when disabled) */
  active: number
  /** Tokens it would add with everything in it switched on */
  potential: number
  enabled: boolean
  /** 1–7 = categorical slot, 0 = folded into "Other" */
  slot: number
}

export interface Budget {
  total: number
  skills: number
  commands: number
  agents: number
  saved: number
  sources: BudgetSource[]
  other: { active: number; count: number }
}

const NAMED_SLOTS = 7

/**
 * Always-on token budget for a new session. Recomputed from the overview on every render,
 * so toggling a skill or plugin updates it immediately.
 */
export function computeBudget(overview: Overview): Budget {
  let skills = 0
  let commands = 0
  let personalActive = 0
  let personalPotential = 0

  for (const s of overview.skills) {
    if (s.source === 'personal') {
      personalPotential += s.tokens.alwaysOn
      if (s.enabled) personalActive += s.tokens.alwaysOn
    }
    if (!s.enabled) continue
    if (s.kind === 'command') commands += s.tokens.alwaysOn
    else skills += s.tokens.alwaysOn
  }

  const agents = overview.plugins.reduce((sum, p) => sum + (p.enabled ? p.agentTokens : 0), 0)

  const raw: Omit<BudgetSource, 'slot'>[] = [
    {
      key: 'personal',
      label: 'Personal skills',
      active: personalActive,
      potential: personalPotential,
      enabled: personalActive > 0,
    },
    ...overview.plugins.map((p) => ({
      key: p.id,
      label: p.name,
      active: p.enabled ? p.alwaysOnTokens : 0,
      potential: p.alwaysOnTokens,
      enabled: p.enabled,
    })),
  ]

  // Colour follows the entity: slots are assigned by *potential* size, so switching a
  // source off zeroes its segment without repainting everything else.
  const ranked = [...raw].sort((a, b) => b.potential - a.potential)
  const sources = ranked.map((s, i) => ({ ...s, slot: i < NAMED_SLOTS ? i + 1 : 0 }))
  const folded = sources.filter((s) => s.slot === 0)

  const total = skills + commands + agents
  const potential = raw.reduce((sum, s) => sum + s.potential, 0)

  return {
    total,
    skills,
    commands,
    agents,
    saved: potential - total,
    sources,
    other: { active: folded.reduce((sum, s) => sum + s.active, 0), count: folded.filter((s) => s.active > 0).length },
  }
}
