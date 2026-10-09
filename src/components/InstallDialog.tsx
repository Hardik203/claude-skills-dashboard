import { useState, type FormEvent, type ReactNode } from 'react'
import type { GitScanResult } from '../../shared/types.ts'
import { useAction, useGitScan } from '../api.ts'
import { fmtTokens } from '../tokens.ts'
import { Dialog } from './Dialog.tsx'

type Mode = 'git' | 'create'

export function InstallDialog({ onClose, onBrowsePlugins }: { onClose: () => void; onBrowsePlugins: () => void }) {
  const [mode, setMode] = useState<Mode>('git')

  const tabs = (
    <div className="segmented segmented-full" role="tablist">
      <button role="tab" aria-selected={mode === 'git'} onClick={() => setMode('git')}>
        From GitHub
      </button>
      <button role="tab" aria-selected={mode === 'create'} onClick={() => setMode('create')}>
        Write a new skill
      </button>
    </div>
  )
  const marketplaceLink = (
    <p className="hint">
      Looking for plugin bundles?{' '}
      <button
        type="button"
        className="link-btn"
        onClick={() => {
          onClose()
          onBrowsePlugins()
        }}
      >
        Browse the marketplace →
      </button>
    </p>
  )

  return (
    <Dialog title="Install a skill" onClose={onClose} wide>
      {mode === 'git' ? (
        <GitHubInstall tabs={tabs} footnote={marketplaceLink} onClose={onClose} />
      ) : (
        <CreateSkill tabs={tabs} footnote={marketplaceLink} onClose={onClose} />
      )}
    </Dialog>
  )
}

interface PaneProps {
  tabs: ReactNode
  footnote: ReactNode
  onClose: () => void
}

