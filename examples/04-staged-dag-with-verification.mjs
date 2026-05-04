import { runSubagents } from '../dist/index.js'

const result = await runSubagents({
  originalPrompt: 'Review implementation, then verify release readiness',
  routingNote: {
    promptClass: 'review',
    complexity: 'high',
    domainBreadth: 'multi-domain',
    subtaskIndependence: 'medium',
    verificationBurden: 'high',
    costLatencyPrivacyRisk: 'medium',
    chosenAction: 'spawn_multiple_specialists',
    rationale: 'Implementation review and release verification can run as staged delegation.',
    validationGate: 'Verifier checks worker findings before release.',
  },
  workers: [
    worker('implementation', 'Review source changes'),
    worker('tests', 'Review test coverage'),
    worker('release-verifier', 'Check whether findings support release', ['implementation', 'tests']),
  ],
}, {
  tools: { repo_read: { name: 'repo_read' } },
  policy: { requireVerification: true, maxDepth: 3 },
  runner: async (brief) => ({ name: brief.name, status: 'completed', output: `${brief.name}: ok` }),
  verifier: async (runResult) => ({
    status: 'verified',
    summary: `${runResult.topology} completed with ${runResult.workers.length} workers`,
    checkedWorkers: runResult.workers.map((worker) => worker.name),
  }),
})

console.log(result.topology)
console.log(result.verification.summary)

function worker(name, objective, dependsOn = []) {
  return {
    name,
    objective,
    dependsOn,
    scope: 'read-only project inspection',
    nonGoals: 'Do not mutate state',
    toolNames: ['repo_read'],
    authority: 'read_only',
    risk: 'low',
    verificationCriteria: 'Findings cite concrete evidence',
    expectedOutput: 'Brief findings with evidence',
  }
}
