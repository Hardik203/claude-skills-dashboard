import { useState } from 'react'
import type { ActionResult, Overview } from '../../shared/types.ts'
import { useAction } from '../api.ts'
import { computeBudget, fmtExact, fmtTokens } from '../tokens.ts'
import { Dialog } from './Dialog.tsx'

const DEFAULT_PICK = 3

interface TrimDialogProps {
  overview: Overview
  onClose: () => void
  onTrimmed: (affected: NonNullable<ActionResult['affected']>) => void
}

/** Pick the heaviest enabled plugins and disable them in one go, with a live before → after projection. */
export function TrimDialog({ overview, onClose, onTrimmed }: TrimDialogProps) {
  // Snapshot on open: the optimistic update disables picked plugins in the cache while the request runs.
  const [{ candidates, total }] = useState(() => ({
    candidates: overview.plugins
      .filter((p) => p.enabled && p.alwaysOnTokens > 0)
      .sort((a, b) => b.alwaysOnTokens - a.alwaysOnTokens),
    total: computeBudget(overview).total,
  }))
  const [picked, setPicked] = useState(() => new Set(candidates.slice(0, DEFAULT_PICK).map((p) => p.id)))
  const action = useAction((r: ActionResult) => {
    if (r.affected) onTrimmed(r.affected)
    onClose()
  })

  const cut = candidates.filter((p) => picked.has(p.id)).reduce((sum, p) => sum + p.alwaysOnTokens, 0)
  const after = total - cut
  const pctCut = total ? Math.round((cut / total) * 100) : 0

  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const pickTop = (n: number) => setPicked(new Set(candidates.slice(0, n).map((p) => p.id)))

  return (
    <Dialog title="Trim heaviest plugins" onClose={onClose} wide>
      <div className="dialog-body">
        <div className="trim-projection" aria-live="polite">
          <span className="trim-num">{fmtExact(total)}</span>
          <span className="trim-arrow" aria-hidden="true">
            →
          </span>
          <span className="trim-num trim-after">{fmtExact(after)}</span>
          <span className="muted">tokens per session{cut > 0 && ` (−${pctCut < 1 ? '<1' : pctCut}%)`}</span>
        </div>

        <div className="trim-quick">
          <span className="muted small">Select:</span>
          {[1, 3, 5].map((n) => (
            <button key={n} type="button" className="chip-btn" onClick={() => pickTop(n)} disabled={candidates.length < n}>
              Top {n}
            </button>
          ))}
          <button type="button" className="chip-btn" onClick={() => setPicked(new Set())}>
            None
          </button>
        </div>

        {candidates.length === 0 ? (
          <p className="muted">No enabled plugins to trim.</p>
        ) : (
          <ul className="trim-list">
            {candidates.map((p) => (
              <li key={p.id}>
                <label className="trim-row">
                  <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                  <span className="trim-name">
                    <span className="skill-name">{p.name}</span>
                    <span className="muted small">
                      {p.skillCount} skills · {p.commandCount} commands · {p.agentCount} agents
                    </span>
                  </span>
                  <span className="trim-cost">
                    ~{fmtTokens(p.alwaysOnTokens)}
                    <span className="muted small"> {total ? ((p.alwaysOnTokens / total) * 100).toFixed(1) : 0}%</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <p className="hint">Disabled plugins stay installed — switch them back on any time from the Plugins tab, or use Undo.</p>
      </div>
      <footer className="dialog-foot">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className="btn btn-danger"
          disabled={picked.size === 0 || action.isPending}
          onClick={() => action.mutate({ path: '/bulk-toggle', body: { plugins: [...picked], enabled: false } })}
        >
          {action.isPending
            ? 'Disabling…'
            : `Disable ${picked.size} plugin${picked.size === 1 ? '' : 's'}${cut ? ` · save ~${fmtTokens(cut)}` : ''}`}
        </button>
      </footer>
    </Dialog>
  )
}
