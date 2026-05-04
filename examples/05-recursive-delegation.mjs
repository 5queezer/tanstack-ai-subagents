import { createRecursiveDelegateSubagentsTool, runSubagents } from '../dist/index.js'

const result = await runSubagents({
  originalPrompt: 'Review release and let the worker delegate one nested check',
  routingNote: {
    promptClass: 'review',
    complexity: 'high',
    domainBreadth: 'single-domain',
    subtaskIndependence: 'medium',
    verificationBurden: 'high',
    costLatencyPrivacyRisk: 'medium',
    chosenAction: 'spawn_one_specialist',
    rationale: 'A specialist can review release readiness and delegate a bounded nested check.',
    validationGate: 'Nested findings are attached to the parent run provenance.',
  },
  workers: [worker('release-reviewer', 'Review release readiness')],
}, {
  tools: { repo_read: { name: 'repo_read' } },
  policy: { maxRecursiveDepth: 1 },
  runner: async (brief, parentInput) => {
    const recursiveDelegate = createRecursiveDelegateSubagentsTool({
      tools: { repo_read: { name: 'repo_read' } },
      policy: { maxRecursiveDepth: 1 },
      recursiveContext: parentInput.recursiveContext,
      runner: async (nestedBrief) => ({
        name: nestedBrief.name,
        status: 'completed',
        output: `${nestedBrief.name}: nested check complete`,
      }),
    })

    await recursiveDelegate.execute({
      originalPrompt: 'Nested changelog check',
      workers: [worker('changelog-checker', 'Check changelog completeness')],
    })

    return { name: brief.name, status: 'completed', output: `${brief.name}: parent review complete` }
  },
})

console.log(`root depth: ${result.depth}`)
console.log(`child runs: ${result.childRuns.length}`)
console.log(`child depth: ${result.childRuns[0].depth}`)

function worker(name, objective) {
  return {
    name,
    objective,
    scope: 'read-only project inspection',
    nonGoals: 'Do not mutate state',
    toolNames: ['repo_read'],
    authority: 'read_only',
    risk: 'low',
    verificationCriteria: 'Findings cite concrete evidence',
    expectedOutput: 'Brief findings with evidence',
  }
}
