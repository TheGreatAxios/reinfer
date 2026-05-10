import { writeFileSync, appendFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'

/**
 * Every single attempt — whether raw API call or validation retry — is logged here.
 * One JSON line per attempt, append-only. Lossless.
 * Files are dated so you can track changes over time.
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
  scenario: string
  model: string
  passed: boolean
  totalAttempts: number
  totalLatencyMs: number
  attempts: AttemptLog[]
}

// ── Stable run ID for this execution ──

const RUN_ID = new Date().toISOString().replace(/:/g, '-').split('.')[0]
const RESULTS_DIR = join(import.meta.dir, '..', 'results')

function ensureDir(): void {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
}

/** Dated filename for a scenario's raw data. */
function dataFile(scenario: string): string {
  return join(RESULTS_DIR, `${scenario}-${RUN_ID}.jsonl`)
}

/** Dated filename for a scenario's human-readable report. */
function mdFile(scenario: string): string {
  return join(RESULTS_DIR, `${scenario}-${RUN_ID}.md`)
}

/** Dated filename for the full run summary. */
function summaryFile(): string {
  return join(RESULTS_DIR, `summary-${RUN_ID}.json`)
}

/** Dated filename for the overall report. */
function reportFile(): string {
  return join(RESULTS_DIR, `report-${RUN_ID}.md`)
}

// ── Logging ──

/** Append one attempt to the dated per-scenario JSONL file. */
export function logAttempt(attempt: AttemptLog): void {
  ensureDir()
  appendFileSync(dataFile(attempt.scenario), JSON.stringify(attempt) + '\n', 'utf-8')
}

/** Write summary JSON and the human-readable .md report. */
export function writeSummary(results: ScenarioResult[]): void {
  ensureDir()

  // Write JSON summary
  const jsonPath = summaryFile()
  writeFileSync(jsonPath, JSON.stringify(results, null, 2), 'utf-8')
  console.log(`\n📊 Summary written to ${jsonPath}`)

  // Write .md report
  const mdPath = reportFile()
  const passRate = results.filter(r => r.passed).length / results.length * 100
  const avgLatency = Math.round(results.reduce((s, r) => s + r.totalLatencyMs, 0) / results.length)
  const totalRetries = results.reduce((s, r) => s + r.totalAttempts - 1, 0)

  const lines: string[] = []
  lines.push(`# Benchmark Report — ${RUN_ID}`)
  lines.push(``)
  lines.push(`| Metric | Value |`)
  lines.push(`|--------|-------|`)
  lines.push(`| Scenarios | ${results.length} |`)
  lines.push(`| Pass rate | ${passRate.toFixed(1)}% |`)
  lines.push(`| Avg latency | ${avgLatency}ms |`)
  lines.push(`| Total retries | ${totalRetries} |`)
  lines.push(`| Run ID | ${RUN_ID} |`)
  lines.push(``)
  lines.push(`## Per-Scenario`)
  lines.push(``)
  lines.push(`| Scenario | Result | Latency | Retries | Auto-fixes |`)
  lines.push(`|----------|--------|---------|---------|------------|`)

  const sorted = [...results].sort((a, b) => Number(a.passed) - Number(b.passed))
  for (const r of sorted) {
    const icon = r.passed ? '✅' : '❌'
    const retries = r.totalAttempts - 1
    const autoFixCount = r.attempts.filter(a => a.autoFixes.length > 0).length
    lines.push(`| ${r.scenario} | ${icon} | ${r.totalLatencyMs}ms | ${retries} | ${autoFixCount} |`)
  }
  lines.push(``)

  // Write per-scenario .md files too
  for (const r of results) {
    const scenarioLines: string[] = []
    scenarioLines.push(`# ${r.scenario} — ${r.passed ? '✅ PASS' : '❌ FAIL'}`)
    scenarioLines.push(``)
    scenarioLines.push(`Run: ${RUN_ID}  |  Model: ${r.model}  |  Total: ${r.totalLatencyMs}ms  |  Attempts: ${r.totalAttempts}`)
    scenarioLines.push(``)
    scenarioLines.push(`## Attempts`)
    scenarioLines.push(``)
    for (const a of r.attempts) {
      scenarioLines.push(`### Attempt ${a.attemptNumber} (${a.latencyMs}ms)`)
      scenarioLines.push(``)
      scenarioLines.push(`- **Passed**: ${a.schemaPassed ? '✅' : '❌'}`)
      scenarioLines.push(`- **Truncated**: ${a.truncated ? '⚠️' : 'No'}`)
      scenarioLines.push(`- **Auto-fixes**: ${a.autoFixes.length > 0 ? a.autoFixes.join(', ') : 'None'}`)
      if (a.violations.length > 0) {
        scenarioLines.push(`- **Violations**:`)
        for (const v of a.violations) scenarioLines.push(`  - ${v}`)
      }
      scenarioLines.push(``)
      scenarioLines.push('```json')
      scenarioLines.push(a.rawResponse.slice(0, 500))
      scenarioLines.push('```')
      scenarioLines.push(``)
    }
    writeFileSync(mdFile(r.scenario), scenarioLines.join('\n'), 'utf-8')
  }

  writeFileSync(mdPath, lines.join('\n'), 'utf-8')
  console.log(`📝 Report written to ${mdPath}`)

  // Also print the existing console table
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
  for (const r of sorted) {
    const icon = r.passed ? '✅' : '❌'
    const retries = r.totalAttempts - 1
    const retryStr = retries > 0 ? ` (${retries} retr${retries > 1 ? 'ies' : 'y'})` : ''
    console.log(`  ${icon} ${r.scenario.padEnd(30)} ${r.totalLatencyMs.toString().padStart(6)}ms${retryStr}`)
  }
  console.log()
}
