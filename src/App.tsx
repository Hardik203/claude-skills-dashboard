import { useState } from 'react'
import { useOverview } from './api.ts'
import { InstallDialog } from './components/InstallDialog.tsx'
import { MarketplaceView } from './components/MarketplaceView.tsx'
import { PluginsView } from './components/PluginsView.tsx'
import { SkillsView } from './components/SkillsView.tsx'
import { TokenBudget } from './components/TokenBudget.tsx'
import { ThemeToggle } from './components/ThemeToggle.tsx'

type Tab = 'skills' | 'plugins' | 'marketplace'

export default function App() {
  const [tab, setTab] = useState<Tab>('skills')
  const [installOpen, setInstallOpen] = useState(false)
  const { data, isPending, error, refetch, isFetching } = useOverview()

  const enabled = data?.skills.filter((s) => s.enabled).length ?? 0
  const personal = data?.skills.filter((s) => s.source === 'personal').length ?? 0
  const activePlugins = data?.plugins.filter((p) => p.enabled).length ?? 0

  return (
    <div className="app">
      <header className="top">
        <div>
          <h1>Claude Code Skills</h1>
          <p className="muted">
            Everything Claude can load in a new session — personal skills from <code>~/.claude/skills</code> and skills bundled in
            plugins.
          </p>
        </div>
        <div className="top-actions">
          <ThemeToggle />
          <button className="btn" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? 'Refreshing…' : 'Refresh'}
          </button>
          <button className="btn btn-primary" onClick={() => setInstallOpen(true)}>
            + Install skill
          </button>
        </div>
      </header>

      {data && (
        <div className="stats">
          <Stat label="Active skills & commands" value={enabled} total={data.skills.length} />
          <Stat label="Disabled" value={data.skills.length - enabled} />
          <Stat label="Personal skills" value={personal} />
          <Stat label="Plugins enabled" value={activePlugins} total={data.plugins.length} />
        </div>
      )}

      {data && <TokenBudget overview={data} />}

      <nav className="tabs" role="tablist">
        {(
          [
            ['skills', 'Skills'],
            ['plugins', 'Plugins'],
            ['marketplace', 'Marketplace'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
            {label}
            {data && id === 'skills' && <span className="tab-count">{data.skills.length}</span>}
            {data && id === 'plugins' && <span className="tab-count">{data.plugins.length}</span>}
          </button>
        ))}
      </nav>

      <main>
        {isPending && <div className="skeleton-list" aria-busy="true" />}
        {error && (
          <div className="empty error-text">
            Couldn’t read your skills: {error.message}
            <button className="btn" onClick={() => refetch()}>
              Retry
            </button>
          </div>
        )}
        {data && tab === 'skills' && <SkillsView overview={data} />}
        {data && tab === 'plugins' && <PluginsView plugins={data.plugins} />}
        {data && tab === 'marketplace' && <MarketplaceView installedIds={new Set(data.plugins.map((p) => p.id))} />}
      </main>

      <p className="footnote muted">
        Changes take effect in new Claude Code sessions. Disabled personal skills are parked in <code>~/.claude/skills-disabled</code>;
        deleted ones go to the Trash.
      </p>

      {installOpen && <InstallDialog onClose={() => setInstallOpen(false)} onBrowsePlugins={() => setTab('marketplace')} />}
    </div>
  )
}

function Stat({ label, value, total }: { label: string; value: number; total?: number }) {
  return (
    <div className="stat">
      <span className="stat-value">
        {value}
        {total !== undefined && <span className="stat-total"> / {total}</span>}
      </span>
      <span className="stat-label">{label}</span>
    </div>
  )
}
