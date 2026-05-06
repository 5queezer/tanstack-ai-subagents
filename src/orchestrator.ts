import pLimit from 'p-limit'

import { validateWorkerOutput } from './output-validation.js'
import { enforceBudgetSnapshot, runWithRetry } from './retry-budget.js'
import { addTraceEvent, createTrace, summarizeTrace } from './trace.js'

import type {
  DelegationPolicy,
  RunSubagentsInput,
  RunSubagentsResult,
  SubagentProfile,
  SubagentRecursiveContext,
  SubagentRunHandle,
  SubagentToolDescriptor,
  SubagentToolRegistry,
  SubagentToolSelector,
  SubagentTopology,
  SubagentVerificationResult,
  SubagentWorkerBrief,
  SubagentWorkerResult,
  SubagentWorkerRunner,
  SubagentWorkerUpdate,
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
  toolSelector?: SubagentToolSelector<TToolName, TTool>
  maxWorkers?: number
  maxConcurrency?: number
  policy?: DelegationPolicy
  recursiveContext?: SubagentRecursiveContext
  verifier?: (result: RunSubagentsResult, input: RunSubagentsInput<TToolName>) => Promise<SubagentVerificationResult>
  systemPrompt?: string
  signal?: AbortSignal
  onWorkerStart?: (brief: SubagentWorkerBrief<TToolName>) => void | Promise<void>
  onWorkerUpdate?: (update: SubagentWorkerUpdate, brief: SubagentWorkerBrief<TToolName>) => void | Promise<void>
  onWorkerFinish?: (result: SubagentWorkerResult, brief: SubagentWorkerBrief<TToolName>) => void | Promise<void>
  onWorkerFail?: (brief: SubagentWorkerBrief<TToolName>, error: unknown) => void | Promise<void>
}

export async function runSubagents<TToolName extends string = string, TTool = unknown, TAdapter = unknown>(
  input: RunSubagentsInput<TToolName>,
  options: RunSubagentsOptions<TToolName, TTool, TAdapter> = {},
): Promise<RunSubagentsResult> {
  const selectedToolNames = await selectMissingWorkerTools(input, options)
  validateRunSubagentsInput(input, {
    toolNames: configuredToolNames(options),
    maxWorkers: options.maxWorkers,
    profiles: options.profiles,
    policy: options.policy,
    selectedToolNames,
  })
  validateToolImplementations(input, options, selectedToolNames)
  validateConcurrency(options.maxConcurrency)

  const recursiveContext = input.recursiveContext ?? options.recursiveContext ?? createRootRecursiveContext()
  const runInput = { ...input, recursiveContext, workers: applySelectedToolNames(input.workers, selectedToolNames) }
  const runner = options.runner ?? createModelWorkerRunner(options)
  const topology = selectTopology(runInput.workers)
  const trace = createTrace(recursiveContext.runId)
  const workers = await runWorkerStages(runInput, options, runner, trace)
  const result: RunSubagentsResult = {
    runId: recursiveContext.runId,
    rootRunId: recursiveContext.rootRunId,
    parentRunId: recursiveContext.parentRunId,
    depth: recursiveContext.depth,
    action: runInput.routingNote.chosenAction,
    topology,
    workers,
    childRuns: recursiveContext.childRuns,
    trace: summarizeTrace(trace),
    integrationHint: 'Integrate completed worker findings, call out failures or uncertainty, and validate against the routing note validation gate.',
  }

  if (options.verifier) {
    result.verification = await options.verifier(result, runInput)
  } else if (options.policy?.requireVerification) {
    result.verification = {
      status: 'needs_review',
      summary: 'Delegation policy requires verification, but no verifier was configured.',
      checkedWorkers: [],
    }
  }

  return result
}

export function createRootRecursiveContext(): SubagentRecursiveContext {
  const runId = createRunId()
  return { runId, rootRunId: runId, depth: 0, childRuns: [] }
}

export function createChildRecursiveContext(parent: SubagentRecursiveContext, policy: DelegationPolicy = {}): SubagentRecursiveContext {
  const depth = parent.depth + 1
  const maxRecursiveDepth = policy.maxRecursiveDepth ?? 1
  if (depth > maxRecursiveDepth) {
    throw new Error(`recursive delegation depth ${depth} exceeds maxRecursiveDepth ${maxRecursiveDepth}`)
  }
  return { runId: createRunId(), rootRunId: parent.rootRunId, parentRunId: parent.runId, depth, childRuns: [] }
}

