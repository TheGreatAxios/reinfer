# reinfer — TypeScript

> **reinfer** (re-infer): A transparent validation layer for LLM inference clients. One line to wrap. Zero lines to change downstream.

LLMs produce malformed structured output **15–30% of the time**. Self-critique doesn't fix it (the [ReFlect paper](https://arxiv.org/abs/2310.11511) found a **76–98% false-positive rate** on self-verification). The fix is **external, deterministic validation + retry-as-code** — no LLM-as-judge, no circular reasoning.

reinfer implements that fix. Each package knows its SDK's edge cases, extracts raw output from errors, auto-fixes mechanical failures, builds precise retry feedback, and re-submits to the model with a clear **"that is wrong"** signal.

---

## How It Works

```
model output ──→ extract ──→ auto-fix ──→ schema check ──→ passed? ──✅ return
                                    │                        │
                                    │                        ❌
                                    │                        ↓
                                    │               buildRetryFeedback()
                                    │               "Your previous response
                                    │                had validation errors:
                                    │                 • [field_types] 'age'
                                    │                   must be number,
                                    │                   got 'string'"
                                    │                        │
                                    │                        ↓
                                    │               append to prompt →
                                    │               re-submit to model
                                    │                        │
                                    └─────── retry ──────────┘
```

### Three stages of defense

| Stage | What | Deterministic? |
|-------|------|:---:|
| **① Auto-fix** | Strip `<think>` tags, markdown fences, prose wrapping. Fix trailing commas, single quotes, unquoted keys, missing braces. Optional YAML→JSON. | ✅ No model needed. Pure regex. |
| **② Schema validation** | Run typed checks against the output. Zod schemas, JSON Schema, or custom `Check[]`. | ✅ Pure logic. No LLM. |
| **③ Retry with feedback** | Format violations into a prompt augmentation and re-submit to the model. Clear "that is wrong" signal, not "maybe try again?" | ✅ Template-based. No LLM-as-judge. |

---

## Quick Start

```bash
bun install
bun run test         # 81+ tests, all pass
bun run build        # tsdown → ESM bundles
```

## Usage

### With the Vercel AI SDK (recommended)

```ts
import { reinfer } from 'reinfer-ai-sdk'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

const { generateObject } = reinfer({
  maxAttempts: 3,
  onValidationFailure: (f) => console.log('🔥 Retry needed:', f.violations),
})

const result = await generateObject({
  model: openai('gpt-4o'),
  schema: z.object({ name: z.string(), age: z.number() }),
  prompt: 'Generate a person object with name and age.',
})
// If the model returns {"name":"Alice","age":"thirty"}:
//   ▶ Zod throws TypeValidationError
//   ▶ autoFixJson() can't fix it (valid JSON, wrong types)
//   ▶ buildRetryPrompt() augments the prompt with:
//       "Your previous response failed validation:
//        Expected number, received string at 'age'
//        Please fix the issues and respond with valid output..."
//   ▶ Retry with augmented prompt → model returns {"name":"Alice","age":30}
//   ▶ Passes validation → returned to caller
```

### With custom validation checks

```ts
import { reinfer } from 'reinfer-ai-sdk'
import { Schema, validJson, requiredFields, fieldTypes } from 'reinfer'

const personSchema = new Schema({
  name: 'person',
  checks: [
    validJson,
    requiredFields(['name', 'age']),
    fieldTypes({ name: 'string', age: 'number' }),
  ],
  failFast: true,
})

const { generateText } = reinfer({
  schemas: { default: personSchema },
  maxAttempts: 3,
})

const result = await generateText({
  model: openai('gpt-4o'),
  prompt: 'Return JSON: name and age.',
})
```

---

## Anatomy of a Retry: The "That Is Wrong" Signal

This is the core design. When validation fails, reinfer does **not** ask the model "does this look right?" — it tells the model **what** was wrong, **where**, and **what was expected**.

### Step-by-step trace

