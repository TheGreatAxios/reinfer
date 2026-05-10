/**
 * Retry Mode: A/B comparison of retry strategies.
 *
 * For each scenario that fails validation, this makes REAL API calls
 * for the retry attempts, comparing two strategies:
 *
 * STRATEGY A: Naive retry — "Your response was invalid, please fix it"
 * STRATEGY B: Diagnostic retry — "Missing field 'city', wrong type for 'age'"
 *
 * Captures actual token usage, latency, finish reasons from real API responses.
 *
 * Usage:
 *   bun run --env-file .env src/retry-mode.ts
 *   SCENARIO_FILTER=prose bun run --env-file .env src/retry-mode.ts
 */

import { SCENARIOS } from './scenarios'
import { autoFixJson, extractString } from '@inferred-validation/core'

const API_KEY = process.env.OPENROUTER_API_KEY
const BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'
const MODEL = process.env.MODEL ?? 'nvidia/nemotron-3-super-120b-a12b:free'
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? '3')

if (!API_KEY) {
  console.error('❌ OPENROUTER_API_KEY required')
  process.exit(1)
}

// ── Types ──

interface ApiUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  /** Cached input tokens (prompt_tokens_details.cached_tokens) */
  cachedTokens?: number
  /** Reasoning tokens (completion_tokens_details.reasoning_tokens) */
  reasoningTokens?: number
}

interface AttemptRecord {
  attempt: number
  /** Wall-clock time for this API call */
  latencyMs: number
  /** Raw model output text */
  text: string
  /** Finish reason from API */
  finishReason: string
  /** Model that actually served this request */
  model: string
  /** Token usage from API */
  usage: ApiUsage
  /** Whether this attempt passed schema validation */
  passed: boolean
  /** Schema violations (empty if passed) */
  violations: string[]
  /** Auto-fixes applied before validation */
  autoFixes: string[]
  /** Error message if the API call itself failed */
  error?: string
}

interface RetryChainResult {
  scenario: string
  strategy: 'naive' | 'diagnostic'
  /** True if any attempt produced valid output */
  converged: boolean
  /** Total API calls made (1 original + retries) */
  totalCalls: number
  /** Cumulative wall-clock time */
  totalLatencyMs: number
  /** Cumulative token usage */
  totalTokens: number
  /** Cumulative input tokens */
  totalInputTokens: number
  /** Cumulative output tokens */
  totalOutputTokens: number
  /** Cumulative reasoning tokens (if tracked by API) */
  totalReasoningTokens: number
  /** Per-attempt details */
  attempts: AttemptRecord[]
}

// ── API Call ──

async function callModel(
  systemPrompt: string,
  userPrompt: string,
  previousAttempt?: { text: string; violations: string[] },
  strategy?: 'naive' | 'diagnostic',
): Promise<{ text: string; finishReason: string; model: string; usage: ApiUsage; latencyMs: number; error?: string }> {
  const messages: Array<{ role: string; content: string }> = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  if (previousAttempt && strategy) {
    messages.push({ role: 'assistant', content: previousAttempt.text })

    if (strategy === 'naive') {
      messages.push({
        role: 'user',
        content: 'Your previous response was invalid. Please fix it and return valid JSON matching the schema. Only output the JSON object, no explanation.',
      })
    } else {
      const violationList = previousAttempt.violations.map(v => `  • ${v}`).join('\n')
      messages.push({
        role: 'user',
        content: `Your previous response had these validation errors:\n${violationList}\n\nPlease correct these specific issues and return valid JSON. Only output the JSON object, no explanation.`,
      })
    }
  }

  const start = performance.now()

  try {
    const res = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/thegreataxios/inferred-validator',
        'X-Title': 'inferred-validator-retry-bench',
      },
      body: JSON.stringify({ model: MODEL, messages, temperature: 0.7, max_tokens: 2000 }),
    })

    const latencyMs = Math.round(performance.now() - start)

    if (!res.ok) {
      return { text: '', finishReason: 'error', model: MODEL, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, latencyMs, error: `API ${res.status}` }
    }

    const data = await res.json() as any

    return {
      text: data.choices?.[0]?.message?.content ?? '',
      finishReason: data.choices?.[0]?.finish_reason ?? 'stop',
      model: data.model ?? MODEL,
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0,
        totalTokens: data.usage?.total_tokens ?? 0,
        cachedTokens: data.usage?.prompt_tokens_details?.cached_tokens,
        reasoningTokens: data.usage?.completion_tokens_details?.reasoning_tokens,
      },
      latencyMs,
    }
  } catch (err) {
    return { text: '', finishReason: 'error', model: MODEL, usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }, latencyMs: Math.round(performance.now() - start), error: err instanceof Error ? err.message : String(err) }
  }
}

// ── Validation ──

