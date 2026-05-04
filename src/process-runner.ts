import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { RunSubagentsInput, SubagentWorkerBrief, SubagentWorkerResult, SubagentWorkerRunner } from './types.js'

type MaybeFactory<T, TToolName extends string> = T | ((brief: SubagentWorkerBrief<TToolName>, input: RunSubagentsInput<TToolName>) => T)

export type ProcessWorkerExit<TToolName extends string = string> = {
  brief: SubagentWorkerBrief<TToolName>
  input: RunSubagentsInput<TToolName>
  stdout: string
  stderr: string
  exitCode: number | null
  signal: NodeJS.Signals | null
}

export type CreateProcessWorkerRunnerOptions<TToolName extends string = string> = {
  command: MaybeFactory<string, TToolName>
  args?: MaybeFactory<readonly string[], TToolName>
  cwd?: MaybeFactory<string | undefined, TToolName>
  env?: MaybeFactory<Record<string, string | undefined> | undefined, TToolName>
  timeoutMs?: number
  input?: MaybeFactory<string, TToolName>
  parseResult?: (exit: ProcessWorkerExit<TToolName>) => SubagentWorkerResult | Promise<SubagentWorkerResult>
}

export function createProcessWorkerRunner<TToolName extends string = string>(
  options: CreateProcessWorkerRunnerOptions<TToolName>,
): SubagentWorkerRunner<TToolName> {
  return async (brief, input, context) => {
    const exit = await runProcessWorker(brief, input, options, context)
    if (options.parseResult) return options.parseResult(exit)
    return defaultProcessResult(exit)
  }
}

async function runProcessWorker<TToolName extends string>(
  brief: SubagentWorkerBrief<TToolName>,
  input: RunSubagentsInput<TToolName>,
  options: CreateProcessWorkerRunnerOptions<TToolName>,
  context: Parameters<SubagentWorkerRunner<TToolName>>[2],
): Promise<ProcessWorkerExit<TToolName>> {
  const command = resolveOption(options.command, brief, input)
  const args = [...(resolveOption(options.args, brief, input) ?? [])]
  const cwd = resolveOption(options.cwd, brief, input)
  const env = resolveOption(options.env, brief, input)
  const stdin = options.input === undefined
    ? `${JSON.stringify({ brief, input })}\n`
    : resolveOption(options.input, brief, input)

  return new Promise((resolve, reject) => {
    if (!command) {
      reject(new Error('process worker command is required'))
      return
    }

    const child = spawn(command, args, {
      cwd,
      env: env ? { ...process.env, ...env } : process.env,
      shell: false,
      stdio: 'pipe',
    }) as ChildProcessWithoutNullStreams

    let stdout = ''
    let stderr = ''
    let settled = false
    let timeout: ReturnType<typeof setTimeout> | undefined

    const finish = (exitCode: number | null, signal: NodeJS.Signals | null) => {
      if (settled) return
      settled = true
      if (timeout) clearTimeout(timeout)
      resolve({ brief, input, stdout: stdout.trimEnd(), stderr: stderr.trimEnd(), exitCode, signal })
    }

    const abort = () => {
      if (settled) return
      child.kill('SIGTERM')
      setTimeout(() => {
        if (!settled) child.kill('SIGKILL')
      }, 5000).unref?.()
    }

    if (options.timeoutMs !== undefined) {
      timeout = setTimeout(abort, options.timeoutMs)
      timeout.unref?.()
    }

    if (context?.signal?.aborted) abort()
    else context?.signal?.addEventListener('abort', abort, { once: true })

    child.stdout?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stdout += chunk
      void context?.onUpdate?.({ stream: 'stdout', chunk })
    })

    child.stderr?.on('data', (data: Buffer) => {
      const chunk = data.toString()
      stderr += chunk
      void context?.onUpdate?.({ stream: 'stderr', chunk })
    })

    child.on('error', reject)
    child.on('close', finish)

    child.stdin?.end(stdin)
  })
}

function defaultProcessResult<TToolName extends string>(exit: ProcessWorkerExit<TToolName>): SubagentWorkerResult {
  const output = exit.stdout || exit.stderr
  if (exit.exitCode === 0) {
    return { name: exit.brief.name, status: 'completed', output }
  }

  const reason = exit.signal ? `terminated by signal ${exit.signal}` : `exited with code ${exit.exitCode}`
  return {
    name: exit.brief.name,
    status: 'failed',
    output,
    error: `Process worker ${reason}`,
  }
}

function resolveOption<T, TToolName extends string>(
  option: MaybeFactory<T, TToolName> | undefined,
  brief: SubagentWorkerBrief<TToolName>,
  input: RunSubagentsInput<TToolName>,
): T | undefined {
  if (typeof option === 'function') {
    return (option as (brief: SubagentWorkerBrief<TToolName>, input: RunSubagentsInput<TToolName>) => T)(brief, input)
  }
  return option
}