Let's walk through a real retry. The user calls:

```ts
const { generateObject } = reinfer({ maxAttempts: 3 })
const result = await generateObject({
  model: openai('gpt-4o'),
  schema: z.object({ name: z.string(), age: z.number() }),
  prompt: 'Generate a person.',
})
```

#### Attempt 1 — Model returns:

```json
{"name":"Alice","age":"thirty"}
```

`age` is a string `"thirty"`. The Zod schema expects `z.number()`.

#### ① Inside `wrappedGenerateObject` (proxy.ts)

The AI SDK calls the model, validates against Zod internally, and **throws a `TypeValidationError`** with the raw output attached.

```ts
} catch (err) {
  const action = classifyError(err)          // → 'retry'
  const rawValue = extractRawFromError(err)  // → '{"name":"Alice","age":"thirty"}'
```

#### ② Auto-fix runs (but can't fix types)

```ts
const { fixed } = autoFixJson(rawValue)
// → fixed: '{"name":"Alice","age":"thirty"}'
//   (valid JSON structurally — JSON.parse succeeds.
//    But the *semantic* type error is unfixable by regex.)
```

Then `safeParse` confirms the mismatch:
```
{ success: false, error: ZodError [
    { code: 'invalid_type', expected: 'number', received: 'string', path: ['age'] }
]}
```

#### ③ Build the retry prompt — THE "THAT IS WRONG" SIGNAL

```ts
const feedback = err.message
// → "Validation failed: Expected number, received string at 'age'"

params.prompt = buildRetryPrompt(originalPrompt, feedback)
```

`buildRetryPrompt` (from `packages/core/src/retry.ts`) produces:

```
Generate a person.

Your previous response failed validation:
Validation failed: Expected number, received string at "age"

Please fix the issues and respond with valid output matching the schema.
```

This is the exact prompt sent back to the model for **Attempt 2**.

**Why this works:**
- **Precise**: names the exact field (`age`)
- **Actionable**: says what was expected (`number`) vs what was received (`string`)
- **Imperative**: "Please fix the issues and respond..."
- **Deterministic**: no LLM evaluating LLM output — just the raw Zod violation string
- **Malleable**: the same function works for `requiredFields`, `enumValues`, or any custom check

#### ④ Retry — model corrects itself

The model (now told exactly what it did wrong) returns:

```json
{"name":"Alice","age":30}
```

Zod's `safeParse` passes. `wrappedGenerateObject` returns the result.

#### If the model keeps failing

The retry counter increments. After `maxAttempts` failures, the proxy throws:
```
Error: Failed after 3 attempts
```

---

### The `generateText` feedback path

For `generateText` with custom reinfer schemas, the feedback is even more structured — using `buildRetryFeedback`:

```ts
const feedback = buildRetryFeedback(validation)
// → "Your previous response had validation errors:
//    • [field_types] 'age' must be a number, got 'string'
//    Please fix the issues and respond again."

const newPrompt = buildRetryPrompt(originalPrompt, feedback)
```

The model receives bullet points it can act on:

```
Return JSON: name and age.

Your previous response had validation errors:

• [field_types] 'age' must be a number, got 'string'

Please fix the issues and respond again.
```

---

### Truncation detection

If `finishReason === 'length'`, the proxy sends a lighter retry:

```
Your previous response was truncated (max tokens reached).
Please provide a complete response.
```

No validation overhead — just ask for the full output.

---

## Auto-Fix Pipeline

When the raw response can't be parsed as JSON, `autoFixJson()` runs a 10-stage pipeline of deterministic fixes:

