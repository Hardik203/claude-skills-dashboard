import { useState } from 'react'
import type { ActionResult, InstalledPlugin, Overview, Skill, UsageReport } from '../../shared/types.ts'
import { useAction, useUsage } from '../api.ts'
import { computeBudget, fmtExact, fmtTokens } from '../tokens.ts'
import { Dialog } from './Dialog.tsx'

type Affected = NonNullable<ActionResult['affected']>

interface Plan {
  total: number
  personal: Skill[]
  /** Enabled plugins with no recorded use of any skill, command, agent or MCP tool */
  plugins: InstalledPlugin[]
  /** Plugins that stay on because something in them was used — Claude Code can't disable single plugin skills */
  kept: { plugin: InstalledPlugin; uses: number }[]
}

function pluginUses(p: InstalledPlugin, usage: UsageReport) {
  let n = 0
  for (const [key, u] of Object.entries(usage.uses)) {
    if (key.startsWith(`${p.name}:`) || key.startsWith(`mcp__plugin_${p.name}_`)) n += u.count
  }
  return n
}

function makePlan(overview: Overview, usage: UsageReport): Plan {
  const personal = overview.skills
    .filter((s) => s.source === 'personal' && s.enabled && s.valid && !usage.uses[s.invokeName])
    .sort((a, b) => b.tokens.alwaysOn - a.tokens.alwaysOn)
  const candidates = overview.plugins.filter((p) => p.enabled && p.skillCount + p.commandCount > 0)
  const withUses = candidates.map((plugin) => ({ plugin, uses: pluginUses(plugin, usage) }))
  return {
    total: computeBudget(overview).total,
    personal,
    plugins: withUses
      .filter((p) => p.uses === 0)
      .map((p) => p.plugin)
      .sort((a, b) => b.alwaysOnTokens - a.alwaysOnTokens),
    kept: withUses.filter((p) => p.uses > 0).sort((a, b) => b.uses - a.uses),
  }
}

interface UnusedDialogProps {
  overview: Overview
  onClose: () => void
  onDone: (affected: Affected) => void
}

export function UnusedDialog(props: UnusedDialogProps) {
  const usage = useUsage()
  if (!usage.data) {
    return (
      <Dialog title="Disable unused skills" onClose={props.onClose} wide>
        <div className="dialog-body">
          {usage.error ? (
            <p className="error-text">Couldn’t read your session history: {usage.error.message}</p>
          ) : (
            <div className="skeleton-block" aria-busy="true" />
          )}
        </div>
      </Dialog>
    )
  }
  return <UnusedPlanner {...props} usage={usage.data} />
}

