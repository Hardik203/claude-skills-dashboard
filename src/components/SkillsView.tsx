import { useState } from 'react'
import type { InstalledPlugin, Overview, Skill, SkillUsage, UsageReport } from '../../shared/types.ts'
import { useAction, useSkillContent, useUsage } from '../api.ts'
import { ConfirmDialog, Dialog } from './Dialog.tsx'
import { Switch } from './Switch.tsx'
import { fmtTokens } from '../tokens.ts'
import { CATEGORIES, type Category } from '../../shared/categories.ts'

type Status = 'all' | 'enabled' | 'disabled'
type Sort = 'name' | 'alwaysOn' | 'onInvoke' | 'category' | 'usage'

const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' })

function timeAgo(iso: string) {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000)
  if (days > -1) return 'today'
  if (days > -7) return relative.format(days, 'day')
  if (days > -60) return relative.format(Math.round(days / 7), 'week')
  return relative.format(Math.round(days / 30), 'month')
}

/** Most used first (ties: most recent); never-used skills after, heaviest token cost first. */
function byUsage(usage: UsageReport) {
  return (a: Skill, b: Skill) => {
    const ua = usage.uses[a.invokeName]
    const ub = usage.uses[b.invokeName]
    if (ua && ub) return ub.count - ua.count || ub.lastUsed.localeCompare(ua.lastUsed)
    if (ua || ub) return ua ? -1 : 1
    return b.tokens.alwaysOn - a.tokens.alwaysOn
  }
}

interface Group {
  category: Category
  skills: Skill[]
  /** Always-on tokens from the group's enabled skills */
  tokens: number
}

/** Group by category; heaviest categories first, skills by name within each. */
function groupByCategory(skills: Skill[]): Group[] {
  const map = new Map<Category, Group>()
  for (const s of skills) {
    const g = map.get(s.category) ?? { category: s.category, skills: [], tokens: 0 }
    g.skills.push(s)
    if (s.enabled) g.tokens += s.tokens.alwaysOn
    map.set(s.category, g)
  }
  return [...map.values()].sort((a, b) => b.tokens - a.tokens || a.category.localeCompare(b.category))
}

