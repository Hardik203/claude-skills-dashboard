import { useState } from 'react'
import type { Overview } from '../../shared/types.ts'
import { useAction } from '../api.ts'
import { computeBudget, fmtExact, fmtTokens } from '../tokens.ts'
import { TrimDialog } from './TrimDialog.tsx'
import { UnusedDialog } from './UnusedDialog.tsx'
import type { ActionResult } from '../../shared/types.ts'

interface Segment {
  key: string
  label: string
  value: number
  slot: number
}

export function TokenBudget({ overview }: { overview: Overview }) {
  const budget = computeBudget(overview)
  const [hovered, setHovered] = useState<string | null>(null)
  const [open, setOpen] = useState<'trim' | 'unused' | null>(null)
  // Last bulk change, so it can be undone in one click
  const [lastChange, setLastChange] = useState<NonNullable<ActionResult['affected']> | null>(null)
  const undo = useAction(() => setLastChange(null))
  const undoCount = lastChange ? lastChange.personal.length + lastChange.plugins.length : 0

  const named = budget.sources.filter((s) => s.slot > 0)
  const segments: Segment[] = named
    .filter((s) => s.active > 0)
    .map((s) => ({ key: s.key, label: s.label, value: s.active, slot: s.slot }))
  if (budget.other.active > 0) {
    segments.push({ key: 'other', label: `${budget.other.count} others`, value: budget.other.active, slot: 0 })
  }

  let offset = 0
  const placed = segments.map((seg) => {
    const width = budget.total ? (seg.value / budget.total) * 100 : 0
    const out = { ...seg, left: offset, width }
    offset += width
    return out
  })
  const active = placed.find((s) => s.key === hovered)
  const pct = (n: number) => (budget.total ? `${((n / budget.total) * 100).toFixed(1)}%` : '0%')

  return (
    <section className="budget" aria-labelledby="budget-title">
      <div className="budget-head">
        <div>
          <h2 id="budget-title" className="budget-label">
            Always-on tokens per session
          </h2>
          <p className="budget-total">
            ≈ {fmtExact(budget.total)}
            <span className="budget-unit"> tokens</span>
          </p>
          <p className="muted budget-sub">
            Skills {fmtExact(budget.skills)} · Commands {fmtExact(budget.commands)} · Plugin agents {fmtExact(budget.agents)}
          </p>
        </div>
        <div className="budget-side">
          <div className="budget-saved">
            <span className="budget-saved-value">−{fmtExact(budget.saved)}</span>
            <span className="muted">saved by disabled items</span>
          </div>
          <div className="budget-actions">
            {lastChange && undoCount > 0 && (
              <button
                className="btn btn-sm"
                disabled={undo.isPending}
                onClick={() => undo.mutate({ path: '/bulk-toggle', body: { ...lastChange, enabled: true } })}
              >
                {undo.isPending ? 'Restoring…' : `Undo (${undoCount})`}
              </button>
            )}
            <button className="btn btn-sm" onClick={() => setOpen('unused')}>
              <SleepIcon /> Disable unused
            </button>
            <button className="btn btn-sm" onClick={() => setOpen('trim')}>
              <ScissorsIcon /> Trim heaviest plugins
            </button>
          </div>
        </div>
      </div>

      <div className="budget-bar-wrap" onMouseLeave={() => setHovered(null)}>
        <div className="budget-bar" aria-hidden="true">
          {placed.map((seg) => (
            <div
              key={seg.key}
              className={`budget-seg${hovered && hovered !== seg.key ? ' is-dim' : ''}`}
              style={{ left: `${seg.left}%`, width: `${seg.width}%`, background: `var(--series-${seg.slot || 'other'})` }}
              onMouseEnter={() => setHovered(seg.key)}
            />
          ))}
        </div>
        {active && (
          <div className="budget-tip" style={{ left: `${Math.min(Math.max(active.left + active.width / 2, 8), 92)}%` }}>
            <strong>{active.label}</strong>
            <span>
              ≈ {fmtExact(active.value)} tokens · {pct(active.value)}
            </span>
          </div>
        )}
      </div>

      <table className="budget-legend">
        <caption className="sr-only">Always-on tokens by source</caption>
        <tbody>
          {named.map((s) => (
            <tr
              key={s.key}
              className={`${s.active === 0 ? 'is-off' : ''}${hovered === s.key ? ' is-hot' : ''}`}
              onMouseEnter={() => setHovered(s.key)}
              onMouseLeave={() => setHovered(null)}
            >
              <th scope="row">
                <span className="swatch" style={{ background: `var(--series-${s.slot})` }} />
                {s.label}
              </th>
              <td>{s.active === 0 ? 'off' : `~${fmtTokens(s.active)}`}</td>
              <td className="muted">{s.active === 0 ? `would add ~${fmtTokens(s.potential)}` : pct(s.active)}</td>
            </tr>
          ))}
          {budget.other.active > 0 && (
            <tr className={hovered === 'other' ? 'is-hot' : ''}>
              <th scope="row">
                <span className="swatch" style={{ background: 'var(--series-other)' }} />
                {budget.other.count} others
              </th>
              <td>~{fmtTokens(budget.other.active)}</td>
              <td className="muted">{pct(budget.other.active)}</td>
            </tr>
          )}
        </tbody>
      </table>

      {open === 'trim' && <TrimDialog overview={overview} onClose={() => setOpen(null)} onTrimmed={setLastChange} />}
      {open === 'unused' && <UnusedDialog overview={overview} onClose={() => setOpen(null)} onDone={setLastChange} />}

      <p className="budget-note muted">
        Estimates use Claude Code’s own method (≈4 characters per token, same as <code>claude plugin details</code>). Each skill’s
        full instructions cost extra only when it runs — see the “when used” figure on each row.
      </p>
    </section>
  )
}

function ScissorsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12" />
    </svg>
  )
}

function SleepIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" />
      <path d="M8 12h8" />
    </svg>
  )
}
