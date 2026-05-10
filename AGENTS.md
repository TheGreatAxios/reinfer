# AGENTS.md

Project: reinfer

A transparent validation layer for LLM inference clients. One line to wrap. Zero lines to change downstream. Per-SDK packages that know each SDK's edge cases.

**Why**: LLMs produce malformed structured output 15–30% of the time. Self-critique doesn't fix it (ReFlect paper: 76–98% false-positive rate on self-verification). The fix is external, deterministic validation + retry-as-code.

## Architecture

```
reinfer/
│
├── README.md, AGENTS.md           ← docs
│
├── typescript/                    ← TypeScript monorepo (Bun + tsdown)
│   └── packages/
│       ├── core/                  ← reinfer (zero deps)
│       ├── ai-sdk/                ← reinfer-ai-sdk
│       ├── openai/                ← (future) covers 10+ OpenAI-compatible providers
│       ├── anthropic/             ← (future)
│       ├── gemini/                ← (future)
│       ├── langchain/             ← (future)
│       └── mastra/                ← (future)
│
└── python/                        ← Python monorepo (future)
    ├── core/
    ├── openai/                    ← (future)
    ├── anthropic/                 ← (future)
    └── gemini/                    ← (future)
```

---

## The Core/Per-SDK Split

| Layer | Responsibilities |
|---|---|
| **CORE** (SDK-agnostic) | Schema registry, validation engine (extract → check → diagnose), auto-fix JSON pipeline, retry message builders, escape hatch strategies, metrics logger, built-in schemas |
| **PER-SDK** (unique) | Proxy/wrapper intercepting the SDK's method, content extractor, signal detector (finish_reason, truncation, refusals), retry formatter, error handler |

---

## Configuration

```typescript
const { generateObject } = reinfer({
  maxAttempts: 3,
  onValidationFailure: (f) => console.log(f.violations),
  autoDetect: true,
  failFast: true,
  stripProse: true,
})
```


---

## Development Conventions

- **Python**: `pyproject.toml` with optional dependency groups. Core has zero external deps.
- **TypeScript**: Separate npm packages with peer dependencies. Built with tsdown (ESM-only).
- **Testing**: pytest (Python), bun test (TypeScript). Mock-based for proxy tests.
- **Return type preservation**: Proxy ALWAYS returns the real SDK response object.
- **Zero overhead on passthrough**: No schema detected → literal passthrough.
- **Violation messages must be actionable**: "Invalid JSON at line 3, col 12: expecting comma" not "Invalid JSON."
