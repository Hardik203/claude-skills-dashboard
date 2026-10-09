import { useState } from 'react'
import type { InstalledPlugin } from '../../shared/types.ts'
import { useAction } from '../api.ts'
import { ConfirmDialog } from './Dialog.tsx'
import { Switch } from './Switch.tsx'
import { TrashIcon } from './SkillsView.tsx'
import { fmtTokens } from '../tokens.ts'

export function PluginsView({ plugins }: { plugins: InstalledPlugin[] }) {
  if (plugins.length === 0) return <div className="empty">No plugins installed yet. Browse the Marketplace tab to add some.</div>
  const bySize = [...plugins].sort((a, b) => b.alwaysOnTokens - a.alwaysOnTokens)
  return (
    <div className="plugin-grid">
      {bySize.map((p) => (
        <PluginCard key={p.id} plugin={p} />
      ))}
    </div>
  )
}

function PluginCard({ plugin }: { plugin: InstalledPlugin }) {
  const [confirmUninstall, setConfirmUninstall] = useState(false)
  const action = useAction(() => setConfirmUninstall(false))

  return (
    <article className={`plugin-card${plugin.enabled ? '' : ' is-off'}`}>
      <header className="plugin-head">
        <div>
          <h3>{plugin.name}</h3>
          <p className="muted">
            {plugin.marketplace} · v{plugin.version}
          </p>
        </div>
        <Switch
          checked={plugin.enabled}
          pending={action.isPending && !confirmUninstall}
          label={`${plugin.enabled ? 'Disable' : 'Enable'} ${plugin.name}`}
          onChange={(enabled) => action.mutate({ path: '/plugins/toggle', body: { id: plugin.id, enabled } })}
        />
      </header>
      <dl className="plugin-stats">
        <div>
          <dt>Always-on</dt>
          <dd title={`${plugin.alwaysOnTokens.toLocaleString()} tokens per session`}>~{fmtTokens(plugin.alwaysOnTokens)}</dd>
        </div>
        <div>
          <dt>Skills</dt>
          <dd>{plugin.skillCount}</dd>
        </div>
        <div>
          <dt>Commands</dt>
          <dd>{plugin.commandCount}</dd>
        </div>
        <div>
          <dt>Agents</dt>
          <dd>{plugin.agentCount}</dd>
        </div>
      </dl>
      <footer className="plugin-foot">
        {plugin.installedAt && (
          <span className="muted small">Installed {new Date(plugin.installedAt).toLocaleDateString()}</span>
        )}
        <button className="btn btn-ghost-danger" onClick={() => setConfirmUninstall(true)}>
          <TrashIcon /> Uninstall
        </button>
      </footer>

      {confirmUninstall && (
        <ConfirmDialog
          title={`Uninstall ${plugin.name}?`}
          body={
            <p>
              Runs <code>claude plugin uninstall {plugin.id}</code>. This removes {plugin.skillCount} skills and{' '}
              {plugin.commandCount} commands. You can reinstall it from the Marketplace tab.
            </p>
          }
          confirmLabel="Uninstall"
          danger
          pending={action.isPending}
          onConfirm={() => action.mutate({ path: '/plugins/uninstall', body: { id: plugin.id } })}
          onClose={() => setConfirmUninstall(false)}
        />
      )}
    </article>
  )
}
