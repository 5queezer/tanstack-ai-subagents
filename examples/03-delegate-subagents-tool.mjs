import { createDelegateSubagentsTool } from '../dist/index.js'

const delegateSubagents = createDelegateSubagentsTool({
  tools: { repo_read: { name: 'repo_read' } },
  runner: async (brief) => ({
    name: brief.name,
    status: 'completed',
    output: `${brief.name}: ${brief.objective} done`,
  }),
})

const result = await delegateSubagents.execute({
  originalPrompt: 'Find release risks before publishing',
  workers: [
    worker('tests', 'Check test coverage and failures'),
    worker('docs', 'Check README and examples'),
  ],
})

console.log(result.action)
console.log(result.workers.map((worker) => worker.output).join('\n'))

function worker(name, objective) {
  return {
    name,
    objective,
    scope: 'read-only project inspection',
    nonGoals: 'Do not mutate state',
    toolNames: ['repo_read'],
    expectedOutput: 'Brief findings with evidence',
  }
}
