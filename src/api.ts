import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ActionResult, AvailablePlugin, GitScanResult, Overview, UsageReport } from '../shared/types.ts'
import { useToast } from './components/Toast.tsx'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', 'X-Skills-Dashboard': '1', ...init?.headers },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error ?? `Request failed (${res.status})`)
  return data as T
}

export function useOverview() {
  return useQuery({ queryKey: ['overview'], queryFn: () => request<Overview>('/overview') })
}

export function useSkillContent(id: string | null) {
  return useQuery({
    queryKey: ['content', id],
    queryFn: () => request<{ path: string; content: string }>(`/skill-content?id=${encodeURIComponent(id!)}`),
    enabled: id !== null,
  })
}

export function useUsage() {
  return useQuery({ queryKey: ['usage'], queryFn: () => request<UsageReport>('/usage'), staleTime: 60_000 })
}

/** Clone a repo and list the skills in it (nothing is installed yet). */
export function useGitScan() {
  return useMutation({
    mutationFn: (body: { source: string; subdir: string }) =>
      request<GitScanResult>('/personal/scan-git', { method: 'POST', body: JSON.stringify(body) }),
  })
}

export function useAvailablePlugins(enabled: boolean) {
  return useQuery({
    queryKey: ['available'],
    queryFn: () => request<AvailablePlugin[]>('/plugins/available'),
    enabled,
    staleTime: 5 * 60_000,
  })
}

export interface ActionInput {
  path: string
  body: Record<string, unknown>
}

/** Apply a toggle to cached data so switches and token totals react before the server confirms. */
function applyToggle(overview: Overview, { path, body }: ActionInput): Overview | null {
  const enabled = body.enabled === true
  if (path === '/personal/toggle') {
    const id = `personal:${body.name}`
    return { ...overview, skills: overview.skills.map((s) => (s.id === id ? { ...s, enabled } : s)) }
  }
  if (path === '/plugins/toggle' || path === '/bulk-toggle') {
    const plugins = new Set(path === '/plugins/toggle' ? [body.id as string] : ((body.plugins as string[]) ?? []))
    const personal = new Set(((path === '/bulk-toggle' && (body.personal as string[])) || []).map((n) => `personal:${n}`))
    return {
      ...overview,
      skills: overview.skills.map((s) =>
        personal.has(s.id) || (s.pluginId && plugins.has(s.pluginId)) ? { ...s, enabled } : s,
      ),
      plugins: overview.plugins.map((p) => (plugins.has(p.id) ? { ...p, enabled } : p)),
    }
  }
  return null
}

/** POST a mutation, toast the result, and refresh the overview. */
export function useAction(onDone?: (r: ActionResult) => void) {
  const qc = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: ({ path, body }: ActionInput) =>
      request<ActionResult>(path, { method: 'POST', body: JSON.stringify(body) }),
    onMutate: async (input) => {
      const previous = qc.getQueryData<Overview>(['overview'])
      const next = previous && applyToggle(previous, input)
      if (!next) return { previous: undefined }
      await qc.cancelQueries({ queryKey: ['overview'] })
      qc.setQueryData(['overview'], next)
      return { previous }
    },
    onSuccess: (result) => {
      toast(result.message, 'success')
      onDone?.(result)
    },
    onError: (err, _input, context) => {
      if (context?.previous) qc.setQueryData(['overview'], context.previous)
      toast(err.message, 'error')
    },
    onSettled: () => qc.invalidateQueries({ queryKey: ['overview'] }),
  })
}
