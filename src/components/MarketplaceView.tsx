import { useState } from 'react'
import type { AvailablePlugin } from '../../shared/types.ts'
import { useAction, useAvailablePlugins } from '../api.ts'
import { CATEGORIES, type Category } from '../../shared/categories.ts'

type Sort = 'featured' | 'installs' | 'name'

const compact = new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 })

/** Most installed first; plugins whose marketplace publishes no count go last, by name. */
function byInstalls(a: AvailablePlugin, b: AvailablePlugin) {
  if (a.installCount === undefined || b.installCount === undefined) {
    if (a.installCount !== b.installCount) return a.installCount === undefined ? 1 : -1
    return a.name.localeCompare(b.name)
  }
  return b.installCount - a.installCount
}

function matchesQuery(p: AvailablePlugin, q: string) {
  return (
    !q ||
    p.name.toLowerCase().includes(q) ||
    p.description.toLowerCase().includes(q) ||
    p.category.toLowerCase().includes(q) ||
    (p.declaredCategory?.toLowerCase().includes(q) ?? false)
  )
}

export function MarketplaceView({ installedIds }: { installedIds: Set<string> }) {
  const { data, isPending, error } = useAvailablePlugins(true)
  const [query, setQuery] = useState('')
  const [market, setMarket] = useState('all')
  const [category, setCategory] = useState<Category | 'all'>('all')
  const [sort, setSort] = useState<Sort>('featured')

  if (isPending) return <div className="skeleton-list" aria-busy="true" />
  if (error) return <div className="empty error-text">{error.message}</div>

  const markets = [...new Set(data.map((p) => p.marketplaceName))].sort()
  const q = query.trim().toLowerCase()
  // Chip counts reflect the search and marketplace filters, but not the category itself
  const matching = data.filter((p) => (market === 'all' || p.marketplaceName === market) && matchesQuery(p, q))
  const counts = new Map<Category, number>()
  for (const p of matching) counts.set(p.category, (counts.get(p.category) ?? 0) + 1)
  const visible = category === 'all' ? matching : matching.filter((p) => p.category === category)
  if (sort === 'installs') visible.sort(byInstalls)
  else if (sort === 'name') visible.sort((a, b) => a.name.localeCompare(b.name))
  const uncounted = sort === 'installs' ? visible.filter((p) => p.installCount === undefined).length : 0

  return (
    <section>
      <div className="toolbar">
        <input
          className="search"
          type="search"
          placeholder="Search plugins by name, description or category…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search marketplace"
        />
        <select className="select" value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Marketplace">
          <option value="all">All marketplaces ({markets.length})</option>
          {markets.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <select className="select select-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Sort">
          <option value="featured">Sort: Marketplace order</option>
          <option value="installs">Sort: Most installed</option>
          <option value="name">Sort: Name A–Z</option>
        </select>
      </div>
      <div className="category-chips" role="group" aria-label="Filter by category">
        <button type="button" className="cat-chip" aria-pressed={category === 'all'} onClick={() => setCategory('all')}>
          All <span className="cat-count">{matching.length}</span>
        </button>
        {CATEGORIES.filter((c) => counts.has(c) || c === category).map((c) => (
          <button
            key={c}
            type="button"
            className="cat-chip"
            aria-pressed={category === c}
            onClick={() => setCategory(category === c ? 'all' : c)}
          >
            {c} <span className="cat-count">{counts.get(c) ?? 0}</span>
          </button>
        ))}
      </div>

      <p className="result-count">
        {visible.length} of {data.length} available
        {category !== 'all' && (
          <>
            {' '}
            in <strong>{category}</strong>{' '}
            <button type="button" className="link-btn" onClick={() => setCategory('all')}>
              Clear
            </button>
          </>
        )}
        {uncounted > 0 && <span className="muted"> · {uncounted} without install data listed last</span>}
      </p>
      {visible.length === 0 ? (
        <div className="empty">No plugins match. Try another category or search term.</div>
      ) : (
        <ul className="market-list">
          {visible.map((p) => (
            <MarketRow key={p.pluginId} plugin={p} installed={installedIds.has(p.pluginId)} />
          ))}
        </ul>
      )}
    </section>
  )
}

function MarketRow({ plugin, installed }: { plugin: AvailablePlugin; installed: boolean }) {
  const action = useAction()
  return (
    <li className="market-row">
      <div className="market-main">
        <span className="skill-title">
          <span className="skill-name">{plugin.name}</span>
          <span className="badge">{plugin.marketplaceName}</span>
          <span className="category-tag" title={plugin.declaredCategory ? `Marketplace category: ${plugin.declaredCategory}` : 'Inferred from description'}>
            {plugin.category}
          </span>
          {plugin.version && <span className="muted small">v{plugin.version}</span>}
          {plugin.installCount !== undefined && (
            <span className="install-count" title={`${plugin.installCount.toLocaleString()} installs`}>
              <DownloadIcon /> {compact.format(plugin.installCount)}
            </span>
          )}
        </span>
        <span className="skill-desc">{plugin.description || <em>No description</em>}</span>
      </div>
      {installed ? (
        <span className="badge badge-ok">Installed</span>
      ) : (
        <button
          className="btn btn-primary btn-sm"
          disabled={action.isPending}
          onClick={() => action.mutate({ path: '/plugins/install', body: { id: plugin.pluginId } })}
        >
          {action.isPending ? 'Installing…' : 'Install'}
        </button>
      )}
    </li>
  )
}

function DownloadIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 3v12M7 10l5 5 5-5M5 21h14" />
    </svg>
  )
}
