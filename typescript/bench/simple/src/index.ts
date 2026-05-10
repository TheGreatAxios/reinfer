/**
 * reinfer Benchmark Runner
 *
 * Calls real models via OpenRouter, runs every response through the
 * validation pipeline (auto-fix → schema check → retry), logs everything.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-... bun run src/index.ts
 *
 * Optional env vars:
 *   OPENROUTER_BASE_URL  — default: https://openrouter.ai/api/v1
 *   MAX_ATTEMPTS         — default: 3
 *   SCENARIO_FILTER      — regex to filter scenarios by name
 */

import { readFileSync } from 'fs'
import type { AttemptLog, ScenarioResult } from './logger'
import { SCENARIOS, type Scenario } from './scenarios'
import { logAttempt, writeSummary } from './logger'
import { autoFixJson, validate, Schema } from 'reinfer'

// ── Config ──

const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'
const API_KEY = process.env.OPENROUTER_API_KEY
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? '3')
const SCENARIO_FILTER = process.env.SCENARIO_FILTER ? new RegExp(process.env.SCENARIO_FILTER) : null

if (!API_KEY) {
  console.error('❌ OPENROUTER_API_KEY environment variable is required')
  console.error('   Get one at https://openrouter.ai/keys')
  process.exit(1)
}

// ── OpenRouter API call ──

interface OpenRouterMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface OpenRouterResponse {
  id: string
  choices: Array<{
    message: { content: string | null }
    finish_reason: string
  }>
  usage: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
  error?: { message: string }
}

async function callOpenRouter(
  model: string,
  systemPrompt: string,
  userPrompt: string,
): Promise<{ text: string; finishReason: string; latencyMs: number; raw: OpenRouterResponse }> {
  const start = performance.now()

  const messages: OpenRouterMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/thegreataxios/reinfer',
      'X-Title': 'reinfer-bench',
    },
    body: JSON.stringify({
      model,
      messages,
      temperature: 0.7,
      max_tokens: 500,
    }),
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`OpenRouter API error (${response.status}): ${body}`)
  }

  const data = (await response.json()) as OpenRouterResponse
  const latencyMs = Math.round(performance.now() - start)

  if (data.error) {
    throw new Error(`OpenRouter API error: ${data.error.message}`)
  }

  const choice = data.choices[0]
  return {
    text: choice.message.content ?? '',
    finishReason: choice.finish_reason,
    latencyMs,
    raw: data,
  }
}

// ── Scenario runner ──

function buildSchemaChecks(schema: import('zod').ZodSchema): { name: string; run: (s: string) => Promise<{ checkName: string; passed: boolean; message?: string }> }[] {
  return [
    {
      name: 'valid_json',
      run: async (value: string) => {
        try {
          const parsed = JSON.parse(value)
          // Try Zod validation
          const result = await (schema as any).safeParseAsync(parsed)
          if (result.success) {
            return { checkName: 'zod_schema', passed: true }
          }
          const issues = result.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('; ')
          return { checkName: 'zod_schema', passed: false, message: issues }
        } catch (err) {
          return { checkName: 'valid_json', passed: false, message: err instanceof Error ? err.message : 'Invalid JSON' }
        }
      },
    },
  ]
}

function buildRetryPrompt(originalUserPrompt: string, userPrompt: string, violations: string[]): string {
  return `Your previous response had validation errors:\n${violations.map(v => `• ${v}`).join('\n')}\n\nPlease correct the response to match the required schema. Return ONLY valid JSON.`
}

async function runScenario(scenario: Scenario): Promise<ScenarioResult> {
  const schema = new Schema({
    name: scenario.name,
    checks: buildSchemaChecks(scenario.schema),
    failFast: false,
  })

  const attempts: AttemptLog[] = []
  let currentUserPrompt = scenario.userPrompt
  let passed = false
  let totalLatencyMs = 0

  for (let attemptNumber = 1; attemptNumber <= MAX_ATTEMPTS; attemptNumber++) {
    let attempt: AttemptLog

    try {
      // ── API call ──
      const { text, finishReason, latencyMs } = await callOpenRouter(
        scenario.model,
        scenario.systemPrompt,
        currentUserPrompt,
      )

      totalLatencyMs += latencyMs
      const truncated = finishReason === 'length'

      // ── Apply auto-fix ──
      const { fixed, fixes } = autoFixJson(text)

      // ── Extract string and validate ──
      const valueToValidate = fixed ?? text

      const validation = await validate(valueToValidate, schema, attemptNumber)
      const schemaPassed = validation.passed

      attempt = {
        timestamp: new Date().toISOString(),
        scenario: scenario.name,
        model: scenario.model,
        attemptNumber,
        totalAttempts: 0, // set after loop
        passed: schemaPassed,
        latencyMs,
        rawResponse: text,
        autoFixedResponse: fixed ?? undefined,
        autoFixes: fixes,
        schemaPassed,
        violations: validation.violations.map(v => v.message ?? v.checkName),
        truncated,
      }

      if (schemaPassed) {
        passed = true
        attempt.totalAttempts = attemptNumber
        attempts.push(attempt)
        logAttempt(attempt)
        break // success!
      }

      // ── Retry with feedback ──
      if (attemptNumber < MAX_ATTEMPTS) {
        currentUserPrompt = buildRetryPrompt(scenario.userPrompt, currentUserPrompt, attempt.violations)
      }

      attempts.push(attempt)
      logAttempt(attempt)
    } catch (err) {
      attempt = {
        timestamp: new Date().toISOString(),
        scenario: scenario.name,
        model: scenario.model,
        attemptNumber,
        totalAttempts: attemptNumber,
        passed: false,
        latencyMs: 0,
        rawResponse: '',
        autoFixes: [],
        schemaPassed: false,
        violations: [],
        truncated: false,
        error: err instanceof Error ? err.message : String(err),
      }
      attempts.push(attempt)
      logAttempt(attempt)
      break // API errors don't get retried
    }
  }

  // Fill totalAttempts for all attempts
  for (const a of attempts) {
    a.totalAttempts = attempts.length
  }

  return {
    scenario: scenario.name,
    model: scenario.model,
    passed,
    totalAttempts: attempts.length,
    totalLatencyMs,
    attempts,
  }
}

// ── Main ──

async function main() {
  console.log('═'.repeat(80))
  console.log('  reinfer Benchmark Runner')
  console.log(`  OpenRouter: ${OPENROUTER_BASE_URL}`)
  console.log(`  Max attempts: ${MAX_ATTEMPTS}`)
  console.log('═'.repeat(80))
  console.log()

  const scenarios = SCENARIO_FILTER
    ? SCENARIOS.filter(s => SCENARIO_FILTER.test(s.name))
    : SCENARIOS

  console.log(`Running ${scenarios.length} scenarios across ${new Set(scenarios.map(s => s.model)).size} models...\n`)

  const results: ScenarioResult[] = []

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]
    console.log(`[${i + 1}/${scenarios.length}] ${scenario.name} (${scenario.model})...`)

    const result = await runScenario(scenario)
    results.push(result)

    const icon = result.passed ? '✅' : '❌'
    const retries = result.totalAttempts - 1
    const retryStr = retries > 0 ? ` (${retries} retr${retries > 1 ? 'ies' : 'y'})` : ''
    console.log(`  ${icon} ${result.totalLatencyMs}ms${retryStr}`)
  }

  writeSummary(results)
  console.log('Done.')
}

main().catch(err => {
  console.error('Fatal:', err)
  process.exit(1)
})
