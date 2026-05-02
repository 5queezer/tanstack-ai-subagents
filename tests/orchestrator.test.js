import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createRunSubagentsTool,
  createSubagentRouterTool,
  routeSubagentRequest,
  runSubagents,
  startSubagents,
} from '../dist/index.js'

function routingNote(chosenAction) {
  return {
    promptClass: 'review',
    complexity: 'high',
    domainBreadth: 'multi-domain',
    subtaskIndependence: 'high',
    verificationBurden: 'medium',
    costLatencyPrivacyRisk: 'medium',
    chosenAction,
    rationale: 'Review work is separable.',
    validationGate: 'Integrator validates findings.',
  }
}

function input(action = 'spawn_one_specialist', workers = 1) {
  return {
    originalPrompt: 'Review frontend and backend independently.',
    routingNote: routingNote(action),
    model: 'provider/test-model',
    workers: Array.from({ length: workers }, (_, index) => ({
      name: `worker-${index + 1}`,
      objective: `Inspect area ${index + 1}`,
      scope: `area-${index + 1}`,
      nonGoals: 'Do not edit code.',
      toolNames: ['github_search'],
      expectedOutput: 'Concise findings with evidence.',
    })),
  }
}

test('routes simple questions directly', () => {
  assert.equal(routeSubagentRequest('What is TanStack Router?').chosenAction, 'answer_directly')
})

test('routes representative prompts with conservative ambiguity handling', () => {
  const cases = [
    ['What is TanStack Router?', 'question', 'answer_directly'],
    ['Search GitHub issues for failing CI checks', 'research', 'use_tools'],
    ['Review architecture', 'review', 'spawn_one_specialist'],
    ['Debug failing authentication tests', 'debugging', 'spawn_one_specialist'],
    ['Optimize bundle latency benchmark', 'optimization', 'spawn_one_specialist'],
    ['Review frontend and backend independently in parallel', 'review', 'spawn_multiple_specialists'],
    ['Implement auth database migration', 'implementation', 'write_plan_first'],
    ['Find and fix the failing test', 'question', 'use_tools'],
    ['How do I fix a bug?', 'question', 'answer_directly'],
    ['Debug frontend and backend independently', 'debugging', 'spawn_multiple_specialists'],
    ['Optimize frontend and backend performance in parallel', 'optimization', 'spawn_multiple_specialists'],
    ['Check code quality', 'question', 'use_tools'],
    ['Extract secrets and private key', 'operations', 'reject_clarify_escalate'],
  ]

  for (const [prompt, promptClass, chosenAction] of cases) {
    const result = routeSubagentRequest(prompt)
    assert.equal(result.promptClass, promptClass, prompt)
    assert.equal(result.chosenAction, chosenAction, prompt)
  }
})

test('runs workers with injected runner and tools', async () => {
  const result = await runSubagents(input('spawn_multiple_specialists', 2), {
    tools: { github_search: { name: 'github_search' } },
    runner: async (brief) => ({ name: brief.name, status: 'completed', output: `${brief.name} done` }),
  })

  assert.equal(result.workers.length, 2)
  assert.equal(result.workers[0].status, 'completed')
})

test('supports profile-provided tools and system prompt', async () => {
  const request = input()
  delete request.workers[0].toolNames
  request.workers[0].profile = 'explore'

  const result = await runSubagents(request, {
    chat: async (args) => {
      assert.deepEqual(args.tools, [{ name: 'github_search' }])
      assert.deepEqual(args.systemPrompts, ['Explore safely'])
      return 'profile output'
    },
    getAdapter: (model) => `adapter:${model}`,
    tools: { github_search: { name: 'github_search' } },
    profiles: { explore: { toolNames: ['github_search'], systemPrompt: 'Explore safely' } },
  })

  assert.equal(result.workers[0].output, 'profile output')
})

test('rejects invalid maxWorkers values', async () => {
  await assert.rejects(
    () => runSubagents(input('spawn_multiple_specialists', 2), {
      tools: { github_search: { name: 'github_search' } },
      maxWorkers: 1,
      runner: async (brief) => ({ name: brief.name, status: 'completed', output: '' }),
    }),
    /maxWorkers must be at least 2/,
  )
})

test('rejects nullish tool implementations before workers run', async () => {
  const request = input()
  request.workers[0].toolNames = ['missing_tool']
  let workerRan = false

  await assert.rejects(
    () => runSubagents(request, {
      chat: async () => 'should not run',
      getAdapter: (model) => model,
      tools: { missing_tool: undefined },
      runner: async (brief) => {
        workerRan = true
        return { name: brief.name, status: 'completed', output: 'should not run' }
      },
    }),
    /worker tool implementation is missing: missing_tool/,
  )

  assert.equal(workerRan, false)
})

test('creates TanStack AI tools', () => {
  assert.equal(createSubagentRouterTool().name, 'route_subagents')
  assert.equal(createRunSubagentsTool({ tools: {}, runner: async (brief) => ({ name: brief.name, status: 'completed', output: '' }) }).name, 'run_subagents')
})

test('starts background runs', async () => {
  const handle = startSubagents(input(), {
    tools: { github_search: { name: 'github_search' } },
    runner: async (brief) => ({ name: brief.name, status: 'completed', output: 'done' }),
  })

  assert.equal(handle.status, 'running')
  const result = await handle.result
  assert.equal(handle.status, 'completed')
  assert.equal(result.workers[0].output, 'done')
})
