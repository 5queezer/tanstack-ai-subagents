export type SubagentRunHistoryEntry = {
  runId?: string
  mode?: string
  timestamp?: number
  workers?: Array<{ status?: string; exitCode?: number }>
  results?: Array<{ status?: string; exitCode?: number }>
}

export function listSubagentRuns(entries: unknown[] = []): SubagentRunHistoryEntry[] {
  return entries
    .filter((entry: any) => entry?.type === 'custom' && entry.customType === 'subagent-run' && entry.data)
    .map((entry: any) => entry.data as SubagentRunHistoryEntry)
    .sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0))
}

export function formatSubagentRuns(runs: SubagentRunHistoryEntry[] = []) {
  if (runs.length === 0) return 'No subagent runs recorded.'
  return runs
    .map((run) => {
      const counts = statusCounts(run.workers ?? run.results ?? [])
      const statuses = Object.entries(counts).map(([status, count]) => `${status}: ${count}`).join(', ')
      return `${run.runId ?? '(no runId)'} ${run.mode ?? '(unknown mode)'} ${statuses || 'no results'}`
    })
    .join('\n')
}

function statusCounts(results: Array<{ status?: string; exitCode?: number }>) {
  const counts: Record<string, number> = {}
  for (const result of results) {
    const status = result.status ?? (result.exitCode === 0 ? 'completed' : 'failed')
    counts[status] = (counts[status] ?? 0) + 1
  }
  return counts
}
