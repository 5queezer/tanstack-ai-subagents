# @5queezer/tanstack-ai-subagents

Unofficial reusable subagent routing and execution helpers for TanStack AI applications.

> Route one prompt into the right bounded specialist fanout, then run those workers with your own TanStack AI models, tools, and profiles.

![30s routing demo: deterministic routing to bounded worker fanout](demo/routing-in-action.svg)

[Raw asciinema cast](demo/routing-in-action.cast)

## Why this exists

TanStack AI gives you the primitives for models and tools. This package adds the orchestration layer most apps need when one assistant becomes multiple focused workers.

The core opinion: **LLM-as-router is the wrong default for finite routing decisions.** Routing should be fast, deterministic, cheap, and testable. The LLM should do specialist work, not spend tokens deciding which specialist should run.

## The routing bet

Most agent frameworks use another LLM call as the router. This package does not.

For subagent dispatch, the output space is usually finite: refuse, use tools, spawn one specialist, or spawn multiple specialists. That makes routing a classification problem, not a reasoning problem.

`@5queezer/tanstack-ai-subagents` uses deterministic intent scoring by default:

- **microsecond routing** instead of another model round-trip
- **no extra tokens** just to pick a worker
- **repeatable decisions** across runs, CI, and provider model updates
- **debuggable routing rules** you can read, test, and change

Ambiguous prompts fall back to `use_tools`, so your app can decide whether to escalate to an LLM router, ask a clarifying question, or handle the request directly.

> Use LLMs for work that needs reasoning. Use score-based routing when the route set is known.

## What you get

- `routeSubagentRequest(...)` turns user intent into a deterministic routing note.
- `createSubagentRouter(...)` lets apps extend the intent vocabulary, risk terms, ambiguity policy, and fallback action.
- `createSubagentRouterTool(...)` and `createRunSubagentsTool(...)` expose deterministic routing and execution as TanStack AI tools.
- `createDelegateSubagentsTool(...)` lets the LLM directly choose bounded subagent delegation through normal tool calling, without a deterministic route note.
- Your app still owns concrete tools, provider adapters, worker profiles, tracing, persistence, prompts, and UI.

## Why not an LLM router?

| Router style | Best for | Tradeoff |
| --- | --- | --- |
| Score-based routing | Known intent space, 5-20 workers, production paths | Requires maintaining scoring rules |
| LLM routing | Open-ended intents, discovery, hundreds of possible agents | Adds latency, cost, nondeterminism, and harder debugging |
| Hybrid | Production default | Deterministic for confident cases, app fallback for ambiguity |

## Features

- Deterministic score-based subagent routing with `routeSubagentRequest(...)`
- TanStack AI tool factories for `route_subagents` and `run_subagents`
- Bounded worker validation and fanout
- Consumer-defined tool registries and profiles
- Per-worker lifecycle callbacks
- Background run handles with `startSubagents(...)`
- Provider-agnostic model adapter injection

## Install

```bash
npm install @5queezer/tanstack-ai-subagents @tanstack/ai zod
```

`@tanstack/ai` and `zod` are peer dependencies. This package is not an official TanStack package.

## Quick start

```ts
import { chat } from '@tanstack/ai'
import {
  createRunSubagentsTool,
  createSubagentRouterTool,
  routeSubagentRequest,
  startSubagents,
} from '@5queezer/tanstack-ai-subagents'

import { getChatModel } from './ai-provider'
import { githubGet, githubSearch } from './tools'

const tools = {
  github_search: githubSearch,
  github_get: githubGet,
}

const profiles = {
  explore: {
    toolNames: ['github_search', 'github_get'],
    systemPrompt: 'Explore the assigned task and return concise findings with evidence.',
  },
}

export const serverTools = [
  createSubagentRouterTool(),
  createRunSubagentsTool({
    chat,
    getAdapter: getChatModel,
    tools,
    profiles,
    onWorkerStart: (brief) => console.info('worker started', brief.name),
    onWorkerFinish: (result) => console.info('worker finished', result.name, result.status),
  }),
]

const routingNote = routeSubagentRequest('Review architecture')

const handle = startSubagents({
  originalPrompt: 'Review architecture',
  model: 'provider/model',
  routingNote,
  workers: [{
    name: 'explorer',
    objective: 'Inspect the branch',
    scope: 'source and tests',
    nonGoals: 'Do not edit files',
    profile: 'explore',
    expectedOutput: 'Findings with evidence',
  }],
}, { chat, getAdapter: getChatModel, tools, profiles })

const result = await handle.result
```

