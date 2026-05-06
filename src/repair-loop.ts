import type { SubagentWorkerBrief, SubagentWorkerResult } from './types.js'

export type RepairTask<TToolName extends string = string> = SubagentWorkerBrief<TToolName> & {
  agent: string
  task: string
  repairRound: number
}

export function planVerifierRepairTasks<TToolName extends string = string>(
  tasks: Array<SubagentWorkerBrief<TToolName> & { role?: string; repairRound?: number }> = [],
  results: Array<SubagentWorkerResult & { summary?: string }> = [],
  options: { repairAgent?: string; maxVerificationRounds?: number } = {},
): Array<RepairTask<TToolName>> {
  if (!options.repairAgent) return []
  const byName = new Map(results.map((result) => [result.name, result]))
  const repairs: Array<RepairTask<TToolName>> = []
  for (const task of tasks) {
    if (task.role !== 'verifier') continue
    const result = byName.get(task.name)
    if (result?.status !== 'failed') continue
    if (options.maxVerificationRounds !== undefined && (task.repairRound ?? 0) >= options.maxVerificationRounds) continue
    const nextRound = nextRepairRound(tasks, task.name)
    const summaries = results
      .filter((workerResult) => workerResult.name !== task.name)
      .map((workerResult) => `- ${workerResult.name}: ${workerResult.output || workerResult.error || workerResult.summary || workerResult.status}`)
      .join('\n')
    repairs.push({
      name: `${task.name}-repair-${nextRound}`,
      objective: `Repair verifier failure for ${task.name}`,
      scope: 'Verifier error and prior worker outputs',
      nonGoals: 'Do not repeat work that already passed unless needed for the repair',
      expectedOutput: 'Repair summary with evidence and remaining risks',
      agent: options.repairAgent,
      task: [
        `Repair verifier failure for ${task.name}.`,
        `Verifier error: ${result.error || result.output || 'unknown failure'}`,
        'Prior worker outputs/summaries:',
        summaries || '(none)',
      ].join('\n'),
      dependsOn: [task.name],
      repairRound: nextRound,
    } as RepairTask<TToolName>)
  }
  return repairs
}

function nextRepairRound(tasks: Array<{ name: string }>, verifierName: string) {
  const prefix = `${verifierName}-repair-`
  let max = 0
  for (const task of tasks) {
    if (!task.name.startsWith(prefix)) continue
    const n = Number(task.name.slice(prefix.length))
    if (Number.isInteger(n) && n > max) max = n
  }
  return max + 1
}
