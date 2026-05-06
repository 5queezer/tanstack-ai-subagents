export class RetryExhaustedError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message)
    this.name = 'RetryExhaustedError'
    this.cause = options?.cause
  }
}

export class BudgetError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BudgetError'
  }
}

export async function runWithRetry<T>(fn: (attempt: number) => Promise<T> | T, policy: { maxRetries?: number; delayMs?: number } = {}) {
  const maxRetries = policy.maxRetries ?? 1
  if (!Number.isInteger(maxRetries) || maxRetries < 1) throw new RangeError('maxRetries must be at least 1')
  let lastError: unknown
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return { value: await fn(attempt), attempts: attempt }
    } catch (error) {
      lastError = error
      if (attempt < maxRetries && policy.delayMs && policy.delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, policy.delayMs))
      }
    }
  }
  throw new RetryExhaustedError(`retries exhausted after ${maxRetries} attempt(s)`, { cause: lastError })
}

export function enforceBudgetSnapshot(
  snapshot: { cost?: number; tokens?: number; turns?: number } = {},
  budget: { maxCost?: number; maxTokens?: number; maxTurns?: number } = {},
) {
  if (budget.maxCost !== undefined && (snapshot.cost ?? 0) > budget.maxCost) {
    throw new BudgetError(`cost ${snapshot.cost ?? 0} exceeds maxCost ${budget.maxCost}`)
  }
  if (budget.maxTokens !== undefined && (snapshot.tokens ?? 0) > budget.maxTokens) {
    throw new BudgetError(`tokens ${snapshot.tokens ?? 0} exceeds maxTokens ${budget.maxTokens}`)
  }
  if (budget.maxTurns !== undefined && (snapshot.turns ?? 0) > budget.maxTurns) {
    throw new BudgetError(`turns ${snapshot.turns ?? 0} exceeds maxTurns ${budget.maxTurns}`)
  }
}
