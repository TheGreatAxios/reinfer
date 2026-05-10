# AGENTS.md

Project: inferred-validation

A transparent validation layer for LLM inference clients. One line to wrap. Zero lines to change downstream. Per-SDK packages that know each SDK's edge cases.

**Why**: LLMs produce malformed structured output 15–30% of the time. Self-critique doesn't fix it (ReFlect paper: 76–98% false-positive rate on self-verification). The fix is external, deterministic validation + retry-as-code.

## Architecture

```
inferred-validator/
│
├── README.md, AGENTS.md           ← docs
│
├── typescript/                    ← TypeScript monorepo (Bun + tsdown)
│   └── packages/
│       ├── core/                  ← @inferred-validation/core (zero deps)
│       ├── ai-sdk/                ← @inferred-validation/ai-sdk
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

## Configuration API

```python
client = validated(
    OpenAI(),
    max_attempts=3,
    on_validation_failure=my_callback,
    escape="fallback_model",
    schemas={"my_api": Schema("my_api", [...checks...])},
    auto_detect=True,
    on_escape=my_callback,
    logger=my_logger_fn,
    fail_fast=True,
    strip_prose=True,  # extract JSON from prose wrapping
)
```

---

## Development Roadmap

### v0.1 — TypeScript Core + AI SDK (DONE)
- ✅ Core: Schema, Check, ValidationResult, ValidatorEngine, autoFixJson, retry builders
- ✅ Core: JSON schema checks (validJson, requiredFields, fieldTypes, enumValues)
- ✅ AI SDK proxy: wraps `generateText()`, `generateObject()`
- ✅ AI SDK proxy: catches `generateObject()` throws, retries with Zod errors
- ✅ AI SDK proxy: auto-fixes trailing commas before retry
- ✅ AI SDK proxy: handles truncation with higher-budget retry
- ✅ Tests: 81 passing (45 core + 36 ai-sdk)
- ✅ Benchmarks: 11 scenarios against OpenRouter (90.9% pass rate)
- ✅ npm package structure (@inferred-validation/core, @inferred-validation/ai-sdk)

### v0.1 — Python Core + OpenAI (PENDING)
- [ ] Core: Port to Python (`validate()`, `autoFixJson()`, retry builders)
- [ ] OpenAI proxy: wrap `client.chat.completions.create()`
- [ ] OpenAI proxy: handle `finish_reason` (length, content_filter, tool_calls)
- [ ] OpenAI proxy: handle null content (tool calls), refusals, think-tag stripping
- [ ] Tests: 20+ edge cases
- [ ] Streaming: post-stream validation with callback

### v0.2 — Anthropic + Gemini + Logging
- [ ] Anthropic proxy (Python + TS): content block arrays, message alternation rule, refusal/pause_turn handling
- [ ] Gemini proxy (Python + TS): parts[] array, SAFETY/RECITATION handling
- [ ] Core: Metrics logger, SQL/XML schemas
- [ ] Escape hatch: fallback_model, queue_human strategies
- [ ] Tests: per-SDK edge cases (block types, alternation, RECITATION)

### v0.3 — LangChain + Mastra + Polish
- [ ] LangChain proxy: `llm.invoke()`, `with_structured_output()`
- [ ] Mastra proxy: `agent.generate()` (thin layer over AI SDK proxy)
- [ ] Custom schema helpers (user-defined checks)
- [ ] Dashboard / summary CLI: `inferred-validation stats`
- [ ] Publish to PyPI and npm

### v0.4 — Streaming + Tool Calls
- [ ] Streaming for all SDKs (streamText, streamObject, streaming OpenAI/Anthropic/Gemini)
- [ ] Tool-call argument validation for all SDKs
- [ ] Async support (Python): proxy works with both sync and async clients
---

## Development Conventions

- **Python**: `pyproject.toml` with optional dependency groups. Core has zero external deps.
- **TypeScript**: Separate npm packages with peer dependencies. Built with tsdown (ESM-only).
- **Testing**: pytest (Python), bun test (TypeScript). Mock-based for proxy tests.
- **Return type preservation**: Proxy ALWAYS returns the real SDK response object.
- **Zero overhead on passthrough**: No schema detected → literal passthrough.
- **Violation messages must be actionable**: "Invalid JSON at line 3, col 12: expecting comma" not "Invalid JSON."
