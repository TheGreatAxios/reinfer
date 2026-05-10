/**
 * bench-complex report generator.
 *
 * Reads stored results.jsonl and produces comparison reports.
 *
 * Usage:
 *   bun run src/report.ts
 *   bun run src/report.ts --json
 *   bun run src/report.ts --diff  (compare last two runs)
 */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { CONFIG_MATRIX } from './config-matrix'
import type { ScenarioRecord } from './logger'

const RESULTS_DIR = join(import.meta.dir, '..', 'results')

function loadRecords(): ScenarioRecord[] {
  const path = join(RESULTS_DIR, 'results.jsonl')
  if (!existsSync(path)) return []
  return readFileSync(path, 'utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map(line => JSON.parse(line))
}

function generateReport(records: ScenarioRecord[], format: 'text' | 'json'): void {
  const configNames = CONFIG_MATRIX.map(c => c.name)

  if (format === 'json') {
    console.log(JSON.stringify({ records, configNames }, null, 2))
    return
  }

  const total = records.length
  console.log()
  console.log('═'.repeat(80))
  console.log('  bench-complex Report')
  console.log('═'.repeat(80))
  console.log()

  // ── Config comparison ──
  console.log('  CONFIG PERFORMANCE')
  console.log('  ' + '─'.repeat(70))
  console.log(`  ${'Config'.padEnd(15)} ${'Pass'.padEnd(8)} ${'First Try'.padEnd(12)} ${'Auto-Fix'.padEnd(10)} ${'Avg Retries'.padEnd(12)} ${'API Saved'.padEnd(10)}`)
  console.log('  ' + '─'.repeat(70))

  // baseline is index 0 — compare everything against baseline
  const baseline = CONFIG_MATRIX.find(c => c.name === 'baseline')
  const baselineResults = baseline ? records.map(r => r.configResults.find(c => c.configName === 'baseline')!) : []

  for (const cn of configNames) {
    const results = records.flatMap(r => r.configResults.filter(c => c.configName === cn))
    const total_ = results.length
    const passed = results.filter(r => r.passed).length
    const firstTry = results.filter(r => r.passed && r.retriesNeeded === 0).length
    const autoFixed = results.filter(r => r.autoFixApplied.length > 0).length
    const totalRetries = results.reduce((s, r) => s + r.retriesNeeded, 0)
    const avgRetries = (totalRetries / total_).toFixed(2)

    // API calls saved compared to baseline (baseline = no retries, but also no auto-fix)
    // If baseline fails and this config passes, that's 1 API call that would have been wasted
    const baselineFails = baselineResults.filter((br, i) => !br.passed).length
    const thisFails = results.filter(r => !r.passed).length
    const savedCalls = baselineFails - thisFails

    console.log(
      `  ${cn.padEnd(15)} ` +
      `${`${passed}/${total_}`.padEnd(8)} ` +
      `${`${firstTry}/${total_}`.padEnd(12)} ` +
      `${`${autoFixed}`.padEnd(10)} ` +
      `${avgRetries.padEnd(12)} ` +
      `${savedCalls > 0 ? `+${savedCalls}` : savedCalls}`,
    )
  }
  console.log()

  // ── Scenario detail ──
  console.log('  PER SCENARIO')
  console.log('  ' + '─'.repeat(20 + configNames.length * 18))
  const header = `  ${'Scenario'.padEnd(20)}` + configNames.map(c => c.padEnd(16)).join('')
  console.log(header)
  console.log('  ' + '─'.repeat(20 + configNames.length * 18))

  const sorted = [...records].sort((a, b) => {
    const aPassed = a.configResults.filter(r => r.passed).length
    const bPassed = b.configResults.filter(r => r.passed).length
    return aPassed - bPassed
  })

  for (const r of sorted) {
    const cells = configNames.map(cn => {
      const cr = r.configResults.find(c => c.configName === cn)
      if (!cr) return '  N/A  '.padEnd(16)
      const icon = cr.passed ? (cr.retriesNeeded === 0 ? '✅' : '🔄') : '❌'
      const note = cr.passed && cr.autoFixApplied.length > 0 ? '⚡' : ' '
      return `${icon}${note}${cr.retriesNeeded > 0 ? cr.retriesNeeded : ' '}`.padEnd(16)
    })
    const tags = r.tags.slice(0, 2).join(',')
    console.log(`  ${r.scenario.padEnd(20)}` + cells.join(''))
  }
  console.log()

  // ── Category breakdown ──
  console.log('  BY CATEGORY')
  console.log('  ' + '─'.repeat(70))
  const categories = [...new Set(records.flatMap(r => r.tags))]
  for (const cat of categories) {
    const catRecords = records.filter(r => r.tags.includes(cat))
    console.log(`  ${cat}`)
    for (const cn of configNames) {
      const results = catRecords.flatMap(r => r.configResults.filter(c => c.configName === cn))
      const passed = results.filter(r => r.passed).length
      const pct = (passed / results.length * 100).toFixed(0)
      const retries = results.reduce((s, r) => s + r.retriesNeeded, 0)
      console.log(`    ${cn.padEnd(15)} ${pct}% (${passed}/${results.length})  avg ${(retries / results.length).toFixed(1)} retries`)
    }
  }
  console.log()

  // ── Conclusion ──
  console.log('  WHAT THIS TELLS US')
  console.log('  ' + '─'.repeat(70))

  // Find best config
  const bestConfig = configNames.map(cn => {
    const results = records.flatMap(r => r.configResults.filter(c => c.configName === cn))
    const passed = results.filter(r => r.passed).length
    return { name: cn, passRate: passed / results.length, avgRetries: results.reduce((s, r) => s + r.retriesNeeded, 0) / results.length }
  }).sort((a, b) => b.passRate - a.passRate || a.avgRetries - b.avgRetries)

  if (bestConfig.length > 0) {
    const best = bestConfig[0]
    const baselineInfo = bestConfig.find(c => c.name === 'baseline')
    console.log(`  Best config: "${best.name}" (${(best.passRate * 100).toFixed(0)}% pass, ${best.avgRetries.toFixed(1)} avg retries)`)
    if (baselineInfo) {
      const improvement = ((best.passRate - baselineInfo.passRate) / baselineInfo.passRate * 100).toFixed(0)
      console.log(`  vs baseline: ${improvement}% improvement in pass rate`)
    }
  }
  console.log()
}

function main() {
  const records = loadRecords()
  if (records.length === 0) {
    console.log('No results found. Run `bun run src/index.ts` first.')
    process.exit(0)
  }

  const format = process.argv.includes('--json') ? 'json' : 'text'
  generateReport(records, format)
}

main()
