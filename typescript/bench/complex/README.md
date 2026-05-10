# bench-complex: Validation Harness Prover

Proves the validation harness works by running realistic model outputs through 6 validation configurations and comparing results.

## Key Question

Does auto-fix + retry-with-diagnostics actually save API calls?

## How It Works

1. **Call the model once** per scenario (9 scenarios, 1 API call each)
2. **Replay the raw response** through all 6 configs (zero additional API calls)
3. **Compare** which config saved the most API calls

## Configs Tested

| Config | Auto-Fix | Prose Strip | Max Attempts | Fail Fast |
|--------|----------|-------------|--------------|-----------|
| baseline | ❌ | ❌ | 1 | ❌ |
| autofix-only | ✅ | ❌ | 1 | ❌ |
| retry-only | ❌ | ❌ | 3 | ❌ |
| full-stack | ✅ | ✅ | 3 | ❌ |
| fast-fail | ✅ | ✅ | 3 | ✅ |
| max-retries | ✅ | ✅ | 5 | ❌ |

## Scenarios

| Scenario | What it tests |
|----------|--------------|
| `large-profile-missing-fields` | Model misses 1-3 of 15 required fields |
| `product-catalog-typed` | String vs boolean/null type errors |
| `prose-wrapped-json` | JSON embedded in natural language |
| `syntax-edge-cases` | Trailing commas, single quotes, unquoted keys |
| `deeply-nested-config` | 4-level nesting depth drift |
| `mixed-types-strict` | Type strictness (null, boolean, number) |
| `enum-exact-values` | 8 enum fields, case-sensitive |
| `long-list-truncation` | 10-item array truncation |
| `reasoning-then-json` | `<reasoning>` tags before JSON (DeepSeek-style) |

## Key Findings (Initial Run)

- **Auto-fix saves API calls**: `reasoning-then-json` failed baseline (❌) but passed autofix-only (✅). Auto-fix stripped `<reasoning>` tags and extracted valid JSON.
- **Harness correctly rejects semantic mismatches**: `prose-wrapped-json` failed all configs because the model embedded data inline in prose (no extractable JSON structure). This is the correct boundary — the harness handles syntax, not semantics.
- **First-pass rate improves with auto-fix**: baseline 2/4 → autofix-only 3/4 (25% improvement).
- **Nemotron produces clean JSON**: Simple and moderately complex requests pass on first try. Failures occur on non-standard formats (prose, reasoning tags).