## Concepts

### Tools

The package does not ship concrete worker tools. Applications provide a tool registry and workers reference tools by name:

```ts
const tools = {
  github_search: githubSearch,
  github_get: githubGet,
}
```

If a worker requests a tool that is not configured, or maps to a nullish implementation, validation fails before the worker runs.

### Profiles

Profiles let applications define reusable worker capabilities:

```ts
const profiles = {
  verify: {
    toolNames: ['test_runner'],
    systemPrompt: 'Verify the assigned task and report exact commands and evidence.',
    model: 'provider/verification-model',
  },
}
```

A worker can then use `profile: 'verify'` instead of listing `toolNames` directly.

### Routing behavior

`routeSubagentRequest(...)` uses deterministic, dependency-free intent scoring rather than first-match regex routing. It scores clear intent groups, treats unsafe prompts as highest priority, and falls back to `use_tools` when intent is ambiguous instead of forcing a specialist route.

Use `createSubagentRouter(...)` when your app has its own domain vocabulary or routing policy:

```ts
const route = createSubagentRouter({
  intents: {
    incident: ['incident', 'outage', 'sev1'],
    security: ['oauth', 'permission', 'vulnerability'],
  },
  highRiskTerms: ['pci', 'production database'],
  parallelTerms: ['ios', 'android'],
  areaTerms: ['frontend', 'backend', 'mobile'],
})

const routingNote = route('Investigate sev1 across ios and android')
```

The TanStack router tool can use the same app-specific router:

```ts
createSubagentRouterTool({ router: route })
```

If you prefer model-directed orchestration, skip `route_subagents` and expose `delegate_subagents` as a normal tool. The model decides whether to call it, while the package still validates worker count and allowed tools:

```ts
createDelegateSubagentsTool({ chat, getAdapter, tools, profiles })
```

Keep environment policy in your app instead of the package core:

```ts
const route = createSubagentRouter(
  process.env.SUBAGENTS_ROUTER_POLICY === 'incidents'
    ? incidentRoutingPolicy
    : undefined,
)
```

### Worker limits

- `spawn_one_specialist` requires exactly one worker.
- `spawn_multiple_specialists` requires at least two workers.
- The default maximum is four workers.
- Override the maximum with `maxWorkers`.

```ts
createRunSubagentsTool({ chat, getAdapter, tools, maxWorkers: 8 })
```

### Lifecycle callbacks

Lifecycle callbacks are observability hooks. Callback failures are ignored so they cannot change worker outcomes.

```ts
createRunSubagentsTool({
  chat,
  getAdapter,
  tools,
  onWorkerStart: (brief) => logStart(brief),
  onWorkerFail: (brief, error) => logFailure(brief, error),
  onWorkerFinish: (result, brief) => logFinish(brief, result),
})
```

### Background runs

`startSubagents(...)` starts the same orchestration as `runSubagents(...)` but returns a handle immediately:

```ts
const handle = startSubagents(input, options)

console.log(handle.runId, handle.status)
const result = await handle.result
```

The handle status is updated to `completed` or `failed` when the result promise settles.

## API

```ts
createSubagentRouter(config?)
createSubagentRouterTool(options?)
createRunSubagentsTool(options)
routeSubagentRequest(prompt)
runSubagents(input, options)
startSubagents(input, options)
validateRunSubagentsInput(input, options)
```

Key exported types include:

```ts
SubagentAction
SubagentRouter
SubagentRouterConfig
SubagentRoutingNote
SubagentWorkerBrief
SubagentWorkerResult
RunSubagentsInput
RunSubagentsResult
RunSubagentsOptions
SubagentProfile
SubagentRunHandle
SubagentToolRegistry
```

## Design boundaries

This package owns routing, validation, bounded fanout, partial failure handling, lifecycle callbacks, background run handles, profile resolution, and TanStack AI tool factories.

Applications own model providers, concrete tools, profile definitions, tracing, persistence, prompts, and UI rendering.
