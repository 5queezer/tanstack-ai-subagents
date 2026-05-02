import type {
  RunSubagentsInput,
  RunSubagentsResult,
  SubagentProfile,
  SubagentRunHandle,
  SubagentToolRegistry,
  SubagentWorkerBrief,
  SubagentWorkerResult,
  SubagentWorkerRunner,
} from './types.js'

export type RunSubagentsOptions<TToolName extends string = string, TTool = unknown, TAdapter = unknown> = {
  runner?: SubagentWorkerRunner<TToolName>
  chat?: (args: {
    adapter: TAdapter
    stream: false
    tools: TTool[]
    systemPrompts: string[]
    messages: Array<{ role: 'user'; content: string }>
  }) => Promise<string>
  getAdapter?: (model: string) => TAdapter
  tools?: SubagentToolRegistry<TToolName, TTool>
  profiles?: Record<string, SubagentProfile<TToolName>>
  maxWorkers?: number
  systemPrompt?: string
  onWorkerStart?: (brief: SubagentWorkerBrief<TToolName>) => void | Promise<void>
  onWorkerFinish?: (result: SubagentWorkerResult, brief: SubagentWorkerBrief<TToolName>) => void | Promise<void>
  onWorkerFail?: (brief: SubagentWorkerBrief<TToolName>, error: unknown) => void | Promise<void>
}

export async function runSubagents<TToolName extends string = string, TTool = unknown, TAdapter = unknown>(
  input: RunSubagentsInput<TToolName>,
  options: RunSubagentsOptions<TToolName, TTool, TAdapter> = {},
): Promise<RunSubagentsResult> {
  validateRunSubagentsInput(input, {
    toolNames: configuredToolNames(options),
    maxWorkers: options.maxWorkers,
    profiles: options.profiles,
  })

  const runner = options.runner ?? createModelWorkerRunner(options)
  const workers = await Promise.all(input.workers.map(async (brief) => {
    await callLifecycle(() => options.onWorkerStart?.(brief))
    try {
      const result = await runner(brief, input)
      await callLifecycle(() => options.onWorkerFinish?.(result, brief))
      return result
    } catch (error) {
      await callLifecycle(() => options.onWorkerFail?.(brief, error))
      const result = {
        name: brief.name,
        status: 'failed' as const,
        output: '',
        error: error instanceof Error ? error.message : 'Unknown worker error',
      }
      await callLifecycle(() => options.onWorkerFinish?.(result, brief))
      return result
    }
  }))

  return {
    action: input.routingNote.chosenAction,
    workers,
    integrationHint: 'Integrate completed worker findings, call out failures or uncertainty, and validate against the routing note validation gate.',
  }
}

