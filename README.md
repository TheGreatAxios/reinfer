# reinfer

Transparent validation layer for LLM inference clients. One line to wrap. Zero lines to change downstream.

LLMs produce malformed structured output **15–30%** of the time. Self-critique doesn't fix it — the [ReFlect paper (arXiv:2605.05737)](https://arxiv.org/abs/2605.05737v1) found 76–98% false-positive rates on self-verification. The fix is external, deterministic validation + retry-as-code.

```typescript
// Before:
const result = await generateObject({ model, schema, prompt })

// After — one line:
import { reinfer } from 'reinfer-ai-sdk'

const { generateObject } = reinfer({ maxAttempts: 3 })
const result = await generateObject({ model, schema, prompt })
```

The proxy handles schema validation, auto-fix of malformed JSON, retry with diagnostic feedback, and escape hatches — without changing your downstream code.

## Repo Structure

```
reinfer/
├── AGENTS.md                   ← Full architecture, edge case maps, roadmap
├── README.md
├── concepts/                   ← Foundational design docs
│
├── typescript/                 ← TS monorepo (Bun + tsdown)
│   ├── packages/core/          ← reinfer (zero deps, core engine)
│   ├── packages/ai-sdk/        ← reinfer-ai-sdk (Vercel AI SDK proxy)
│   └── bench/                  ← Benchmark runners
│
└── python/                     ← Python (coming soon)
```

## Quick Start

```bash
cd typescript
bun install
bun run test              # 81+ tests, all pass
bun run bench:simple      # requires OPENROUTER_API_KEY
```

See [typescript/README.md](./typescript/README.md) for usage, [AGENTS.md](./AGENTS.md) for the full roadmap.

## License

MIT
