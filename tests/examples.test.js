import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { test } from 'node:test'

const execFileAsync = promisify(execFile)

const expectedExamples = [
  '01-deterministic-routing.mjs',
  '02-route-then-run.mjs',
  '03-delegate-subagents-tool.mjs',
  '04-staged-dag-with-verification.mjs',
  '05-recursive-delegation.mjs',
]

test('examples run successfully', async () => {
  const examplesDir = new URL('../examples/', import.meta.url)
  const files = (await readdir(examplesDir))
    .filter((file) => file.endsWith('.mjs'))
    .sort()

  assert.deepEqual(files, expectedExamples)

  for (const file of files) {
    const { stdout } = await execFileAsync(process.execPath, [join(examplesDir.pathname, file)])
    assert.match(stdout, /\S/)
  }
})
