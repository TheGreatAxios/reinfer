# @reinfer/ai-sdk

Vercel AI SDK proxy with automatic output validation, auto-fix, and retry.

## Install

```bash
bun add @reinfer/ai-sdk
```

Requires `ai` as a peer dependency:
```bash
bun add ai
```

## Usage

```typescript
import { validated } from '@reinfer/ai-sdk'
import { z } from 'zod'
import { openai } from '@ai-sdk/openai'

// 1-line integration — wrap and use
const { generateObject } = validated({ maxAttempts: 3 })

// Same API as the AI SDK, but with automatic validation + retry
const result = await generateObject({
  model: openai('gpt-4o'),
  schema: z.object({ name: z.string(), age: z.number() }),
  prompt: 'Generate a person',
})

console.log(result.object) // { name: '...', age: ... }
```

If the model produces invalid output, the proxy:
1. Catches the Zod validation error
2. Attempts to auto-fix common JSON issues (trailing commas, unquoted keys, etc.)
3. Retries with the specific validation errors as feedback
4. Returns the corrected result — caller never knows a retry happened

## Configuration

```typescript
const { generateText } = validated({
  maxAttempts: 3,
  onValidationFailure: (f) => console.log(f.violations),
  schemas: { default: myCustomSchema },
  autoDetect: true,
})
```

See [AGENTS.md](./AGENTS.md) for full API reference.
