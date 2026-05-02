import { toolDefinition } from '@tanstack/ai'

import { runSubagents, type RunSubagentsOptions } from './orchestrator.js'
import { routeSubagentRequest, type SubagentRouter } from './router.js'
import { runSubagentsInputSchema, subagentRouteInputSchema } from './schemas.js'
import type { RunSubagentsToolInput, SubagentRouteInput } from './schemas.js'
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