function validateResponse(text: string, schema: import('zod').ZodSchema): { passed: boolean; violations: string[]; autoFixes: string[] } {
  if (!text) return { passed: false, violations: ['Empty response'], autoFixes: [] }

  const { fixed, fixes } = autoFixJson(text)
  const toValidate = fixed ?? text
  const extracted = extractString(toValidate, true)

  try {
    const parsed = JSON.parse(extracted ?? toValidate)
    const result = (schema as any).safeParse(parsed)
    if (result.success) return { passed: true, violations: [], autoFixes: fixes }
    return {
      passed: false,
      violations: result.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`),
      autoFixes: fixes,
    }
  } catch (err) {
    return { passed: false, violations: [err instanceof Error ? err.message : 'Invalid JSON'], autoFixes: fixes }
  }
}

// ── Runner ──

async function runRetryChain(
  scenario: typeof SCENARIOS[0],
  strategy: 'naive' | 'diagnostic',
): Promise<RetryChainResult> {
  const result: RetryChainResult = {
    scenario: scenario.name,
    strategy,
    converged: false,
    totalCalls: 0,
    totalLatencyMs: 0,
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalReasoningTokens: 0,
    attempts: [],
  }

  let lastText = ''
  let lastViolations: string[] = []

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const apiResult = await callModel(
      scenario.systemPrompt,
      scenario.userPrompt,
      attempt > 1 ? { text: lastText, violations: lastViolations } : undefined,
      attempt > 1 ? strategy : undefined,
    )

    const { passed, violations, autoFixes } = validateResponse(apiResult.text, scenario.schema)

    const record: AttemptRecord = {
      attempt,
      latencyMs: apiResult.latencyMs,
      text: apiResult.text.slice(0, 300), // truncate for readability
      finishReason: apiResult.finishReason,
      model: apiResult.model,
      usage: apiResult.usage,
      passed,
      violations,
      autoFixes,
      error: apiResult.error,
    }

    result.attempts.push(record)
    result.totalCalls++
    result.totalLatencyMs += apiResult.latencyMs
    result.totalTokens += apiResult.usage.totalTokens
    result.totalInputTokens += apiResult.usage.promptTokens
    result.totalOutputTokens += apiResult.usage.completionTokens
    if (apiResult.usage.reasoningTokens) {
      result.totalReasoningTokens += apiResult.usage.reasoningTokens
    }

    if (passed) {
      result.converged = true
      break
    }

    if (apiResult.error) break // API error — stop retrying

    lastText = apiResult.text
    lastViolations = violations
  }

  return result
}

// ── Report ──

function printReport(results: RetryChainResult[]): void {
  const scenarios = [...new Set(results.map(r => r.scenario))]

  console.log()
  console.log('═'.repeat(90))
  console.log('  RETRY STRATEGY A/B COMPARISON')
  console.log('═'.repeat(90))
  console.log()
  console.log(`  Model: ${MODEL}  |  Max attempts: ${MAX_ATTEMPTS}`)
  console.log()

  for (const s of scenarios) {
    const naive = results.find(r => r.scenario === s && r.strategy === 'naive')
    const diag = results.find(r => r.scenario === s && r.strategy === 'diagnostic')

    console.log(`  ── ${s} ──`)
    console.log()

    for (const r of [naive, diag].filter(Boolean)) {
      if (!r) continue
      const label = r.strategy === 'naive' ? 'NAIVE     ("fix it")' : 'DIAGNOSTIC("missing X")'
      const icon = r.converged ? '✅' : '❌'
      console.log(`  ${icon} ${label}`)
      console.log(`     Calls:     ${r.totalCalls}`)
      console.log(`     Latency:   ${r.totalLatencyMs}ms total  (${r.attempts.map(a => `${a.latencyMs}ms`).join(' → ')})`)
      console.log(`     Tokens:    ${r.totalTokens} total  (${r.totalInputTokens} in / ${r.totalOutputTokens} out${r.totalReasoningTokens ? ` / ${r.totalReasoningTokens} reasoning` : ''})`)
      console.log(`     Finish:    ${r.attempts.map(a => a.finishReason).join(' → ')}`)
      console.log(`     Errors:    ${r.attempts.filter(a => a.error).map(a => a.error).join(', ') || 'none'}`)
      console.log(`     Violations: ${r.attempts.map(a => a.violations.length > 0 ? `${a.violations.length} issues` : '✅').join(' → ')}`)
      console.log()
    }
  }

  // Cross-strategy summary
  console.log('  ── SUMMARY ──')
  console.log()

  for (const strat of ['naive', 'diagnostic'] as const) {
    const chainResults = results.filter(r => r.strategy === strat)
    if (chainResults.length === 0) continue
    const converged = chainResults.filter(r => r.converged).length
    const avgLatency = Math.round(chainResults.reduce((s, r) => s + r.totalLatencyMs, 0) / chainResults.length)
    const avgCalls = chainResults.reduce((s, r) => s + r.totalCalls, 0) / chainResults.length
    const avgTokens = Math.round(chainResults.reduce((s, r) => s + r.totalTokens, 0) / chainResults.length)

    const label = strat === 'naive' ? 'Naive ("fix it")' : 'Diagnostic ("missing X")'
    console.log(`  ${label}:`)
    console.log(`    Converged:  ${converged}/${chainResults.length}`)
    console.log(`    Avg calls:  ${avgCalls.toFixed(1)}`)
    console.log(`    Avg time:   ${avgLatency}ms`)
    console.log(`    Avg tokens: ${avgTokens}`)
  }
  console.log()
}

// ── Main ──

async function main() {
  const filter = process.env.SCENARIO_FILTER ? new RegExp(process.env.SCENARIO_FILTER) : null
  const scenarios = filter
    ? SCENARIOS.filter(s => filter.test(s.name))
    : SCENARIOS.slice(0, 3)

  console.log(`Running ${scenarios.length} scenarios × 2 strategies = ${scenarios.length * 2} retry chains...`)
  console.log()

  const results: RetryChainResult[] = []

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]
    console.log(`[${i + 1}/${scenarios.length}] ${scenario.name}`)

    for (const strategy of ['naive', 'diagnostic'] as const) {
      process.stdout.write(`  ${strategy}... `)
      const result = await runRetryChain(scenario, strategy)
      results.push(result)
      console.log(result.converged ? '✅' : '❌')
    }
  }

  printReport(results)
  console.log('Done.')
}

main().catch(err => { console.error(err); process.exit(1) })
