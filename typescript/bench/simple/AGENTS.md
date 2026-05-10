# bench-simple — Benchmark Runner

Real API benchmark that tests the validation pipeline against actual model outputs via OpenRouter.

## How It Works

1. Sends a prompt to a model on OpenRouter
2. Receives the model's response
3. Runs it through the full validation pipeline: `autoFixJson()` → `validate()` against Zod schema
4. If validation fails, retries with specific violation feedback (up to `MAX_ATTEMPTS`, default 3)
5. Logs every attempt to a JSON-lines file in `results/`
6. Generates a summary report

## Scenarios (11 total)

All target `nvidia/nemotron-3-super-120b-a12b:free` (free model on OpenRouter).

| Scenario | Tests |
|----------|-------|
| `simple-object` | `{ city: string, temperature: number }` |
| `nested-object` | `{ user: { name, address: { street, zip } } }` |
| `deeply-nested` | 3 levels of nesting |
| `simple-array` | Array of product objects |
| `array-of-strings` | Array with length constraint |
| `enum-field` | Enum validation |
| `boolean-and-number` | Mixed type correctness |
| `optional-fields` | Nullable and optional fields |
| `empty-object` | Strict empty object |
| `prose-wrapped` | JSON extracted from natural language (hardest) |
| `numeric-strings` | Mixed string/number types |

## Output

Each scenario writes a `.jsonl` file to `results/`. Each line is a single attempt with:
- `rawResponse`: exact model output
- `autoFixedResponse`: after auto-fix
- `autoFixes`: which fixes were applied
- `schemaPassed`: validation result
- `violations`: specific violations
- `latencyMs`: call duration
- `truncated`: whether output was cut off

A `summary.json` is written after each run with aggregated results.

## Known Limitations

- Streaming not tested (v0.2)
- Tool calls not tested
- Only tests deterministic validation pipeline, not full SDK proxy integration