export function startSubagents<TToolName extends string = string, TTool = unknown, TAdapter = unknown>(
  input: RunSubagentsInput<TToolName>,
  options: RunSubagentsOptions<TToolName, TTool, TAdapter> = {},
): SubagentRunHandle {
  const recursiveContext = input.recursiveContext ?? options.recursiveContext ?? createRootRecursiveContext()
  const handle: SubagentRunHandle = {
    runId: recursiveContext.runId,
    status: 'running',
    result: Promise.resolve(undefined as never),
  }

  handle.result = runSubagents({ ...input, recursiveContext }, { ...options, recursiveContext }).then(
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
  options: { toolNames?: readonly TToolName[]; maxWorkers?: number; profiles?: Record<string, SubagentProfile<TToolName>>; policy?: DelegationPolicy; selectedToolNames?: Map<string, TToolName[]> } = {},
) {
  const action = input.routingNote.chosenAction
  const maxWorkers = options.maxWorkers ?? 4
  const maxToolsPerWorker = options.policy?.maxToolsPerWorker ?? 5
  const configuredTools = options.toolNames
  const onWorkerFailure = options.policy?.onWorkerFailure

  if (onWorkerFailure !== undefined && !['skip_dependents', 'abort', 'continue'].includes(onWorkerFailure)) {
    throw new Error(`invalid onWorkerFailure: ${onWorkerFailure}`)
  }

  if (!Number.isInteger(maxWorkers) || maxWorkers < 2) {
    throw new Error('maxWorkers must be at least 2')
  }

  if (action !== 'spawn_one_specialist' && action !== 'spawn_multiple_specialists') {
    throw new Error(`Routing action ${action} does not allow subagent execution`)
  }

  if (action === 'spawn_one_specialist' && input.workers.length !== 1) {
    throw new Error('spawn_one_specialist requires exactly one worker')
  }

  if (action === 'spawn_multiple_specialists' && (input.workers.length < 2 || input.workers.length > maxWorkers)) {
    throw new Error(`spawn_multiple_specialists requires 2 to ${maxWorkers} workers`)
  }

  validateDelegationContracts(input.workers, options.policy)

  input.workers.forEach((worker, index) => {
    requireText(worker.name, `workers[${index}].name`)
    requireText(worker.objective, `workers[${index}].objective`)
    requireText(worker.scope, `workers[${index}].scope`)
    requireText(worker.nonGoals, `workers[${index}].nonGoals`)
    requireText(worker.expectedOutput, `workers[${index}].expectedOutput`)

    const toolNames = resolveWorkerToolNames(worker, options.profiles, options.selectedToolNames?.get(worker.name))
    if (toolNames.length > maxToolsPerWorker) {
      throw new Error(`workers[${index}] requested ${toolNames.length} tools; maxToolsPerWorker is ${maxToolsPerWorker}`)
    }
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
  return Object.keys(options.tools) as TToolName[]
}

function validateToolImplementations<TToolName extends string, TTool, TAdapter>(
  input: RunSubagentsInput<TToolName>,
  options: RunSubagentsOptions<TToolName, TTool, TAdapter>,
  selectedToolNames?: Map<string, TToolName[]>,
) {
  if (!options.tools) return

  for (const worker of input.workers) {
    for (const name of resolveWorkerToolNames(worker, options.profiles, selectedToolNames?.get(worker.name))) {
      if (options.tools[name] == null) throw new Error(`worker tool implementation is missing: ${name}`)
    }
  }
}

async function selectMissingWorkerTools<TToolName extends string, TTool, TAdapter>(
  input: RunSubagentsInput<TToolName>,
  options: RunSubagentsOptions<TToolName, TTool, TAdapter>,
) {
  if (!options.toolSelector) return undefined

  const selected = new Map<string, TToolName[]>()
  const availableTools = toolDescriptors(options.tools)
  const maxTools = options.policy?.maxToolsPerWorker ?? 5

  for (const worker of input.workers) {
    if (worker.toolNames || worker.profile) continue
    selected.set(worker.name, await options.toolSelector({
      worker,
      originalPrompt: input.originalPrompt,
      routingNote: input.routingNote,
      availableTools,
      maxTools,
    }))
  }

  return selected.size ? selected : undefined
}

function toolDescriptors<TToolName extends string, TTool>(tools: SubagentToolRegistry<TToolName, TTool> | undefined): Array<SubagentToolDescriptor<TToolName, TTool>> {
  if (!tools) return []
  return Object.entries(tools).map(([name, tool]) => ({ name: name as TToolName, tool: tool as TTool }))
}

function applySelectedToolNames<TToolName extends string>(
  workers: Array<SubagentWorkerBrief<TToolName>>,
  selectedToolNames: Map<string, TToolName[]> | undefined,
) {
  if (!selectedToolNames) return workers
  return workers.map((worker) => {
    const toolNames = selectedToolNames.get(worker.name)
    return toolNames ? { ...worker, toolNames } : worker
  })
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
        brief.verificationCriteria ? `Verification criteria: ${brief.verificationCriteria}` : '',
        brief.authority ? `Authority: ${brief.authority}` : '',
        brief.risk ? `Risk: ${brief.risk}` : '',
      ].filter(Boolean).join('\n'),
    }],
  })

  return {
    name: brief.name,
    status: 'completed',
    output,
  }
}