export function startSubagents<TToolName extends string = string, TTool = unknown, TAdapter = unknown>(
  input: RunSubagentsInput<TToolName>,
  options: RunSubagentsOptions<TToolName, TTool, TAdapter> = {},
): SubagentRunHandle {
  const handle: SubagentRunHandle = {
    runId: `subagent-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'running',
    result: Promise.resolve(undefined as never),
  }

  handle.result = runSubagents(input, options).then(
    (result) => {
      handle.status = 'completed'
      return result
    },
    (error) => {
      handle.status = 'failed'
      throw error
    },
  )

  return handle
}

export function validateRunSubagentsInput<TToolName extends string = string>(
  input: RunSubagentsInput<TToolName>,
  options: { toolNames?: readonly TToolName[]; maxWorkers?: number; profiles?: Record<string, SubagentProfile<TToolName>> } = {},
) {
  const action = input.routingNote.chosenAction
  const maxWorkers = options.maxWorkers ?? 4
  const configuredTools = options.toolNames

  if (action !== 'spawn_one_specialist' && action !== 'spawn_multiple_specialists') {
    throw new Error(`Routing action ${action} does not allow subagent execution`)
  }

  if (action === 'spawn_one_specialist' && input.workers.length !== 1) {
    throw new Error('spawn_one_specialist requires exactly one worker')
  }

  if (action === 'spawn_multiple_specialists' && (input.workers.length < 2 || input.workers.length > maxWorkers)) {
    throw new Error(`spawn_multiple_specialists requires 2 to ${maxWorkers} workers`)
  }

  input.workers.forEach((worker, index) => {
    requireText(worker.name, `workers[${index}].name`)
    requireText(worker.objective, `workers[${index}].objective`)
    requireText(worker.scope, `workers[${index}].scope`)
    requireText(worker.nonGoals, `workers[${index}].nonGoals`)
    requireText(worker.expectedOutput, `workers[${index}].expectedOutput`)

    const toolNames = resolveWorkerToolNames(worker, options.profiles)
    if (!configuredTools) {
      throw new Error('run_subagents requires tools to validate worker tool access')
    }

    for (const tool of toolNames) {
      if (!(configuredTools as readonly string[]).includes(tool)) {
        throw new Error(`workers[${index}] requested disallowed tool: ${tool}`)
      }
    }
  })
}

function configuredToolNames<TToolName extends string, TTool, TAdapter>(options: RunSubagentsOptions<TToolName, TTool, TAdapter>) {
  if (!options.tools) return undefined

  return Object.entries(options.tools)
    .filter(([, tool]) => tool != null)
    .map(([name]) => name as TToolName)
}

async function callLifecycle(callback: () => void | Promise<void>) {
  try {
    await callback()
  } catch {
    // Lifecycle callbacks are observability hooks; they must not change worker outcomes.
  }
}

function createModelWorkerRunner<TToolName extends string, TTool, TAdapter>(
  options: RunSubagentsOptions<TToolName, TTool, TAdapter>,
): SubagentWorkerRunner<TToolName> {
  return async (brief, input) => runModelWorker(brief, input, options)
}

async function runModelWorker<TToolName extends string, TTool, TAdapter>(
  brief: SubagentWorkerBrief<TToolName>,
  input: RunSubagentsInput<TToolName>,
  options: RunSubagentsOptions<TToolName, TTool, TAdapter>,
): Promise<SubagentWorkerResult> {
  if (!input.model) throw new Error('run_subagents requires a model for worker execution')
  if (!options.chat) throw new Error('run_subagents requires chat or runner option')
  if (!options.getAdapter) throw new Error('run_subagents requires getAdapter or runner option')
  if (!options.tools) throw new Error('run_subagents requires tools or runner option')

  const profile = brief.profile ? options.profiles?.[brief.profile] : undefined
  const output = await options.chat({
    adapter: options.getAdapter(profile?.model ?? input.model),
    stream: false,
    tools: getAllowedWorkerTools(resolveWorkerToolNames(brief, options.profiles), options.tools),
    systemPrompts: [profile?.systemPrompt ?? options.systemPrompt ?? 'You are a bounded specialist subagent. Complete only the assigned brief. Use only allowed tools. Do not implement code or mutate state. Return concise findings with evidence and uncertainty.'],
    messages: [{
      role: 'user',
      content: [
        `Original prompt: ${input.originalPrompt}`,
        `Routing rationale: ${input.routingNote.rationale}`,
        `Validation gate: ${input.routingNote.validationGate}`,
        `Worker name: ${brief.name}`,
        `Objective: ${brief.objective}`,
        `Scope: ${brief.scope}`,
        `Non-goals: ${brief.nonGoals}`,
        `Expected output: ${brief.expectedOutput}`,
      ].join('\n'),
    }],
  })

  return {
    name: brief.name,
    status: 'completed',
    output,
  }
}

function resolveWorkerToolNames<TToolName extends string>(
  brief: SubagentWorkerBrief<TToolName>,
  profiles?: Record<string, SubagentProfile<TToolName>>,
): TToolName[] {
  if (brief.toolNames) return brief.toolNames
  if (brief.profile) {
    const profile = profiles?.[brief.profile]
    if (!profile) throw new Error(`unknown worker profile: ${brief.profile}`)
    return profile.toolNames
  }
  throw new Error(`workers.${brief.name}.toolNames or profile is required`)
}

function getAllowedWorkerTools<TToolName extends string, TTool>(names: TToolName[], registry: SubagentToolRegistry<TToolName, TTool>) {
  return names.map((name) => {
    const tool = registry[name]
    if (tool == null) throw new Error(`worker tool implementation is missing: ${name}`)
    return tool
  })
}

function requireText(value: string, field: string) {
  if (!value?.trim()) throw new Error(`${field} is required`)
}
