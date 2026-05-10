# @reinfer/ai-sdk

Vercel AI SDK proxy. Wraps `generateText()` and `generateObject()` with automatic output validation, auto-fix, and retry.

## Architecture

```
validated({ maxAttempts, schemas, onValidationFailure })
  │
  ├── generateText(params)
  │   ├── No schema detected → passthrough (zero overhead)
  │   ├── Truncated (length) → retry with higher budget hint
  │   ├── Valid response → return immediately
  │   └── Invalid response → auto-fix → retry with feedback
  │
  └── generateObject(params)
      ├── SDK validates Zod schema internally → throws on failure
      ├── Catch throw → extract raw text → auto-fix
      ├── Auto-fix succeeds + re-parse passes → return fixed result
      └── Auto-fix fails → retry generateObject with Zod errors in prompt
```

## Modules

| File | Exports |
|------|---------|
| `proxy.ts` | `validated()` — the main entry point |
| `signals.ts` | `hasSchema()`, `detectSchema()`, `getFinishReason()`, `mapFinishReason()` |
| `extractor.ts` | `extractText()`, `extractRawFromError()` |
| `errors.ts` | `classifyError()`, `isValidationError()` |

## Error Classification

| Action | Triggers |
|--------|----------|
| `retry` | RateLimit, Timeout, Overloaded, TypeValidationError, NoObjectGeneratedError |
| `escape` | 400/401/403, content-filter, safety, refusal |
| `throw` | All other unexpected errors |

## Test Strategy

- Uses `MockLanguageModelV3` from `ai/test` for all proxy tests
- No real API keys needed
- Tests: passthrough, valid output, Zod schema mismatch, malformed JSON, auto-fix, truncation, exhausted retries
- 36 tests, all pass

## v0.1 Scope (non-streaming)

Streaming support (`streamText`, `streamObject`) is deferred to v0.2.