export function SkillsView({ overview }: { overview: Overview }) {
  const [query, setQuery] = useState('')
  const [source, setSource] = useState('all')
  const [status, setStatus] = useState<Status>('all')
  const [sort, setSort] = useState<Sort>('name')
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [openId, setOpenId] = useState<string | null>(null)
  const usage = useUsage()

  const q = query.trim().toLowerCase()
  const visible = overview.skills.filter((s) => {
    if (status === 'enabled' && !s.enabled) return false
    if (status === 'disabled' && s.enabled) return false
    if (source === 'personal' && s.source !== 'personal') return false
    if (source !== 'all' && source !== 'personal' && s.pluginId !== source) return false
    if (category !== 'all' && s.category !== category) return false
    return !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q)
  })
  if (sort === 'alwaysOn' || sort === 'onInvoke') visible.sort((a, b) => b.tokens[sort] - a.tokens[sort])
  if (sort === 'usage' && usage.data) visible.sort(byUsage(usage.data))
  const usedCount = usage.data ? visible.filter((s) => usage.data.uses[s.invokeName]).length : 0
  const groups = sort === 'category' ? groupByCategory(visible) : null
  const categoryCounts = new Map<Category, number>()
  for (const s of overview.skills) categoryCounts.set(s.category, (categoryCounts.get(s.category) ?? 0) + 1)
  const pluginsById = new Map(overview.plugins.map((p) => [p.id, p]))
  const openSkill = overview.skills.find((s) => s.id === openId) ?? null

  return (
    <section>
      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search skills by name or description…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search skills"
        />
        <select className="select" value={source} onChange={(e) => setSource(e.target.value)} aria-label="Source">
          <option value="all">All sources</option>
          <option value="personal">Personal (~/.claude/skills)</option>
          {overview.plugins.map((p) => (
            <option key={p.id} value={p.id}>
              Plugin · {p.name}
            </option>
          ))}
        </select>
        <select className="select select-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="name">Sort: Name</option>
          <option value="alwaysOn">Sort: Always-on tokens</option>
          <option value="onInvoke">Sort: Tokens when used</option>
          <option value="category">Sort: Category</option>
          <option value="usage">Sort: Most used by me</option>
        </select>
        <select
          className="select"
          value={category}
          onChange={(e) => setCategory(e.target.value as Category | 'all')}
          aria-label="Category"
        >
          <option value="all">All categories</option>
          {CATEGORIES.filter((c) => categoryCounts.has(c)).map((c) => (
            <option key={c} value={c}>
              {c} ({categoryCounts.get(c)})
            </option>
          ))}
        </select>
        <div className="segmented" role="radiogroup" aria-label="Status">
          {(['all', 'enabled', 'disabled'] as const).map((s) => (
            <button key={s} role="radio" aria-checked={status === s} onClick={() => setStatus(s)}>
              {s[0].toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <p className="result-count">
        {visible.length} of {overview.skills.length}
        {sort === 'usage' && usage.data && (
          <span>
            {' '}
            · {usedCount} used in your last {usage.data.sessions} sessions
            {usage.data.since && ` (since ${new Date(usage.data.since).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })})`}
            {' '}· unused ones sorted by token cost
          </span>
        )}
        {sort === 'usage' && usage.isPending && <span> · reading your session history…</span>}
        {sort === 'usage' && usage.error && <span className="error-text"> · couldn’t read usage: {usage.error.message}</span>}
      </p>

      {visible.length === 0 ? (
        <div className="empty">No skills match these filters.</div>
      ) : groups ? (
        groups.map((g) => (
          <details key={g.category} className="category-group" open>
            <summary>
              <span className="category-title">{g.category}</span>
              <span className="muted small">
                {g.skills.length} {g.skills.length === 1 ? 'skill' : 'skills'} · ~{fmtTokens(g.tokens)} always-on
              </span>
            </summary>
            <ul className="skill-list">
              {g.skills.map((skill) => (
                <SkillRow
                  key={skill.id}
                  skill={skill}
                  plugin={skill.pluginId ? pluginsById.get(skill.pluginId) : undefined}
                  onOpen={() => setOpenId(skill.id)}
                  showCategory={false}
                  usage={usage.data?.uses[skill.invokeName]}
                />
              ))}
            </ul>
          </details>
        ))
      ) : (
        <ul className="skill-list">
          {visible.map((skill) => (
            <SkillRow
              key={skill.id}
              skill={skill}
              plugin={skill.pluginId ? pluginsById.get(skill.pluginId) : undefined}
              onOpen={() => setOpenId(skill.id)}
              usage={usage.data?.uses[skill.invokeName]}
              showUnused={sort === 'usage' && !!usage.data}
            />
          ))}
        </ul>
      )}

      {openSkill && <SkillDrawer skill={openSkill} onClose={() => setOpenId(null)} />}
    </section>
  )
}

interface SkillRowProps {
  skill: Skill
  plugin?: InstalledPlugin
  onOpen: () => void
  showCategory?: boolean
  usage?: SkillUsage
  /** Mark skills with no recorded use (only meaningful while sorting by usage) */
  showUnused?: boolean
}

function SkillRow({ skill, plugin, onOpen, showCategory = true, usage, showUnused = false }: SkillRowProps) {
  const [confirm, setConfirm] = useState<'delete' | 'plugin' | null>(null)
  const action = useAction(() => setConfirm(null))
  const isPersonal = skill.source === 'personal'

  const toggle = (enabled: boolean) => {
    if (isPersonal) action.mutate({ path: '/personal/toggle', body: { name: skill.name, enabled } })
    else setConfirm('plugin')
  }

  return (
    <li className={`skill-row${skill.enabled ? '' : ' is-off'}`}>
      <button className="skill-main" onClick={onOpen}>
        <span className="skill-title">
          <span className="skill-name">{skill.name}</span>
          <span className={`badge badge-${skill.source}`}>{isPersonal ? 'Personal' : skill.kind === 'command' ? 'Command' : 'Plugin'}</span>
          {skill.isSymlink && <span className="badge">Symlink</span>}
          {!skill.valid && <span className="badge badge-warn">No SKILL.md</span>}
          {showCategory && <span className="category-tag">{skill.category}</span>}
          {usage ? (
            <span className="usage-tag" title={`Last used ${new Date(usage.lastUsed).toLocaleString()}`}>
              Used {usage.count}× · {timeAgo(usage.lastUsed)}
            </span>
          ) : (
            showUnused && <span className="usage-tag usage-none">Not used</span>
          )}
        </span>
        <span className="skill-desc">{skill.description || <em>No description</em>}</span>
      </button>

      {skill.valid && (
        <div className="token-chip" title="Estimated tokens: always loaded in every session / added when the skill runs">
          <span>
            <strong>~{fmtTokens(skill.tokens.alwaysOn)}</strong> always-on
          </span>
          <span className="muted">~{fmtTokens(skill.tokens.onInvoke)} when used</span>
        </div>
      )}

      <div className="skill-actions">
        <Switch
          checked={skill.enabled}
          onChange={toggle}
          pending={action.isPending && confirm === null}
          label={`${skill.enabled ? 'Disable' : 'Enable'} ${skill.name}`}
        />
        {isPersonal && (
          <button className="icon-btn danger" onClick={() => setConfirm('delete')} aria-label={`Delete ${skill.name}`} title="Delete">
            <TrashIcon />
          </button>
        )}
      </div>

      {confirm === 'delete' && (
        <ConfirmDialog
          title={`Delete ${skill.name}?`}
          body={
            <p>
              The folder <code>{skill.path}</code> will be moved to the Trash. You can restore it from there.
            </p>
          }
          confirmLabel="Move to Trash"
          danger
          pending={action.isPending}
          onConfirm={() => action.mutate({ path: '/personal/delete', body: { name: skill.name } })}
          onClose={() => setConfirm(null)}
        />
      )}

      {confirm === 'plugin' && plugin && (
        <ConfirmDialog
          title={`${plugin.enabled ? 'Disable' : 'Enable'} plugin ${plugin.name}?`}
          body={
            <p>
              <strong>{skill.name}</strong> ships inside the <strong>{plugin.id}</strong> plugin. Claude Code toggles plugins as a
              whole, so this will {plugin.enabled ? 'disable' : 'enable'} all {plugin.skillCount + plugin.commandCount} of its skills
              and commands.
            </p>
          }
          confirmLabel={plugin.enabled ? 'Disable plugin' : 'Enable plugin'}
          danger={plugin.enabled}
          pending={action.isPending}
          onConfirm={() => action.mutate({ path: '/plugins/toggle', body: { id: plugin.id, enabled: !plugin.enabled } })}
          onClose={() => setConfirm(null)}
        />
      )}
    </li>
  )
}

function SkillDrawer({ skill, onClose }: { skill: Skill; onClose: () => void }) {
  const { data, isPending, error } = useSkillContent(skill.id)
  return (
    <Dialog title={skill.name} onClose={onClose} variant="drawer">
      <div className="drawer-meta">
        <span className={`status-dot${skill.enabled ? ' on' : ''}`} />
        {skill.enabled ? 'Enabled' : 'Disabled'}
        <span className="sep">·</span>
        ~{skill.tokens.alwaysOn} tokens always-on · ~{skill.tokens.onInvoke.toLocaleString()} when used
        <span className="sep">·</span>
        <code className="path">{data?.path ?? skill.path}</code>
      </div>
      {isPending && <div className="skeleton-block" />}
      {error && <p className="error-text">{error.message}</p>}
      {data && <pre className="skill-source">{data.content}</pre>}
    </Dialog>
  )
}

export function TrashIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6" />
    </svg>
  )
}
