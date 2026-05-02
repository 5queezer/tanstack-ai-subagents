# @tanstack/ai-subagents

Reusable subagent routing and execution helpers for TanStack AI applications.

## Features

- Deterministic subagent routing with `routeSubagentRequest(...)`
- TanStack AI tool factories for `route_subagents` and `run_subagents`
- Bounded worker validation and fanout
- Consumer-defined tool registries and profiles
- Per-worker lifecycle callbacks
- Background run handles with `startSubagents(...)`
- Provider-agnostic model adapter injection

## Install

```bash
npm install @tanstack/ai-subagents @tanstack/ai zod
```

`@tanstack/ai` and `zod` are peer dependencies.

## Quick start

```ts
import { chat } from '@tanstack/ai'
import {
  createRunSubagentsTool,
  createSubagentRouterTool,
  routeSubagentRequest,
  startSubagents,
} from '@tanstack/ai-subagents'

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

const routingNote = routeSubagentRequest('Review this branch')

const handle = startSubagents({
  originalPrompt: 'Review this branch',
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

If a worker requests a tool that is not configured, validation fails before the worker runs.

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

## API

```ts
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

## Publishing

Publish from this package root.

### Prerequisites

1. Create or use an npm account at <https://www.npmjs.com>.
2. Enable 2FA or create a granular npm access token.
3. Log in locally:

```bash
npm login
```

4. Confirm you have publish rights for the `@tanstack` scope.

### Validate package contents

```bash
npm test
npm run typecheck
npm run build
npm pack --dry-run
```

Check `npm pack --dry-run` carefully before publishing. The package should include `dist`, `README.md`, `LICENSE`, and `package.json`; it should not include secrets, local config, source app files, or unrelated tests.

### Publish

```bash
npm publish --access public
```

Verify the package at:

```text
https://www.npmjs.com/package/@tanstack/ai-subagents
```

### Release updates

npm versions are immutable. Bump semver before each release:

```bash
npm version patch
npm publish --access public
```

Use `minor` for backwards-compatible features and `major` for breaking changes.
