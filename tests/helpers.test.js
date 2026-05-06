import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  validateWorkerOutput,
  OutputValidationError,
  planVerifierRepairTasks,
  listSubagentRuns,
  formatSubagentRuns,
} from '../dist/index.js'

test('validateWorkerOutput requires expected markdown sections', () => {
  assert.deepEqual(validateWorkerOutput('## Summary\nok\n\n## Evidence\nfile.ts', { expectedSections: ['Summary', 'Evidence'] }), { ok: true })
  assert.throws(
    () => validateWorkerOutput('## Summary\nok', { expectedSections: ['Summary', 'Evidence'] }),
    (err) => err instanceof OutputValidationError && /Evidence/.test(err.message),
  )
})

test('validateWorkerOutput validates required JSON fields', () => {
  assert.deepEqual(
    validateWorkerOutput('{"name":"a","status":"completed"}', { jsonSchema: { required: ['name', 'status'] } }).parsed,
    { name: 'a', status: 'completed' },
  )
  assert.throws(
    () => validateWorkerOutput('{"name":"a"}', { jsonSchema: { required: ['name', 'status'] } }),
    (err) => err instanceof OutputValidationError && /status/.test(err.message),
  )
})

test('planVerifierRepairTasks creates repair task for failed verifier', () => {
  const repairs = planVerifierRepairTasks(
    [
      { name: 'worker', agent: 'worker', objective: 'work', scope: 'x', nonGoals: 'none', expectedOutput: 'out' },
      { name: 'verify', agent: 'reviewer', role: 'verifier', objective: 'verify', scope: 'outputs', nonGoals: 'none', expectedOutput: 'verdict' },
    ],
    [
      { name: 'worker', status: 'completed', output: 'finding' },
      { name: 'verify', status: 'failed', output: '', error: 'missing evidence' },
    ],
    { repairAgent: 'worker' },
  )
  assert.equal(repairs[0].name, 'verify-repair-1')
  assert.equal(repairs[0].agent, 'worker')
  assert.match(repairs[0].task, /missing evidence/)
  assert.match(repairs[0].task, /finding/)
})

test('run history helpers list and format runs', () => {
  const runs = listSubagentRuns([
    { type: 'custom', customType: 'subagent-run', data: { runId: 'old', mode: 'single', timestamp: 1, workers: [] } },
    { type: 'custom', customType: 'other', data: {} },
    { type: 'custom', customType: 'subagent-run', data: { runId: 'new', mode: 'staged_dag', timestamp: 2, workers: [{ status: 'completed' }] } },
  ])
  assert.deepEqual(runs.map((run) => run.runId), ['new', 'old'])
  const text = formatSubagentRuns(runs)
  assert.match(text, /new/)
  assert.match(text, /staged_dag/)
  assert.match(text, /completed.*1|1.*completed/i)
})
