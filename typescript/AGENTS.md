# TypeScript Monorepo — inferred-validation

TypeScript implementation of the inferred-validation validation layer. Bun monorepo with npm packages targeting the Vercel AI SDK ecosystem.

---

## Structure

```
typescript/
├── packages/
│   ├── core/              @inferred-validation/core
│   │   ├── src/index.ts   Schema, Check, ValidationResult
│   │   ├── src/validator   validate(), extractString()
│   │   ├── src/auto-fix    JSON auto-fix pipeline (9 steps)
│   │   ├── src/retry       retry message builders
│   │   └── src/schemas/    validJson, requiredFields, fieldTypes, enumValues
│   │
│   └── ai-sdk/            @inferred-validation/ai-sdk
│       ├── src/proxy.ts   validated() → { generateText, generateObject }
│       ├── src/extractor   extractText(), extractRawFromError()
│       ├── src/signals     hasSchema(), getFinishReason()
│       └── src/errors      classifyError(), isValidationError()
│
├── bench/
│   └── simple/            @inferred-validation/bench-simple
│       └── src/           13 scenarios, OpenRouter, full logging
│
├── package.json           workspaces, scripts
├── bunfig.toml
└── tsconfig.json
```

## Commands (from repo root)

| Command | What |
|---------|------|
| `bun run build` | Build all packages with tsdown |
| `bun run test` | Run all tests (81+) |
| `bun run test:watch` | Watch mode |
| `bun run bench:simple` | Run benchmarks against OpenRouter (needs API key) |
| `bun run bench:report` | Generate report from stored benchmark results |

## Key Design Decisions

- **ESM-only**: No CJS. Modern Node/Bun only.
- **Zero-deps core**: `@inferred-validation/core` has zero runtime dependencies.
- **Source-level dev**: `package.json` points at `./src/index.ts` during development. `publishConfig` swaps to `./dist/` for npm publishing.
- **Workspace protocol**: Packages reference each other via `"@inferred-validation/core": "workspace:*"`.
- **Mock-based testing**: AI SDK proxy tested via `MockLanguageModelV3` from `ai/test` — no real API keys needed.

## Build Order

```
1. core       ← foundation, zero deps, testable in isolation
2. ai-sdk     ← highest-value TS target (wraps generateText/generateObject)
3. openai     ← next priority (10+ providers via one package)
4. anthropic, gemini, langchain, mastra
```