| # | Fix | Example |
|---|-----|---------|
| 1 | Strip `<think>` tags (DeepSeek reasoning traces) | `<think>Let me...<｜end▁of▁thinking｜>...<｜end▁of▁thinking｜>` |
| 2 | Strip markdown fences | ```` ```json...``` ```` |
| 3 | Strip leading prose | `Here is your data: {"a": 1}` |
| 4 | Strip trailing non-JSON text | `{"a": 1} // comment` |
| 5 | Try parsing as-is | `{"a": 1}` → ✅ |
| 6 | Remove trailing commas | `{"a": 1,}` → `{"a": 1}` |
| 7 | Single quotes → double quotes | `{'a': 'b'}` → `{"a": "b"}` |
| 8 | Quote unquoted keys | `{a: "b"}` → `{"a": "b"}` |
| 9 | Combined fix + close braces | `{"a": {"b": 1}` → `{"a": {"b": 1}}` |
| 10 | Close missing braces only | `{"a": "b"` → `{"a": "b"}` |
| *11* | *YAML → JSON (opt-in)* | `name: Alice\nage: 30` → `{"name": "Alice", "age": 30}` |

Each fix reports what it changed via the `fixes[]` array, so you can log or monitor which transformations are being applied in production.

---

## Configuration

```ts
const { generateText, generateObject } = reinfer({
  // ── Retry ──
  maxAttempts: 3,            // How many times to retry on validation failure
  onValidationFailure: (f) => {
    console.log(f.violations) // Log every failure
  },

  // ── Schema detection ──
  autoDetect: true,          // Auto-detect Zod schemas from params
  schemas: {                  // Custom reinfer schemas (for generateText)
    default: mySchema,
  },

  // ── Validation behavior ──
  failFast: true,            // Stop on first check failure
  stripProse: true,          // Extract JSON from prose wrapping

  // ── Escape hatches ──
  escape: 'return_raw',      // What to do when maxAttempts exhausted:
                              // 'return_raw' | 'default' | 'fallback_model'
  onEscape: (e) => {
    console.log('⚠️  Escape used:', e.strategy)
  },
})
```

---

## The "No LLM-as-Judge" Design Principle

The ReFlect paper demonstrates that asking an LLM to verify its own output has a **76–98% false-positive rate** — it says "looks great" even when the output is wrong.

Every check in reinfer is **deterministic**:

| Check | What it does | LLM involved? |
|-------|-------------|:---:|
| `validJson` | `JSON.parse()` | ❌ |
| `requiredFields` | `Object.hasOwn()` | ❌ |
| `fieldTypes` | `typeof` + `instanceof` | ❌ |
| `enumValues` | `Set.has()` | ❌ |
| Zod schema | `safeParse()` | ❌ |
| `autoFixJson` | Regex + character counting | ❌ |
| `buildRetryFeedback` | Template literal | ❌ |

The only API call is the **inference call itself** — validation and retry sit entirely in a deterministic layer between your code and the model.

---

## Packages

| Package | Description |
|---------|-------------|
| `reinfer` | Validation engine, auto-fix, schemas, retry builders (**zero deps**) |
| `reinfer-ai-sdk` | Vercel AI SDK proxy — wraps `generateText()`, `generateObject()` |

---

## Benchmarks

```bash
# Run 13+ real-model scenarios against OpenRouter
OPENROUTER_API_KEY=sk-or-v1-... bun run bench:simple

# Generate a report from stored results
bun run bench:report
```

Benchmarks test common failure modes: simple objects, nested objects, arrays, enum fields, boolean+number mixes, optional fields, empty objects, and prose-wrapped responses.

---

## Philosophy

> "Don't ask the model to audit itself — give it clear, deterministic feedback and let it fix the output."

reinfer is built on this principle. The retry feedback is not polite, not fuzzy, not "hmm, this looks a bit off." It is:

- **"Your previous response had validation errors"** — direct
- **"• [field_types] 'age' must be a number, got 'string'"** — specific
- **"Please fix the issues and respond again."** — imperative

That's the "that is wrong" signal. It works because the model gets a clear error message it can actually act on — the same kind of feedback a developer gets from a type checker.

---

See [AGENTS.md](./AGENTS.md) for full architecture, development roadmap, and build order.
