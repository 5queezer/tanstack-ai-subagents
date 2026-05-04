import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  createDelegateSubagentsTool,
  createRecursiveDelegateSubagentsTool,
  createRunSubagentsTool,
  createSubagentRouterTool,
  createSubagentRouter,
  routeSubagentRequest,
  runSubagents,
  startSubagents,
  subagentRoutingNoteSchema,
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

test('creates configurable routers for app-specific intent policy', () => {
  const route = createSubagentRouter({
    intents: {
      incident: ['incident', 'outage', 'sev1'],
    },
    unsafeTerms: ['dump production data'],
    highRiskTerms: ['pci'],
    parallelTerms: ['squad-a', 'squad-b'],
    areaTerms: ['ios', 'android'],
  })

  const incident = route('Investigate incident across ios and android with squad-a squad-b')
  assert.equal(incident.promptClass, 'incident')
  assert.equal(incident.chosenAction, 'spawn_multiple_specialists')

  const riskyImplementation = route('Implement pci migration')
  assert.equal(riskyImplementation.promptClass, 'implementation')
  assert.equal(riskyImplementation.chosenAction, 'write_plan_first')

  const unsafe = route('dump production data')
  assert.equal(unsafe.chosenAction, 'reject_clarify_escalate')
})

test('configurable routers preserve default routing unless overridden', () => {
  const route = createSubagentRouter()
  assert.deepEqual(route('Review architecture'), routeSubagentRequest('Review architecture'))
})

test('routing note schema accepts app-specific prompt classes', () => {
  const route = createSubagentRouter({ intents: { incident: ['incident'] } })
  assert.equal(subagentRoutingNoteSchema.parse(route('incident outage')).promptClass, 'incident')
})

test('router tool accepts an app-specific router', async () => {
  const route = createSubagentRouter({ intents: { incident: ['incident'] } })
  const tool = createSubagentRouterTool({ router: route })
  const result = await tool.execute({ prompt: 'incident outage' })
  assert.equal(result.promptClass, 'incident')
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

test('runSubagents limits concurrent workers when maxConcurrency is configured', async () => {
  let active = 0
  let maxActive = 0

  const result = await runSubagents(input('spawn_multiple_specialists', 3), {
    maxWorkers: 3,
    maxConcurrency: 1,
    tools: { github_search: { name: 'github_search' } },
    runner: async (brief) => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 5))
      active -= 1
      return { name: brief.name, status: 'completed', output: `${brief.name} done` }
    },
  })

  assert.equal(result.workers.length, 3)
  assert.equal(maxActive, 1)
})

