import { z } from 'zod'
import type { RunSubagentsInput } from './types.js'

export const routingLevelSchema = z.enum(['low', 'medium', 'high'])
export const delegationAuthoritySchema = z.enum(['read_only', 'write_local', 'external_side_effect'])

export const subagentActionSchema = z.enum([
  'answer_directly',
  'use_tools',
  'write_plan_first',
  'spawn_one_specialist',
  'spawn_multiple_specialists',
  'reject_clarify_escalate',
])

export const subagentRoutingNoteSchema = z.object({
  promptClass: z.string().min(1),
  complexity: routingLevelSchema,
  domainBreadth: z.enum(['single-domain', 'multi-domain']),
  subtaskIndependence: routingLevelSchema,
  verificationBurden: routingLevelSchema,
  costLatencyPrivacyRisk: routingLevelSchema,
  chosenAction: subagentActionSchema,
  rationale: z.string(),
  validationGate: z.string(),
})

export const subagentRouteInputSchema = z.object({
  prompt: z.string(),
})
export type SubagentRouteInput = z.infer<typeof subagentRouteInputSchema>

export const subagentWorkerBriefSchema = z.object({
  name: z.string(),
  objective: z.string(),
  scope: z.string(),
  nonGoals: z.string(),
  toolNames: z.array(z.string()).optional(),
  profile: z.string().optional(),
  expectedOutput: z.string(),
  dependsOn: z.array(z.string()).optional(),
  verificationCriteria: z.string().optional(),
  authority: delegationAuthoritySchema.optional(),
  risk: routingLevelSchema.optional(),
})

export const runSubagentsInputSchema = z.object({
  originalPrompt: z.string(),
  model: z.string().optional(),
  routingNote: subagentRoutingNoteSchema,
  workers: z.array(subagentWorkerBriefSchema).min(1),
})
export type RunSubagentsToolInput = z.infer<typeof runSubagentsInputSchema> & RunSubagentsInput<string>

export const delegateSubagentsInputSchema = z.object({
  originalPrompt: z.string(),
  model: z.string().optional(),
  workers: z.array(subagentWorkerBriefSchema).min(1),
})
export type DelegateSubagentsToolInput = z.infer<typeof delegateSubagentsInputSchema> & Omit<RunSubagentsInput<string>, 'routingNote'>
