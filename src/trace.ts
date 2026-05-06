export type TraceEvent = { type: string; timestamp?: number; [key: string]: unknown }
export type SubagentTrace = { runId: string; startedAt: number; events: TraceEvent[] }

export function createTrace(runId: string): SubagentTrace {
  return { runId, startedAt: Date.now(), events: [] }
}

export function addTraceEvent(trace: SubagentTrace, event: TraceEvent) {
  const stamped = { ...event, timestamp: Date.now() }
  trace.events.push(stamped)
  return stamped
}

export function summarizeTrace(trace: SubagentTrace) {
  const counts: Record<string, number> = {}
  for (const event of trace.events) counts[event.type] = (counts[event.type] ?? 0) + 1
  const lastTimestamp = trace.events.length ? trace.events[trace.events.length - 1]?.timestamp : trace.startedAt
  return {
    runId: trace.runId,
    counts,
    durationMs: Math.max(0, (lastTimestamp ?? Date.now()) - trace.startedAt),
  }
}