function GitHubInstall({ tabs, footnote, onClose }: PaneProps) {
  const scan = useGitScan()
  const [result, setResult] = useState<GitScanResult | null>(null)
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const install = useAction(onClose)

  const find = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    const form = new FormData(e.currentTarget)
    scan.mutate(
      { source: String(form.get('source') ?? ''), subdir: String(form.get('subdir') ?? '') },
      {
        onSuccess: (r) => {
          setResult(r)
          // A single skill is clearly what you asked for; from a collection, you choose.
          const installable = r.skills.filter((s) => !s.conflict)
          setPicked(new Set(installable.length === 1 ? [installable[0].path] : []))
        },
      },
    )
  }

  if (!result) {
    return (
      <>
        <div className="dialog-body">
          {tabs}
          <form id="git-find" className="form" onSubmit={find}>
            <label className="field">
              <span>GitHub repo</span>
              <input
                name="source"
                required
                autoFocus
                autoComplete="off"
                spellCheck={false}
                placeholder="owner/repo  or  https://github.com/owner/repo/tree/main/skills/x"
              />
            </label>
            <label className="field">
              <span>
                Sub-folder <span className="muted">(optional)</span>
              </span>
              <input name="subdir" autoComplete="off" spellCheck={false} placeholder="skills/my-skill" />
            </label>
            {scan.error && (
              <p className="error-text form-error" role="alert">
                {scan.error.message}
              </p>
            )}
            <p className="hint">
              We’ll list every skill in the repo so you can choose which to install — nothing is installed yet. Only install
              skills from sources you trust: they can instruct Claude to run commands.
            </p>
          </form>
          {footnote}
        </div>
        <footer className="dialog-foot">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" type="submit" form="git-find" disabled={scan.isPending}>
            {scan.isPending ? 'Cloning…' : 'Find skills'}
          </button>
        </footer>
      </>
    )
  }

  const installable = result.skills.filter((s) => !s.conflict)
  const allOn = installable.length > 0 && installable.every((s) => picked.has(s.path))
  const added = result.skills.filter((s) => picked.has(s.path)).reduce((sum, s) => sum + s.tokens.alwaysOn, 0)
  const toggle = (p: string) =>
    setPicked((prev) => {
      const next = new Set(prev)
      if (next.has(p)) next.delete(p)
      else next.add(p)
      return next
    })
  const where = [result.repo, result.subdir].filter(Boolean).join('/')

  return (
    <>
      <div className="dialog-body">
        {tabs}
        <div className="scan-head">
          <div>
            <strong>
              {result.skills.length} skill{result.skills.length === 1 ? '' : 's'}
            </strong>{' '}
            in <code>{where}</code>
            {result.ref && <span className="muted"> @ {result.ref}</span>}
          </div>
          <button type="button" className="link-btn" onClick={() => setResult(null)}>
            ← Different repo
          </button>
        </div>
        {installable.length > 1 && (
          <label className="pick-all scan-all">
            <input
              type="checkbox"
              checked={allOn}
              onChange={() => setPicked(allOn ? new Set() : new Set(installable.map((s) => s.path)))}
            />
            Select all ({installable.length})
          </label>
        )}
        <ul className="trim-list scan-list">
          {result.skills.map((s) => (
            <li key={s.path}>
              <label className={`trim-row scan-row${s.conflict ? ' is-off' : ''}`}>
                <input
                  type="checkbox"
                  checked={picked.has(s.path)}
                  disabled={!!s.conflict}
                  onChange={() => toggle(s.path)}
                />
                <span className="trim-name">
                  <span className="skill-title">
                    <span className="skill-name">{s.name}</span>
                    {s.conflict && <span className="badge">{s.conflict}</span>}
                    <span className="category-tag">{s.category}</span>
                  </span>
                  <span className="skill-desc">{s.description || <em>No description</em>}</span>
                </span>
                <span className="token-chip">
                  <span>
                    <strong>~{fmtTokens(s.tokens.alwaysOn)}</strong> always-on
                  </span>
                  <span className="muted">~{fmtTokens(s.tokens.onInvoke)} when used</span>
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      <footer className="dialog-foot scan-foot">
        <span className="muted small">{picked.size > 0 && `Adds ~${fmtTokens(added)} tokens to every session`}</span>
        <div className="scan-foot-actions">
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            disabled={picked.size === 0 || install.isPending}
            onClick={() =>
              install.mutate(
                { path: '/personal/install-git', body: { scanId: result.scanId, paths: [...picked] } },
                // The clone is only kept for 10 minutes; if it's gone, start over
                { onError: (err) => err.message.includes('expired') && setResult(null) },
              )
            }
          >
            {install.isPending
              ? 'Installing…'
              : picked.size === 0
                ? 'Pick skills to install'
                : `Install ${picked.size} skill${picked.size === 1 ? '' : 's'}`}
          </button>
        </div>
      </footer>
    </>
  )
}

function CreateSkill({ tabs, footnote, onClose }: PaneProps) {
  const action = useAction(onClose)
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault()
    action.mutate({ path: '/personal/create', body: Object.fromEntries(new FormData(e.currentTarget)) })
  }
  return (
    <>
      <div className="dialog-body">
        {tabs}
        <form id="create-skill" className="form" onSubmit={submit}>
          <label className="field">
            <span>Name</span>
            <input name="name" required pattern="[a-zA-Z0-9][a-zA-Z0-9._\-]{0,63}" placeholder="my-skill" autoFocus />
          </label>
          <label className="field">
            <span>Description</span>
            <input name="description" required placeholder="Use when… (Claude reads this to decide when to load the skill)" />
          </label>
          <label className="field">
            <span>Instructions</span>
            <textarea name="content" rows={9} placeholder={'# My skill\n\nStep-by-step instructions for Claude…'} />
          </label>
        </form>
        {footnote}
      </div>
      <footer className="dialog-foot">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button className="btn btn-primary" type="submit" form="create-skill" disabled={action.isPending}>
          {action.isPending ? 'Creating…' : 'Create skill'}
        </button>
      </footer>
    </>
  )
}
