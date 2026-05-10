# reinfer

Zero-dependency validation engine. No runtime deps.

## Modules

| File | Exports |
|------|---------|
| `types.ts` | `Schema`, `Check`, `ValidationResult`, `AutoFixResult`, `ValidatorOptions` |
| `validator.ts` | `validate()`, `extractString()`, `formatViolations()` |
| `auto-fix.ts` | `autoFixJson()` — 9-step syntactic fix pipeline |
| `retry.ts` | `buildRetryFeedback()`, `buildToolCallRetryFeedback()`, `buildRetryPrompt()` |
| `schemas/registry.ts` | Global `SchemaRegistry` singleton |
| `schemas/json-schema.ts` | Checks: `validJson`, `isObject`, `requiredFields`, `fieldTypes`, `enumValues` |

## Auto-Fix Pipeline (9 steps, ordered)

1. Strip `<think>` tags (DeepSeek reasoning traces)
2. Strip markdown fences (```json ... ```)
3. Extract JSON from prose wrapping
4. Strip trailing non-JSON text
5. Try parsing as-is
6. Fix trailing commas
7. Fix single quotes → double quotes
8. Fix unquoted keys
9. Combined fixes + missing closing braces

All are syntactic only. Semantic violations (wrong types, missing fields) are not auto-fixed.

## Test Strategy

- Pure unit tests for all functions (no mocks needed)
- Fuzz-style tests for auto-fix with known failure patterns
- Property: autoFixJson never throws, always returns valid JSON or null

## Build

```bash
cd packages/core && bun run build
# Outputs dist/index.mjs via tsdown
```
