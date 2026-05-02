import type { RoutingLevel, SubagentAction, SubagentRoutingNote } from './types.js'

export function routeSubagentRequest(prompt: string): SubagentRoutingNote {
  const text = prompt.toLowerCase()
  const unsafe = /\b(secret|token|credential|password|bypass|exfiltrate|extract secrets|private key)\b/.test(text)
  const research = /\b(search|find|github|issue|issues|pr|pull request|code|file|files|comments?|status|checks?|ci|workflow)\b/.test(text)
  const implementation = /\b(implement|build|add|create|modify|refactor|change|migrate|deploy|database|auth|authentication)\b/.test(text)
  const review = /\b(review|audit|inspect|critique|check)\b/.test(text)
  const debugging = /\b(debug|fix|bug|failing|error|regression)\b/.test(text)
  const optimization = /\b(optimi[sz]e|performance|bundle|latency|speed|benchmark)\b/.test(text)
  const parallel = /\b(parallel|independent|separate|frontend.*backend|backend.*frontend|frontend, backend|backend, frontend|multiple|several)\b/.test(text)
  const multiArea = /(frontend|ui|client).*(backend|server|api|database|tests?)|(backend|server|api|database).*(frontend|ui|client|tests?)|\b(auth|database|deploy|frontend|backend|tests?)\b.*\b(auth|database|deploy|frontend|backend|tests?)\b/.test(text)
  const highRisk = /\b(auth|authentication|database|migration|deploy|production|permissions?|security|payment|billing)\b/.test(text)
  const simpleQuestion = /^(what|who|when|where|why|how)\b/.test(text) && text.length < 120 && !implementation && !review

  if (unsafe) {
    return note('operations', 'high', 'multi-domain', 'low', 'high', 'high', 'reject_clarify_escalate', 'Prompt is unsafe, privacy-sensitive, or asks to bypass permissions.', 'Refuse unsafe action or ask for a safe, bounded read-only request.')
  }

  if (parallel && review && multiArea) {
    return note('review', 'high', 'multi-domain', 'high', 'medium', 'medium', 'spawn_multiple_specialists', 'Review work is separable across domains, so independent specialists can reduce latency and blind spots.', 'Each specialist returns findings; one integrator deduplicates, validates, and decides next steps.')
  }

  if (implementation && (highRisk || multiArea)) {
    return note('implementation', 'high', multiArea ? 'multi-domain' : 'single-domain', 'medium', 'high', highRisk ? 'high' : 'medium', 'write_plan_first', 'Implementation is multi-step or high-risk; write a plan before spawning or editing.', 'Plan lists files, tests, validation commands, and integration owner before execution.')
  }

  if (research) {
    return note('research', 'medium', multiArea ? 'multi-domain' : 'single-domain', 'low', 'medium', 'low', 'use_tools', 'Focused research is best handled by the current agent using read-only tools.', 'Cite retrieved sources or GitHub URLs and summarize relevant evidence.')
  }

  if ((review || debugging || optimization) && !parallel) {
    return note(review ? 'review' : debugging ? 'debugging' : 'optimization', 'medium', multiArea ? 'multi-domain' : 'single-domain', 'medium', 'medium', 'low', 'spawn_one_specialist', 'A bounded specialist can inspect this task independently without multi-agent fanout.', 'Specialist returns concise findings with evidence and validation commands.')
  }

  if (simpleQuestion) {
    return note('question', 'low', 'single-domain', 'low', 'low', 'low', 'answer_directly', 'Prompt is a simple low-risk question that does not need tools or delegation.', 'Answer directly and mention uncertainty if relevant.')
  }

  return note('question', 'medium', multiArea ? 'multi-domain' : 'single-domain', 'low', 'medium', 'low', 'use_tools', 'Default to one agent with tools unless delegation has clear expected value.', 'Use available tools as needed and provide a concise answer with evidence.')
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