function UnusedPlanner({ overview, usage, onClose, onDone }: UnusedDialogProps & { usage: UsageReport }) {
  // Snapshot on open: the optimistic update flips these to disabled while the request runs.
  const [plan] = useState(() => makePlan(overview, usage))
  // Plugins with hooks or MCP servers can be working without any recorded call, so they start unticked.
  const [pickedSkills, setPickedSkills] = useState(() => new Set(plan.personal.map((s) => s.name)))
  const [pickedPlugins, setPickedPlugins] = useState(
    () => new Set(plan.plugins.filter((p) => !p.hasHooks && !p.hasMcp).map((p) => p.id)),
  )
  const action = useAction((r) => {
    if (r.affected) onDone(r.affected)
    onClose()
  })

  const cut =
    plan.personal.filter((s) => pickedSkills.has(s.name)).reduce((sum, s) => sum + s.tokens.alwaysOn, 0) +
    plan.plugins.filter((p) => pickedPlugins.has(p.id)).reduce((sum, p) => sum + p.alwaysOnTokens, 0)
  const after = plan.total - cut
  const pct = plan.total ? (cut / plan.total) * 100 : 0
  const count = pickedSkills.size + pickedPlugins.size
  const since = usage.since
    ? new Date(usage.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    : 'the start of your history'

  return (
    <Dialog title="Disable unused skills" onClose={onClose} wide>
      <div className="dialog-body">
        <div className="trim-projection" aria-live="polite">
          <span className="trim-num">{fmtExact(plan.total)}</span>
          <span className="trim-arrow" aria-hidden="true">
            →
          </span>
          <span className="trim-num trim-after">{fmtExact(after)}</span>
          <span className="muted">tokens per session{cut > 0 && ` (−${pct < 1 ? '<1' : Math.round(pct)}%)`}</span>
        </div>
        <p className="hint unused-basis">
          “Unused” means no recorded use in your last {usage.sessions} sessions (since {since}). Skills you use rarely may
          still be listed — untick anything you want to keep.
        </p>

        <PickSection
          title="Personal skills"
          empty="Every enabled personal skill has been used."
          items={plan.personal.map((s) => ({ id: s.name, label: s.name, tokens: s.tokens.alwaysOn }))}
          picked={pickedSkills}
          onChange={setPickedSkills}
        />

        <PickSection
          title="Plugins with nothing used"
          empty="You’ve used something from every enabled plugin."
          items={plan.plugins.map((p) => ({
            id: p.id,
            label: p.name,
            tokens: p.alwaysOnTokens,
            detail: `${p.skillCount} skills · ${p.commandCount} commands`,
            warning: p.hasHooks || p.hasMcp ? (p.hasHooks ? 'runs hooks' : 'MCP server') : undefined,
          }))}
          picked={pickedPlugins}
          onChange={setPickedPlugins}
        />

        {plan.kept.length > 0 && (
          <p className="hint">
            <strong>Staying on</strong> because you used something in them (Claude Code can only switch plugins as a whole):{' '}
            {plan.kept.map((k) => `${k.plugin.name} (${k.uses}×)`).join(', ')}.
          </p>
        )}
        <p className="hint">Plugins marked “runs hooks” or “MCP server” can be working in the background without showing up as used, so they start unticked.</p>
      </div>
      <footer className="dialog-foot">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-danger"
          disabled={count === 0 || action.isPending}
          onClick={() =>
            action.mutate({
              path: '/bulk-toggle',
              body: { personal: [...pickedSkills], plugins: [...pickedPlugins], enabled: false },
            })
          }
        >
          {action.isPending ? 'Disabling…' : `Disable ${count} item${count === 1 ? '' : 's'}${cut ? ` · save ~${fmtTokens(cut)}` : ''}`}
        </button>
      </footer>
    </Dialog>
  )
}

interface PickItem {
  id: string
  label: string
  tokens: number
  detail?: string
  warning?: string
}

function PickSection({
  title,
  empty,
  items,
  picked,
  onChange,
}: {
  title: string
  empty: string
  items: PickItem[]
  picked: Set<string>
  onChange: (next: Set<string>) => void
}) {
  const allOn = items.length > 0 && items.every((i) => picked.has(i.id))
  const toggle = (id: string) => {
    const next = new Set(picked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    onChange(next)
  }
  return (
    <section className="pick-section">
      <header className="pick-head">
        <h3>
          {title} <span className="muted">({items.length})</span>
        </h3>
        {items.length > 0 && (
          <label className="pick-all">
            <input
              type="checkbox"
              checked={allOn}
              onChange={() => onChange(allOn ? new Set() : new Set(items.map((i) => i.id)))}
            />
            Select all
          </label>
        )}
      </header>
      {items.length === 0 ? (
        <p className="muted small">{empty}</p>
      ) : (
        <ul className="trim-list pick-list">
          {items.map((i) => (
            <li key={i.id}>
              <label className="trim-row">
                <input type="checkbox" checked={picked.has(i.id)} onChange={() => toggle(i.id)} />
                <span className="trim-name">
                  <span className="skill-name">
                    {i.label} {i.warning && <span className="badge badge-warn">{i.warning}</span>}
                  </span>
                  {i.detail && <span className="muted small">{i.detail}</span>}
                </span>
                <span className="trim-cost">~{fmtTokens(i.tokens)}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
