import { toolDefinition } from '@tanstack/ai'

import { runSubagents, type RunSubagentsOptions } from './orchestrator.js'
import { routeSubagentRequest, type SubagentRouter } from './router.js'
import { delegateSubagentsInputSchema, runSubagentsInputSchema, subagentRouteInputSchema } from './schemas.js'
import type { DelegateSubagentsToolInput, RunSubagentsToolInput, SubagentRouteInput } from './schemas.js'
import type { RunSubagentsInput, TraceFunction } from './types.js'

export type CreateSubagentRouterToolOptions = {
  router?: SubagentRouter
  trace?: TraceFunction
}

export type CreateRunSubagentsToolOptions<TToolName extends string = string, TTool = unknown, TAdapter = unknown> = RunSubagentsOptions<TToolName, TTool, TAdapter> & {
  trace?: TraceFunction
}

export function createSubagentRouterTool(options: CreateSubagentRouterToolOptions = {}) {
  const definition = toolDefinition({
    name: 'route_subagents',
    description: 'Decide if a prompt needs tools, planning, or subagents.',
    inputSchema: subagentRouteInputSchema,
  })

  const tool = definition.server(async (args) => {
    const input = args as SubagentRouteInput
    const run = async () => (options.router ?? routeSubagentRequest)(input.prompt)
    return options.trace ? options.trace('route_subagents', input, run) : run()
  })

  return Object.assign(tool, { definition })
}

export function createRunSubagentsTool<TToolName extends string = string, TTool = unknown, TAdapter = unknown>(
  options: CreateRunSubagentsToolOptions<TToolName, TTool, TAdapter>,
) {
  const definition = toolDefinition({
    name: 'run_subagents',
    description: 'Run bounded specialist subagents after route_subagents chooses a spawn action.',
    inputSchema: runSubagentsInputSchema,
  })

  const tool = definition.server(async (args) => {
    const input = args as RunSubagentsToolInput
    const run = async () => runSubagents(input as RunSubagentsInput<TToolName>, options)
    return options.trace ? options.trace('run_subagents', input, run) : run()
  })

  return Object.assign(tool, { definition })
}

export function createDelegateSubagentsTool<TToolName extends string = string, TTool = unknown, TAdapter = unknown>(
  options: CreateRunSubagentsToolOptions<TToolName, TTool, TAdapter>,
) {
  const definition = toolDefinition({
    name: 'delegate_subagents',
    description: 'Let the model directly delegate to bounded specialist subagents. Use when independent read-only workers can improve the answer.',
    inputSchema: delegateSubagentsInputSchema,
  })

  const tool = definition.server(async (args) => {
    const input = args as DelegateSubagentsToolInput
    const runInput = {
      ...input,
      routingNote: modelChosenRoutingNote(input.workers.length),
    } as RunSubagentsInput<TToolName>
    const run = async () => runSubagents(runInput, options)
    return options.trace ? options.trace('delegate_subagents', input, run) : run()
  })

  return Object.assign(tool, { definition })
}

function modelChosenRoutingNote(workerCount: number): RunSubagentsInput['routingNote'] {
  return {
    promptClass: 'model-delegated',
    complexity: workerCount > 1 ? 'high' : 'medium',
    domainBreadth: workerCount > 1 ? 'multi-domain' : 'single-domain',
    subtaskIndependence: workerCount > 1 ? 'high' : 'medium',
    verificationBurden: 'medium',
    costLatencyPrivacyRisk: 'medium',
    chosenAction: workerCount > 1 ? 'spawn_multiple_specialists' : 'spawn_one_specialist',
    rationale: 'The model selected bounded subagent delegation through a validated tool call.',
    validationGate: 'The calling application validates worker findings before presenting the final answer.',
  }
}
