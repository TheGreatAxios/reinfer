# reinfer-ai-sdk

Vercel AI SDK proxy with automatic output validation, auto-fix, and retry.

## Install

```bash
bun add reinfer-ai-sdk
```

Requires `ai` as a peer dependency:
```bash
bun add ai
```

## Usage

```typescript
import { reinfer } from 'reinfer-ai-sdk'
import { z } from 'zod'
import { openai } from '@ai-sdk/openai'

// 1-line integration
const { generateObject } = reinfer({ maxAttempts: 3 })

const result = await generateObject({
  model: openai('gpt-4o'),
  schema: z.object({ name: z.string(), age: z.number() }),
  prompt: 'Generate a person',
})

console.log(result.object)
```

If the model produces invalid output, the proxy catches the error, attempts auto-fix, retries with specific Zod violations as feedback, and returns the corrected result — caller never knows a retry happened.

## Configuration

```typescript
const { generateText } = reinfer({
  maxAttempts: 3,
  onValidationFailure: (f) => console.log(f.violations),
  autoDetect: true,
})
```

See [AGENTS.md](./AGENTS.md) for full API reference.