async function runWorkerStages<TToolName extends string, TTool, TAdapter>(
  input: RunSubagentsInput<TToolName>,
  options: RunSubagentsOptions<TToolName, TTool, TAdapter>,
  runner: SubagentWorkerRunner<TToolName>,
  trace: ReturnType<typeof createTrace>,
) {
  const pending = new Map(input.workers.map((worker) => [worker.name, worker]))
  const completed = new Set<string>()
  const failed = new Set<string>()
  const results: SubagentWorkerResult[] = []
  const onWorkerFailure = options.policy?.onWorkerFailure ?? 'skip_dependents'
  let aborted = false
  let stageIndex = 0

  while (pending.size > 0) {
    const ready = [...pending.values()].filter((worker) => (worker.dependsOn ?? []).every((name) => completed.has(name) || failed.has(name)))
    if (ready.length === 0) throw new Error('worker dependency cycle detected')
    addTraceEvent(trace, { type: 'stage_start', stage: stageIndex, taskCount: ready.length })

    if (aborted) {
      for (const brief of ready) {
        const result = { name: brief.name, status: 'skipped' as const, output: '', error: 'aborted: prior stage failed' }
        results.push(result)
        pending.delete(brief.name)
        failed.add(brief.name)
        addTraceEvent(trace, { type: 'task_skipped', name: brief.name })
      }
      stageIndex += 1
      continue
    }

    const limit = pLimit(options.maxConcurrency ?? options.maxWorkers ?? input.workers.length)
    const stageResults = await Promise.all(ready.map((brief) => limit(async () => {
      const failedDependency = (brief.dependsOn ?? []).find((name) => failed.has(name))
      if (failedDependency && onWorkerFailure === 'skip_dependents') {
        addTraceEvent(trace, { type: 'task_skipped', name: brief.name, dependency: failedDependency })
        return {
          name: brief.name,
          status: 'skipped' as const,
          output: '',
          error: `dependency failed: ${failedDependency}`,
        }
      }

      await callLifecycle(() => options.onWorkerStart?.(brief))
      try {
        const { value } = await runWithRetry(
          () => runner(brief, input, {
            signal: options.signal,
            onUpdate: (update) => callLifecycle(() => options.onWorkerUpdate?.(update, brief)),
          }),
          { maxRetries: options.policy?.maxRetries ?? 1 },
        )
        let result = validateWorkerResult(value, brief)
        await callLifecycle(() => options.onWorkerFinish?.(result, brief))
        addTraceEvent(trace, { type: result.status === 'completed' ? 'task_complete' : 'task_failed', name: brief.name })
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
        addTraceEvent(trace, { type: 'task_failed', name: brief.name, error: result.error })
        return result
      }
    })))

    let stageHadFailure = false
    const stageResultStart = results.length
    for (const result of stageResults) {
      results.push(result)
      pending.delete(result.name)
      if (result.status === 'completed') completed.add(result.name)
      else {
        failed.add(result.name)
        if (result.status === 'failed') stageHadFailure = true
      }
    }
    try {
      enforceBudgetSnapshot(budgetSnapshot(results), {
        maxCost: options.policy?.maxCost,
        maxTokens: options.policy?.maxTokens,
        maxTurns: options.policy?.maxTurns,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'budget exceeded'
      addTraceEvent(trace, { type: 'budget_exceeded', error: message })
      for (let i = results.length - 1; i >= stageResultStart; i--) {
        const result = results[i]
        if (result && result.status === 'completed') {
          results[i] = { name: result.name, status: 'failed', output: result.output, error: message, usage: result.usage }
          failed.add(result.name)
          completed.delete(result.name)
          break
        }
      }
      stageHadFailure = true
    }
    if (stageHadFailure && onWorkerFailure === 'abort') aborted = true
    addTraceEvent(trace, { type: 'stage_end', stage: stageIndex })
    stageIndex += 1
  }

  return results
}

function validateWorkerResult<TToolName extends string>(result: SubagentWorkerResult, brief: SubagentWorkerBrief<TToolName>): SubagentWorkerResult {
  if (result.status !== 'completed') return result
  if (!brief.expectedSections && !brief.jsonSchema) return result
  try {
    validateWorkerOutput(result.output, { expectedSections: brief.expectedSections, jsonSchema: brief.jsonSchema })
    return result
  } catch (error) {
    return {
      name: result.name,
      status: 'failed',
      output: result.output,
      error: error instanceof Error ? error.message : 'output validation failed',
      usage: result.usage,
    }
  }
}

function budgetSnapshot(results: SubagentWorkerResult[]) {
  return results.reduce(
    (acc, result) => {
      acc.cost += result.usage?.cost ?? 0
      acc.tokens += result.usage?.tokens ?? 0
      acc.turns += result.usage?.turns ?? 0
      return acc
    },
    { cost: 0, tokens: 0, turns: 0 },
  )
}

function selectTopology<TToolName extends string>(workers: Array<SubagentWorkerBrief<TToolName>>): SubagentTopology {
  if (workers.length === 1) return 'single'
  if (workers.some((worker) => (worker.dependsOn ?? []).length > 0)) return 'staged_dag'
  return 'parallel'
}

function validateConcurrency(maxConcurrency: number | undefined) {
  if (maxConcurrency === undefined) return
  if (!Number.isInteger(maxConcurrency) || maxConcurrency < 1) {
    throw new Error('maxConcurrency must be at least 1')
  }
}

function validateDelegationContracts<TToolName extends string>(workers: Array<SubagentWorkerBrief<TToolName>>, policy: DelegationPolicy = {}) {
  const names = new Set<string>()
  for (const worker of workers) {
    if (names.has(worker.name)) throw new Error(`duplicate worker name: ${worker.name}`)
    names.add(worker.name)
    if (worker.authority === 'external_side_effect' && policy.riskTolerance !== 'high') {
      throw new Error('external_side_effect authority requires high riskTolerance')
    }
  }

  for (const worker of workers) {
    for (const dependency of worker.dependsOn ?? []) {
      if (!names.has(dependency)) throw new Error(`unknown dependency: ${dependency}`)
    }
  }

  const maxDepth = policy.maxDepth ?? 4
  const visiting = new Set<string>()
  const depths = new Map<string, number>()
  const byName = new Map(workers.map((worker) => [worker.name, worker]))

  const depthOf = (name: string): number => {
    if (visiting.has(name)) throw new Error('worker dependency cycle detected')
    const memoized = depths.get(name)
    if (memoized) return memoized
    visiting.add(name)
    const worker = byName.get(name)
    const depth = 1 + Math.max(0, ...(worker?.dependsOn ?? []).map(depthOf))
    visiting.delete(name)
    depths.set(name, depth)
    if (depth > maxDepth) throw new Error(`worker dependency depth exceeds maxDepth ${maxDepth}`)
    return depth
  }

  for (const worker of workers) depthOf(worker.name)
}

function resolveWorkerToolNames<TToolName extends string>(
  brief: SubagentWorkerBrief<TToolName>,
  profiles?: Record<string, SubagentProfile<TToolName>>,
  selectedToolNames?: TToolName[],
): TToolName[] {
  if (brief.toolNames) return brief.toolNames
  if (brief.profile) {
    const profile = profiles?.[brief.profile]
    if (!profile) throw new Error(`unknown worker profile: ${brief.profile}`)
    return profile.toolNames
  }
  if (selectedToolNames) return selectedToolNames
  throw new Error(`workers.${brief.name}.toolNames, profile, or toolSelector result is required`)
}

function getAllowedWorkerTools<TToolName extends string, TTool>(names: TToolName[], registry: SubagentToolRegistry<TToolName, TTool>) {
  return names.map((name) => {
    const tool = registry[name]
    if (tool == null) throw new Error(`worker tool implementation is missing: ${name}`)
    return tool
  })
}

function createRunId() {
  return `subagent-run-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function requireText(value: string, field: string) {
  if (!value?.trim()) throw new Error(`${field} is required`)
}
