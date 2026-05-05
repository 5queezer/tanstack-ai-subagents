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
  maxRecursiveDepth?: number
  requireVerification?: boolean
  maxToolsPerWorker?: number
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

export type SubagentRecursiveContext = {
  runId: string
  rootRunId: string
  parentRunId?: string
  depth: number
  childRuns: RunSubagentsResult[]
}

export type RunSubagentsInput<TToolName extends string = string> = {
  originalPrompt: string
  routingNote: SubagentRoutingNote
  workers: Array<SubagentWorkerBrief<TToolName>>
  model?: string
  recursiveContext?: SubagentRecursiveContext
}

export type SubagentWorkerResult =
  | { name: string; status: 'completed'; output: string; error?: never }
  | { name: string; status: 'failed'; output: string; error: string }

export type SubagentWorkerUpdate = {
  stream: 'stdout' | 'stderr'
  chunk: string
}

export type SubagentWorkerRunnerContext = {
  signal?: AbortSignal
  onUpdate?: (update: SubagentWorkerUpdate) => void | Promise<void>
}

export type RunSubagentsResult = {
  runId: string
  rootRunId: string
  parentRunId?: string
  depth: number
  action: SubagentAction
  topology: SubagentTopology
  workers: SubagentWorkerResult[]
  verification?: SubagentVerificationResult
  childRuns: RunSubagentsResult[]
  integrationHint: string
}

export type SubagentWorkerRunner<TToolName extends string = string> = (
  brief: SubagentWorkerBrief<TToolName>,
  input: RunSubagentsInput<TToolName>,
  context?: SubagentWorkerRunnerContext,
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

export type SubagentToolDescriptor<TToolName extends string = string, TTool = unknown> = {
  name: TToolName
  tool: TTool
}

export type SubagentToolSelector<TToolName extends string = string, TTool = unknown> = (args: {
  worker: SubagentWorkerBrief<TToolName>
  originalPrompt: string
  routingNote: SubagentRoutingNote
  availableTools: Array<SubagentToolDescriptor<TToolName, TTool>>
  maxTools: number
}) => Promise<TToolName[]> | TToolName[]

export type TraceFunction = <T>(toolName: string, args: unknown, fn: () => Promise<T>) => Promise<T>
