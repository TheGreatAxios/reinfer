/**
 * Benchmark report generator.
 * Reads stored JSON-lines files and produces a rich summary.
 *
 * Usage:
 *   bun run src/report.ts [--json]
 */

import { readFileSync, readdirSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AttemptLog, ScenarioResult } from './logger'

const RESULTS_DIR = join(import.meta.dir, '..', 'results')

function findAllLogs(): Map<string, AttemptLog[]> {
  const logs = new Map<string, AttemptLog[]>()
  if (!existsSync(RESULTS_DIR)) return logs

  const files = readdirSync(RESULTS_DIR).filter(f => f.endsWith('.jsonl'))
  for (const file of files) {
    const scenario = file.replace('.jsonl', '')
    const content = readFileSync(join(RESULTS_DIR, file), 'utf-8')
    const attempts = content.trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as AttemptLog)
    logs.set(scenario, attempts)
  }
  return logs
}

function buildResults(logs: Map<string, AttemptLog[]>): ScenarioResult[] {
  const results: ScenarioResult[] = []
  for (const [scenario, attempts] of logs) {
    const lastAttempt = attempts[attempts.length - 1]
    const passed = lastAttempt?.schemaPassed ?? false
    results.push({
      scenario,
      model: attempts[0]?.model ?? 'unknown',
      passed,
      totalAttempts: attempts.length,
      totalLatencyMs: attempts.reduce((s, a) => s + a.latencyMs, 0),
      attempts,
    })
  }
  return results
}

function generateReport(results: ScenarioResult[]): void {
  const total = results.length
  const passed = results.filter(r => r.passed).length
  const passRate = (passed / total * 100).toFixed(1)
  const avgLatency = Math.round(results.reduce((s, r) => s + r.totalLatencyMs, 0) / total)
  const totalRetries = results.reduce((s, r) => s + r.totalAttempts - 1, 0)
  const totalApiCalls = results.reduce((s, r) => s + r.attempts.length, 0)

  // Auto-fix stats
  const allAttempts = results.flatMap(r => r.attempts)
  const withAutoFix = allAttempts.filter(a => a.autoFixes.length > 0)
  const autoFixSuccesses = withAutoFix.filter(a => a.schemaPassed)
  const autoFixRate = withAutoFix.length > 0 ? (autoFixSuccesses.length / withAutoFix.length * 100).toFixed(1) : 'N/A'

  // Violation distribution
  const violationCounts = new Map<string, number>()
  for (const a of allAttempts) {
    for (const v of a.violations) {
      const key = v.split(':')[0] // first segment before colon
      violationCounts.set(key, (violationCounts.get(key) ?? 0) + 1)
    }
  }
  const topViolations = [...violationCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)

  // Truncation stats
  const truncated = allAttempts.filter(a => a.truncated)
  const apiErrors = allAttempts.filter(a => a.error)

  // Model breakdown
  const modelResults = new Map<string, ScenarioResult[]>()
  for (const r of results) {
    const list = modelResults.get(r.model) ?? []
    list.push(r)
    modelResults.set(r.model, list)
  }

  console.log()
  console.log('═'.repeat(80))
  console.log('  reinfer Benchmark Report')
  console.log(`  Generated: ${new Date().toISOString()}`)
  console.log('═'.repeat(80))
  console.log()
  console.log('  OVERALL')
  console.log('  ' + '─'.repeat(40))
  console.log(`  Scenarios:             ${total}`)
  console.log(`  Passed:                ${passed}/${total} (${passRate}%)`)
  console.log(`  Total API calls:       ${totalApiCalls}`)
  console.log(`  Total retries:         ${totalRetries}`)
  console.log(`  Avg total latency:     ${avgLatency}ms`)
  console.log(`  Auto-fix applied:      ${withAutoFix.length} attempts`)
  console.log(`  Auto-fix success rate: ${autoFixRate}%`)
  console.log(`  Truncations:           ${truncated.length}`)
  console.log(`  API errors:            ${apiErrors.length}`)
  console.log()

  // Model breakdown
  console.log('  BY MODEL')
  console.log('  ' + '─'.repeat(40))
  for (const [model, mResults] of modelResults) {
    const mPassed = mResults.filter(r => r.passed).length
    const mPassRate = (mPassed / mResults.length * 100).toFixed(1)
    const mAvgLat = Math.round(mResults.reduce((s, r) => s + r.totalLatencyMs, 0) / mResults.length)
    const mRetries = mResults.reduce((s, r) => s + r.totalAttempts - 1, 0)
    console.log(`  ${model}`)
    console.log(`    Pass rate:  ${mPassRate}% (${mPassed}/${mResults.length})`)
    console.log(`    Avg time:   ${mAvgLat}ms`)
    console.log(`    Retries:    ${mRetries}`)
  }
  console.log()

  // Top violations
  if (topViolations.length > 0) {
    console.log('  TOP VIOLATIONS')
    console.log('  ' + '─'.repeat(40))
    for (const [violation, count] of topViolations) {
      console.log(`  ${count.toString().padStart(3)}x  ${violation}`)
    }
    console.log()
  }

  // Per-scenario detail
  console.log('  PER SCENARIO')
  console.log('  ' + '─'.repeat(80))
  const sorted = [...results].sort((a, b) => Number(a.passed) - Number(b.passed))
  for (const r of sorted) {
    const icon = r.passed ? '✅' : '❌'
    const retries = r.totalAttempts - 1
    const retryStr = retries > 0 ? ` (${retries} retr${retries > 1 ? 'ies' : 'y'})` : ''
    const autoFixCount = r.attempts.filter(a => a.autoFixes.length > 0).length
    const autoFixStr = autoFixCount > 0 ? ` [${autoFixCount} auto-fix]` : ''
    console.log(`  ${icon} ${r.scenario.padEnd(30)} ${r.totalLatencyMs.toString().padStart(6)}ms${retryStr}${autoFixStr}`)
  }
  console.log()

  // Last-run details for failures
  const failures = results.filter(r => !r.passed)
  if (failures.length > 0) {
    console.log('  FAILURE DETAILS')
    console.log('  ' + '─'.repeat(80))
    for (const f of failures) {
      const last = f.attempts[f.attempts.length - 1]
      console.log(`  ${f.scenario} (${f.model}):`)
      console.log(`    Last attempt: ${last.attemptNumber}/${f.totalAttempts}`)
      if (last.error) console.log(`    Error: ${last.error.slice(0, 200)}`)
      if (last.violations.length > 0) {
        console.log(`    Violations: ${last.violations.slice(0, 3).join('; ')}`)
      }
      if (last.rawResponse) {
        console.log(`    Raw: ${last.rawResponse.slice(0, 150)}...`)
      }
      console.log()
    }
  }
}

// ── Main ──

function main() {
  const logs = findAllLogs()
  if (logs.size === 0) {
    console.log('No results found. Run `bun run src/index.ts` first.')
    process.exit(0)
  }

  const results = buildResults(logs)

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 2))
    writeFileSync(join(RESULTS_DIR, 'full-report.json'), JSON.stringify(results, null, 2))
    console.log(`Full report written to ${join(RESULTS_DIR, 'full-report.json')}`)
  } else {
    generateReport(results)
  }
}

main()
