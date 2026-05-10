# bench-simple

Benchmark runner for reinfer. Tests the validation pipeline against real model outputs via OpenRouter.

## Prerequisites

- OpenRouter API key: set in `typescript/.env` as `OPENROUTER_API_KEY=sk-or-v1-...`

## Run

```bash
# From typescript/ root:
bun run bench:simple

# Or from this directory:
OPENROUTER_API_KEY=sk-or-v1-... bun run src/index.ts

# Filter by scenario name (regex):
SCENARIO_FILTER=array  bun run bench:simple
```

## View Results

```bash
# Generate report from stored results:
bun run bench:report

# Full JSON dump:
bun run bench:report --json

# Raw data (per scenario):
cat results/simple-object.jsonl
```

Results are stored in `results/` — each scenario gets a `.jsonl` file (append-only). Reports read from these files, so you can re-report without re-running.

## Defaults

- Model: `nvidia/nemotron-3-super-120b-a12b:free`
- Max attempts per scenario: 3
- OpenRouter base: `https://openrouter.ai/api/v1`

Override via env vars: `MODEL`, `MAX_ATTEMPTS`, `OPENROUTER_BASE_URL`.

See [AGENTS.md](./AGENTS.md) for scenario details.
