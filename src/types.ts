export type RoutingLevel = 'low' | 'medium' | 'high'

export type SubagentAction =
  | 'answer_directly'
  | 'use_tools'
  | 'write_plan_first'
  | 'spawn_one_specialist'
  | 'spawn_multiple_specialists'
  | 'reject_clarify_escalate'

export type SubagentRoutingNote = {
  promptClass: string
  complexity: RoutingLevel
  domainBreadth: 'single-domain' | 'multi-domain'
  subtaskIndependence: RoutingLevel
  verificationBurden: RoutingLevel
  costLatencyPrivacyRisk: RoutingLevel
  chosenAction: SubagentAction
  rationale: string
  validationGate: string
}

export type DelegationAuthority = 'read_only' | 'write_local' | 'external_side_effect'

export type DelegationPolicy = {
  riskTolerance?: RoutingLevel
  maxDepth?: number
  requireVerification?: boolean
}

export type SubagentTopology = 'single' | 'parallel' | 'staged_dag'

export type SubagentVerificationResult = {
  status: 'verified' | 'needs_review' | 'failed'
  summary: string
  checkedWorkers: string[]
}

export type SubagentWorkerBrief<TToolName extends string = string> = {
  name: string
  objective: string
  scope: string
  nonGoals: string
  toolNames?: TToolName[]
  profile?: string
  expectedOutput: string
  dependsOn?: string[]
  verificationCriteria?: string
  authority?: DelegationAuthority
  risk?: RoutingLevel
}

export type RunSubagentsInput<TToolName extends string = string> = {
  originalPrompt: string
  routingNote: SubagentRoutingNote
  workers: Array<SubagentWorkerBrief<TToolName>>
  model?: string
}

export type SubagentWorkerResult =
  | { name: string; status: 'completed'; output: string; error?: never }
  | { name: string; status: 'failed'; output: string; error: string }

export type RunSubagentsResult = {
  action: SubagentAction
  topology: SubagentTopology
  workers: SubagentWorkerResult[]
  verification?: SubagentVerificationResult
  integrationHint: string
}

export type SubagentWorkerRunner<TToolName extends string = string> = (
  brief: SubagentWorkerBrief<TToolName>,
  input: RunSubagentsInput<TToolName>,
) => Promise<SubagentWorkerResult>

export type SubagentProfile<TToolName extends string = string> = {
  toolNames: TToolName[]
  systemPrompt?: string
  model?: string
}

export type SubagentRunHandle = {
  runId: string
  status: 'running' | 'completed' | 'failed'
  result: Promise<RunSubagentsResult>
}

export type SubagentToolRegistry<TToolName extends string = string, TTool = unknown> = Record<TToolName, TTool>

export type TraceFunction = <T>(toolName: string, args: unknown, fn: () => Promise<T>) => Promise<T>
