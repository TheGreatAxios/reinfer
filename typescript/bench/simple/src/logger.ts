import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'

/**
 * Every single attempt — whether raw API call or validation retry — is logged here.
 * One JSON line per attempt, append-only. Lossless.
 */

export interface AttemptLog {
  /** ISO timestamp */
  timestamp: string
  /** Scenario name */
  scenario: string
  /** Model used */
  model: string
  /** Which attempt number (1 = original, 2+ = retries) */
  attemptNumber: number
  /** Whether this was a success */
  passed: boolean
  /** Total attempts for this scenario (1 if no retry) */
  totalAttempts: number
  /** Latency of this single API call in ms */
  latencyMs: number
  /** Full raw text from the model */
  rawResponse: string
  /** The auto-fixed version (if auto-fix was applied) */
  autoFixedResponse?: string
  /** Auto-fixes that were applied */
  autoFixes: string[]
  /** Whether the final result passed schema validation */
  schemaPassed: boolean
  /** Schema violations (if any) */
  violations: string[]
  /** Whether this was a truncation */
  truncated: boolean
  /** Error message if API call failed */
  error?: string
}

export interface ScenarioResult {
  /** Aggregated results for one scenario run */
  scenario: string
  model: string
  passed: boolean
  totalAttempts: number
  totalLatencyMs: number
  attempts: AttemptLog[]
}

const RESULTS_DIR = join(import.meta.dir, '..', 'results')

export function ensureResultsDir(): void {
  if (!existsSync(RESULTS_DIR)) {
    mkdirSync(RESULTS_DIR, { recursive: true })
  }
}

/** Append one attempt to the per-scenario log file. */
export function logAttempt(attempt: AttemptLog): void {
  ensureResultsDir()
  const filePath = join(RESULTS_DIR, `${attempt.scenario}.jsonl`)
  appendFileSync(filePath, JSON.stringify(attempt) + '\n', 'utf-8')
}

/** Write a summary file with aggregated results. */
export function writeSummary(results: ScenarioResult[]): void {
  ensureResultsDir()
  const filePath = join(RESULTS_DIR, 'summary.json')
  writeFileSync(filePath, JSON.stringify(results, null, 2), 'utf-8')
  console.log(`\n📊 Summary written to ${filePath}`)

  // Also print a table
  const passRate = results.filter(r => r.passed).length / results.length * 100
  const avgLatency = results.reduce((s, r) => s + r.totalLatencyMs, 0) / results.length
  const totalRetries = results.reduce((s, r) => s + r.totalAttempts - 1, 0)

  console.log('\n' + '─'.repeat(80))
  console.log('  BENCHMARK RESULTS'.padEnd(40))
  console.log('─'.repeat(80))
  console.log(`  Total scenarios:  ${results.length}`)
  console.log(`  Pass rate:        ${passRate.toFixed(1)}%`)
  console.log(`  Avg latency:      ${avgLatency.toFixed(0)}ms`)
  console.log(`  Total retries:    ${totalRetries}`)
  console.log('─'.repeat(80))
  console.log()
  console.log('  Per-scenario breakdown:')
  console.log()

  // Sort by pass/fail for readability
  const sorted = [...results].sort((a, b) => Number(a.passed) - Number(b.passed))
  for (const r of sorted) {
    const icon = r.passed ? '✅' : '❌'
    const retries = r.totalAttempts - 1
    const retryStr = retries > 0 ? ` (${retries} retr${retries > 1 ? 'ies' : 'y'})` : ''
    console.log(`  ${icon} ${r.scenario.padEnd(30)} ${r.totalLatencyMs.toString().padStart(6)}ms${retryStr}`)
  }
  console.log()
}

/** Read existing results for a scenario. */
export function readAttempts(scenario: string): AttemptLog[] {
  const filePath = join(RESULTS_DIR, `${scenario}.jsonl`)
  if (!existsSync(filePath)) return []
  return readFileSync(filePath, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}
