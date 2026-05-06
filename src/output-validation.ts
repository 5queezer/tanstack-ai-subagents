export class OutputValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OutputValidationError'
  }
}

export type OutputValidationContract = {
  expectedSections?: string[]
  jsonSchema?: { required?: string[] }
}

export type OutputValidationResult =
  | { ok: true; parsed?: never }
  | { ok: true; parsed: unknown }

export function validateWorkerOutput(output: unknown, contract: OutputValidationContract = {}): OutputValidationResult {
  const text = String(output ?? '')
  for (const section of contract.expectedSections ?? []) {
    const re = new RegExp(`^##\\s+${escapeRegExp(section)}\\s*$`, 'im')
    if (!re.test(text)) throw new OutputValidationError(`missing expected section: ${section}`)
  }

  let parsed: unknown
  if (contract.jsonSchema) {
    try {
      parsed = JSON.parse(text)
    } catch (error) {
      throw new OutputValidationError(`invalid JSON output: ${error instanceof Error ? error.message : 'parse failed'}`)
    }
    for (const field of contract.jsonSchema.required ?? []) {
      if ((parsed as Record<string, unknown>)?.[field] === undefined) {
        throw new OutputValidationError(`missing required JSON field: ${field}`)
      }
    }
  }

  return parsed === undefined ? { ok: true as const } : { ok: true as const, parsed }
}

function escapeRegExp(value: string) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
