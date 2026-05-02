import type { RoutingLevel, SubagentAction, SubagentRoutingNote } from './types.js'

type Intent = Exclude<SubagentRoutingNote['promptClass'], 'question' | 'operations'>

type IntentScore = {
  intent: Intent
  score: number
}

const intentTerms: Record<Intent, readonly string[]> = {
  research: ['search', 'find', 'github', 'issue', 'issues', 'pr', 'pull request', 'code', 'file', 'files', 'comment', 'comments', 'status', 'check', 'checks', 'ci', 'workflow'],
  implementation: ['implement', 'build', 'add', 'create', 'modify', 'refactor', 'change', 'migrate', 'deploy'],
  review: ['review', 'audit', 'inspect', 'critique'],
  debugging: ['debug', 'fix', 'bug', 'failing', 'error', 'regression'],
  optimization: ['optimize', 'optimise', 'performance', 'bundle', 'latency', 'speed', 'benchmark'],
}

const unsafeTerms = ['secret', 'token', 'credential', 'password', 'bypass', 'exfiltrate', 'extract secrets', 'private key']
const highRiskTerms = ['auth', 'authentication', 'database', 'migration', 'deploy', 'production', 'permission', 'permissions', 'security', 'payment', 'billing']
const parallelTerms = ['parallel', 'independent', 'separate', 'multiple', 'several']
const areaTerms = ['frontend', 'ui', 'client', 'backend', 'server', 'api', 'database', 'auth', 'tests', 'test']

export function routeSubagentRequest(prompt: string): SubagentRoutingNote {
  const text = normalize(prompt)
  const scores = scoreIntents(text)
  const unsafe = hasAnyTerm(text, unsafeTerms)
  const highRisk = hasAnyTerm(text, highRiskTerms)
  const parallel = hasAnyTerm(text, parallelTerms) || hasOrderedPair(text, ['frontend', 'backend']) || hasOrderedPair(text, ['backend', 'frontend'])
  const multiArea = countDistinctTerms(text, areaTerms) >= 2 || hasOrderedPair(text, ['frontend', 'backend']) || hasOrderedPair(text, ['backend', 'frontend'])
  const simpleQuestion = /^(what|who|when|where|why|how)\b/.test(text) && text.length < 120 && scoreFor(scores, 'implementation') === 0 && scoreFor(scores, 'review') === 0
  const top = topIntent(scores)
  const ambiguous = isAmbiguous(scores)

  if (unsafe) {
    return note('operations', 'high', 'multi-domain', 'low', 'high', 'high', 'reject_clarify_escalate', 'Prompt is unsafe, privacy-sensitive, or asks to bypass permissions.', 'Refuse unsafe action or ask for a safe, bounded read-only request.')
  }

  if (simpleQuestion && !top) {
    return note('question', 'low', 'single-domain', 'low', 'low', 'low', 'answer_directly', 'Prompt is a simple low-risk question that does not need tools or delegation.', 'Answer directly and mention uncertainty if relevant.')
  }

  if (!top || ambiguous) {
    return note('question', 'medium', multiArea ? 'multi-domain' : 'single-domain', 'low', 'medium', 'low', 'use_tools', 'Prompt intent is ambiguous; use tools conservatively instead of forcing a specialist route.', 'Gather evidence with available tools, then decide whether planning or specialist execution is warranted.')
  }

  if (top.intent === 'review' && parallel && multiArea) {
    return note('review', 'high', 'multi-domain', 'high', 'medium', 'medium', 'spawn_multiple_specialists', 'Review work is separable across domains, so independent specialists can reduce latency and blind spots.', 'Each specialist returns findings; one integrator deduplicates, validates, and decides next steps.')
  }

  if (top.intent === 'implementation' && (highRisk || multiArea)) {
    return note('implementation', 'high', multiArea ? 'multi-domain' : 'single-domain', 'medium', 'high', highRisk ? 'high' : 'medium', 'write_plan_first', 'Implementation is multi-step or high-risk; write a plan before spawning or editing.', 'Plan lists files, tests, validation commands, and integration owner before execution.')
  }

  if (top.intent === 'research') {
    return note('research', 'medium', multiArea ? 'multi-domain' : 'single-domain', 'low', 'medium', 'low', 'use_tools', 'Focused research is best handled by the current agent using read-only tools.', 'Cite retrieved sources or GitHub URLs and summarize relevant evidence.')
  }

  if ((top.intent === 'review' || top.intent === 'debugging' || top.intent === 'optimization') && !parallel) {
    return note(top.intent, 'medium', multiArea ? 'multi-domain' : 'single-domain', 'medium', 'medium', 'low', 'spawn_one_specialist', 'A bounded specialist can inspect this task independently without multi-agent fanout.', 'Specialist returns concise findings with evidence and validation commands.')
  }

  return note('question', 'medium', multiArea ? 'multi-domain' : 'single-domain', 'low', 'medium', 'low', 'use_tools', 'Default to one agent with tools unless delegation has clear expected value.', 'Use available tools as needed and provide a concise answer with evidence.')
}

function normalize(prompt: string) {
  return prompt.toLowerCase().replace(/[^a-z0-9\s-]/g, ' ').replace(/\s+/g, ' ').trim()
}

function scoreIntents(text: string): IntentScore[] {
  return Object.entries(intentTerms).map(([intent, terms]) => ({
    intent: intent as Intent,
    score: countDistinctTerms(text, terms),
  }))
}

function topIntent(scores: IntentScore[]) {
  const ranked = scores.filter((score) => score.score > 0).sort((a, b) => b.score - a.score)
  return ranked[0]
}

function isAmbiguous(scores: IntentScore[]) {
  const ranked = scores.filter((score) => score.score > 0).sort((a, b) => b.score - a.score)
  if (ranked.length < 2) return false

  const [first, second] = ranked
  if (!first || !second) return false
  if (first.score === second.score) return true

  const activeIntents = new Set(ranked.map((score) => score.intent))
  return activeIntents.has('research') && activeIntents.has('debugging') && first.score - second.score <= 1
}

function scoreFor(scores: IntentScore[], intent: Intent) {
  return scores.find((score) => score.intent === intent)?.score ?? 0
}

function countDistinctTerms(text: string, terms: readonly string[]) {
  return terms.filter((term) => hasTerm(text, term)).length
}

function hasAnyTerm(text: string, terms: readonly string[]) {
  return terms.some((term) => hasTerm(text, term))
}

function hasTerm(text: string, term: string) {
  return new RegExp(`\\b${escapeRegExp(term).replace(/\\s+/g, '\\s+')}\\b`).test(text)
}

function hasOrderedPair(text: string, [first, second]: readonly [string, string]) {
  return new RegExp(`\\b${escapeRegExp(first)}\\b.*\\b${escapeRegExp(second)}\\b`).test(text)
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function note(
  promptClass: SubagentRoutingNote['promptClass'],
  complexity: RoutingLevel,
  domainBreadth: SubagentRoutingNote['domainBreadth'],
  subtaskIndependence: RoutingLevel,
  verificationBurden: RoutingLevel,
  costLatencyPrivacyRisk: RoutingLevel,
  chosenAction: SubagentAction,
  rationale: string,
  validationGate: string,
): SubagentRoutingNote {
  return { promptClass, complexity, domainBreadth, subtaskIndependence, verificationBurden, costLatencyPrivacyRisk, chosenAction, rationale, validationGate }
}
