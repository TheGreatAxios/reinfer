# inferred-validation — TypeScript

Transparent validation layer for LLM inference clients. One line to wrap. Zero lines to change downstream.

## Quick Start

```bash
bun install
bun run test         # 81+ tests, all pass
bun run build        # tsdown → ESM bundles
```

## Usage

```typescript
import { validated } from '@inferred-validation/ai-sdk'
import { openai } from '@ai-sdk/openai'

const { generateObject } = validated({
  maxAttempts: 3,
  onValidationFailure: (f) => console.log('Failed:', f.violations),
})

const result = await generateObject({
  model: openai('gpt-4o'),
  schema: z.object({ name: z.string(), age: z.number() }),
  prompt: 'Generate a person',
})
// Auto-retries with Zod error feedback if the model produces bad output
```

## Packages

| Package | Description |
|---------|-------------|
| `@inferred-validation/core` | Validation engine, auto-fix, schemas, retry builders (zero deps) |
| `@inferred-validation/ai-sdk` | Vercel AI SDK proxy — wraps `generateText()`, `generateObject()` |

## Benchmarks

```bash
OPENROUTER_API_KEY=sk-or-v1-... bun run bench:simple
bun run bench:report
```

See [AGENTS.md](./AGENTS.md) for full architecture and development roadmap.