test('runSubagents rejects invalid maxConcurrency', async () => {
  await assert.rejects(
    () => runSubagents(input('spawn_multiple_specialists', 2), {
      maxConcurrency: 0,
      tools: { github_search: { name: 'github_search' } },
      runner: async (brief) => ({ name: brief.name, status: 'completed', output: 'ok' }),
    }),
    /maxConcurrency must be at least 1/,
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
  assert.equal(createRecursiveDelegateSubagentsTool({ tools: {}, runner: async (brief) => ({ name: brief.name, status: 'completed', output: '' }) }).name, 'recursive_delegate_subagents')
})

test('delegate_subagents lets the model call subagents without a deterministic routing note', async () => {
  const tool = createDelegateSubagentsTool({
    tools: { github_search: { name: 'github_search' } },
    runner: async (brief) => ({ name: brief.name, status: 'completed', output: `${brief.name} investigated ${brief.objective}` }),
  })

  const result = await tool.execute({
    originalPrompt: 'Check Sablier repositories and summarize 5queezer contributions.',
    workers: [{
      name: 'github-researcher',
      objective: 'Find relevant repositories and contribution evidence.',
      scope: 'Read-only GitHub data.',
      nonGoals: 'Do not mutate GitHub state.',
      toolNames: ['github_search'],
      expectedOutput: 'Repository and contribution findings with URLs.',
    }],
  })

  assert.equal(tool.name, 'delegate_subagents')
  assert.equal(result.action, 'spawn_one_specialist')
  assert.equal(result.workers[0].output, 'github-researcher investigated Find relevant repositories and contribution evidence.')
})

test('rejects invalid delegation contracts', async () => {
  const duplicateNames = input('spawn_multiple_specialists', 2)
  duplicateNames.workers[1].name = duplicateNames.workers[0].name

  await assert.rejects(
    () => runSubagents(duplicateNames, {
      tools: { github_search: { name: 'github_search' } },
      runner: async (brief) => ({ name: brief.name, status: 'completed', output: '' }),
    }),
    /duplicate worker name: worker-1/,
  )

  const unknownDependency = input('spawn_multiple_specialists', 2)
  unknownDependency.workers[1].dependsOn = ['missing']

  await assert.rejects(
    () => runSubagents(unknownDependency, {
      tools: { github_search: { name: 'github_search' } },
      runner: async (brief) => ({ name: brief.name, status: 'completed', output: '' }),
    }),
    /unknown dependency: missing/,
  )

  const cycle = input('spawn_multiple_specialists', 2)
  cycle.workers[0].dependsOn = ['worker-2']
  cycle.workers[1].dependsOn = ['worker-1']

  await assert.rejects(
    () => runSubagents(cycle, {
      tools: { github_search: { name: 'github_search' } },
      runner: async (brief) => ({ name: brief.name, status: 'completed', output: '' }),
    }),
    /worker dependency cycle detected/,
  )

  const externalSideEffect = input()
  externalSideEffect.workers[0].authority = 'external_side_effect'

  await assert.rejects(
    () => runSubagents(externalSideEffect, {
      tools: { github_search: { name: 'github_search' } },
      runner: async (brief) => ({ name: brief.name, status: 'completed', output: '' }),
    }),
    /external_side_effect authority requires high riskTolerance/,
  )

  const tooDeep = input('spawn_multiple_specialists', 3)
  tooDeep.workers[1].dependsOn = ['worker-1']
  tooDeep.workers[2].dependsOn = ['worker-2']

  await assert.rejects(
    () => runSubagents(tooDeep, {
      tools: { github_search: { name: 'github_search' } },
      policy: { maxDepth: 2 },
      runner: async (brief) => ({ name: brief.name, status: 'completed', output: '' }),
    }),
    /worker dependency depth exceeds maxDepth 2/,
  )
})

test('runs dependency DAGs in stages and reports topology', async () => {
  const request = input('spawn_multiple_specialists', 3)
  request.workers[2].dependsOn = ['worker-1', 'worker-2']

  const events = []
  const result = await runSubagents(request, {
    tools: { github_search: { name: 'github_search' } },
    runner: async (brief) => {
      events.push(`start:${brief.name}`)
      return { name: brief.name, status: 'completed', output: `${brief.name} done` }
    },
  })

  assert.deepEqual(events, ['start:worker-1', 'start:worker-2', 'start:worker-3'])
  assert.equal(result.topology, 'staged_dag')
})

test('runs verifier after workers complete', async () => {
  const result = await runSubagents(input(), {
    tools: { github_search: { name: 'github_search' } },
    runner: async (brief) => ({ name: brief.name, status: 'completed', output: 'done' }),
    verifier: async (runResult) => ({
      status: 'verified',
      summary: `checked ${runResult.workers.length} worker`,
      checkedWorkers: runResult.workers.map((worker) => worker.name),
    }),
  })

  assert.equal(result.verification.status, 'verified')
  assert.deepEqual(result.verification.checkedWorkers, ['worker-1'])
})

test('recursive delegate tool enforces depth and records child runs', async () => {
  const root = await runSubagents(input(), {
    tools: { github_search: { name: 'github_search' } },
    policy: { maxRecursiveDepth: 2 },
    runner: async (brief, parentInput) => {
      const recursiveDelegate = createRecursiveDelegateSubagentsTool({
        tools: { github_search: { name: 'github_search' } },
        policy: { maxRecursiveDepth: 2 },
        recursiveContext: parentInput.recursiveContext,
        runner: async (childBrief) => ({ name: childBrief.name, status: 'completed', output: 'nested done' }),
      })

      await recursiveDelegate.execute({
        originalPrompt: 'Nested review',
        workers: [{
          name: 'nested-worker',
          objective: 'Review nested scope',
          scope: 'nested files',
          nonGoals: 'Do not edit',
          toolNames: ['github_search'],
          expectedOutput: 'Nested findings',
        }],
      })

      return { name: brief.name, status: 'completed', output: 'parent done' }
    },
  })

  assert.equal(root.depth, 0)
  assert.equal(root.childRuns.length, 1)
  assert.equal(root.childRuns[0].depth, 1)
  assert.equal(root.childRuns[0].parentRunId, root.runId)
  assert.equal(root.childRuns[0].workers[0].output, 'nested done')

  const blocked = createRecursiveDelegateSubagentsTool({
    tools: { github_search: { name: 'github_search' } },
    policy: { maxRecursiveDepth: 0 },
    runner: async (brief) => ({ name: brief.name, status: 'completed', output: '' }),
  })

  await assert.rejects(
    () => blocked.execute({
      originalPrompt: 'Too deep',
      workers: [{
        name: 'nested-worker',
        objective: 'Review nested scope',
        scope: 'nested files',
        nonGoals: 'Do not edit',
        toolNames: ['github_search'],
        expectedOutput: 'Nested findings',
      }],
    }),
    /recursive delegation depth 1 exceeds maxRecursiveDepth 0/,
  )
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
