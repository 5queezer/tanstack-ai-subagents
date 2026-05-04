import { routeSubagentRequest, runSubagents } from '../dist/index.js'

const routingNote = routeSubagentRequest('Review frontend and backend independently')

const result = await runSubagents({
  originalPrompt: 'Review frontend and backend independently',
  routingNote,
  workers: [
    worker('frontend', 'Review frontend code'),
    worker('backend', 'Review backend code'),
  ],
}, {
  tools: { repo_read: { name: 'repo_read' } },
  runner: async (brief) => ({
    name: brief.name,
    status: 'completed',
    output: `${brief.name}: no issues found`,
  }),
})

console.log(result.action)
console.log(result.workers.map((worker) => worker.output).join('\n'))

function worker(name, objective) {
  return {
    name,
    objective,
    scope: 'read-only repository inspection',
    nonGoals: 'Do not edit files',
    toolNames: ['repo_read'],
    expectedOutput: 'Concise findings with evidence',
  }
}
