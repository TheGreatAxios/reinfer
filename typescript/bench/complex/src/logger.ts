import { writeFileSync, appendFileSync, mkdirSync, existsSync, readFileSync, readdirSync } from 'fs'
import { join } from 'path'

const RESULTS_DIR = join(import.meta.dir, '..', 'results')

export function ensureDir(): void {
  if (!existsSync(RESULTS_DIR)) mkdirSync(RESULTS_DIR, { recursive: true })
}

/** A single model response (raw, pre-validation) */
export interface ModelResponse {
  scenario: string
  model: string
  timestamp: string
  latencyMs: number
  rawText: string
  finishReason: string
  error?: string
}

/** Result of applying one config to one model response */
export interface ConfigResult {
  configName: string
  passed: boolean
  violations: string[]
  retriesNeeded: number
  autoFixApplied: string[]
}

/** Complete record for one scenario+model across all configs */
export interface ScenarioRecord {
  scenario: string
  model: string
  modelResponse: ModelResponse
  configResults: ConfigResult[]
  tags: string[]
  shape: string
}

export function logModelResponse(resp: ModelResponse): void {
  ensureDir()
  appendFileSync(join(RESULTS_DIR, 'raw-responses.jsonl'), JSON.stringify(resp) + '\n')
}

export function logScenarioRecord(record: ScenarioRecord): void {
  ensureDir()
  appendFileSync(join(RESULTS_DIR, `results.jsonl`), JSON.stringify(record) + '\n')
}

export function writeSummary(records: ScenarioRecord[]): void {
  ensureDir()

  // Per-config aggregation
  const configStats = new Map<string, { total: number; passed: number; totalRetries: number; totalAutoFix: number; latencyMs: number }>()
  for (const r of records) {
    for (const cr of r.configResults) {
      const s = configStats.get(cr.configName) ?? { total: 0, passed: 0, totalRetries: 0, totalAutoFix: 0, latencyMs: 0 }
      s.total++
      if (cr.passed) s.passed++
      s.totalRetries += cr.retriesNeeded
      s.totalAutoFix += cr.autoFixApplied.length
      s.latencyMs += r.modelResponse.latencyMs
      configStats.set(cr.configName, s)
    }
  }

  const summary = {
    generated: new Date().toISOString(),
    totalScenarios: records.length,
    configs: Object.fromEntries(configStats),
    records: records.map(r => ({
      scenario: r.scenario,
      model: r.model,
      tags: r.tags,
      latencyMs: r.modelResponse.latencyMs,
      configs: Object.fromEntries(r.configResults.map(cr => [cr.configName, { passed: cr.passed, retriesNeeded: cr.retriesNeeded, autoFixes: cr.autoFixApplied.length }])),
    })),
  }

  writeFileSync(join(RESULTS_DIR, 'summary.json'), JSON.stringify(summary, null, 2))
  console.log(`\n📊 Summary: ${records.length} scenarios × ${configStats.size} configs`)
}

export function printComparisonTable(records: ScenarioRecord[], configNames: string[]): void {
  console.log()
  console.log('  COMPARISON TABLE (✅ = passed on first try, 🔄 = needed retry, ❌ = failed)')
  console.log('  ' + '─'.repeat(20 + configNames.length * 18))
  const header = `  ${'Scenario'.padEnd(20)}` + configNames.map(c => c.padEnd(16)).join('')
  console.log(header)
  console.log('  ' + '─'.repeat(20 + configNames.length * 18))

  for (const r of records) {
    const cells = configNames.map(cn => {
      const cr = r.configResults.find(c => c.configName === cn)
      if (!cr) return '  N/A  '.padEnd(16)
      if (cr.passed && cr.retriesNeeded === 0) return '   ✅   '.padEnd(16)
      if (cr.passed && cr.retriesNeeded > 0) return `  🔄${cr.retriesNeeded}  `.padEnd(16)
      return '   ❌   '.padEnd(16)
    })
    console.log(`  ${r.scenario.padEnd(20)}` + cells.join(''))
  }
  console.log()
}

export function printConfigSummary(records: ScenarioRecord[], configNames: string[]): void {
  console.log('  CONFIG SUMMARY')
  console.log('  ' + '─'.repeat(60))
  for (const cn of configNames) {
    const results = records.flatMap(r => r.configResults.filter(c => c.configName === cn))
    const total = results.length
    const passed = results.filter(r => r.passed).length
    const firstTry = results.filter(r => r.passed && r.retriesNeeded === 0).length
    const autoFixed = results.filter(r => r.autoFixApplied.length > 0).length
    const totalRetries = results.reduce((s, r) => s + r.retriesNeeded, 0)
    const avgRetries = (totalRetries / total).toFixed(2)

    console.log(`  ${cn.padEnd(15)}  ${passed}/${total} passed  ${firstTry}/${total} first-try  ${autoFixed} auto-fixed  avg ${avgRetries} retries`)
  }
}
