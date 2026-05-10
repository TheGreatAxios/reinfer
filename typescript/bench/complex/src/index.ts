/**
 * bench-complex: runs 20+ complex scenarios against OpenRouter,
 * then replays every response through multiple validation configs.
 *
 * This produces a comparison matrix showing which config saves the most
 * API calls, handles edge cases best, etc.
 *
 * Usage:
 *   OPENROUTER_API_KEY=sk-or-v1-... bun run src/index.ts
 *   SCENARIO_FILTER=recursive  bun run src/index.ts
 */

import { SCENARIOS } from './scenarios'
import { CONFIG_MATRIX, applyConfig } from './config-matrix'
import {
  logModelResponse,
  logScenarioRecord,
  writeSummary,
  printComparisonTable,
  printConfigSummary,
  type ModelResponse,
  type ConfigResult,
  type ScenarioRecord,
} from './logger'
import { autoFixJson, extractString, Schema, validate } from 'reinfer'

const API_KEY = process.env.OPENROUTER_API_KEY
const BASE_URL = process.env.OPENROUTER_BASE_URL ?? 'https://openrouter.ai/api/v1'
const MAX_ATTEMPTS = Number(process.env.MAX_ATTEMPTS ?? '3')
const SCENARIO_FILTER = process.env.SCENARIO_FILTER ? new RegExp(process.env.SCENARIO_FILTER) : null
const MODEL = process.env.MODEL ?? 'nvidia/nemotron-3-super-120b-a12b:free'

if (!API_KEY) {
  console.error('❌ OPENROUTER_API_KEY required')
  process.exit(1)
}

async function callModel(systemPrompt: string, userPrompt: string): Promise<{ text: string; finishReason: string; latencyMs: number }> {
  const start = performance.now()
  const res = await fetch(`${BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://github.com/thegreataxios/reinfer',
      'X-Title': 'reinfer-bench-complex',
    },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      max_tokens: 1000,
    }),
  })
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
  const data = await res.json() as any
  return {
    text: data.choices?.[0]?.message?.content ?? '',
    finishReason: data.choices?.[0]?.finish_reason ?? 'stop',
    latencyMs: Math.round(performance.now() - start),
  }
}

async function main() {
  console.log('═'.repeat(80))
  console.log('  bench-complex: Validation Harness Prover')
  console.log(`  Model: ${MODEL}`)
  console.log(`  Configs: ${CONFIG_MATRIX.map(c => c.name).join(', ')}`)
  console.log('═'.repeat(80))
  console.log()

  const scenarios = SCENARIO_FILTER
    ? SCENARIOS.filter(s => SCENARIO_FILTER.test(s.name))
    : SCENARIOS

  console.log(`Running ${scenarios.length} scenarios across ${CONFIG_MATRIX.length} configs...\n`)

  const records: ScenarioRecord[] = []

  for (let i = 0; i < scenarios.length; i++) {
    const scenario = scenarios[i]
    const hard = scenario.intentionallyHard ? ' ⚠️' : ''
    console.log(`[${i + 1}/${scenarios.length}] ${scenario.name}${hard}`)

    // Step 1: Call the model once
    let modelResp: ModelResponse
    try {
      const { text, finishReason, latencyMs } = await callModel(scenario.systemPrompt, scenario.userPrompt)
      modelResp = {
        scenario: scenario.name,
        model: MODEL,
        timestamp: new Date().toISOString(),
        latencyMs,
        rawText: text,
        finishReason,
      }
      logModelResponse(modelResp)
      console.log(`  📡 ${latencyMs}ms ${text.slice(0, 80).replace(/\n/g, ' ')}...`)
    } catch (err) {
      modelResp = {
        scenario: scenario.name,
        model: MODEL,
        timestamp: new Date().toISOString(),
        latencyMs: 0,
        rawText: '',
        finishReason: 'error',
        error: err instanceof Error ? err.message : String(err),
      }
      logModelResponse(modelResp)
      console.log(`  ❌ API error: ${modelResp.error}`)
    }

    // Step 2: Replay through every config
    const configResults: ConfigResult[] = []
    for (const config of CONFIG_MATRIX) {
      const result = applyConfig(modelResp.rawText, config, scenario.schema)
      configResults.push({
        configName: config.name,
        passed: result.passed,
        violations: result.violations,
        retriesNeeded: result.retriesNeeded,
        autoFixApplied: result.autoFixApplied,
      })
    }

    const record: ScenarioRecord = {
      scenario: scenario.name,
      model: MODEL,
      modelResponse: modelResp,
      configResults,
      tags: scenario.tags,
      shape: scenario.expectedShape,
    }
    records.push(record)
    logScenarioRecord(record)

    // Quick status per config
    const statusLine = CONFIG_MATRIX.map(c => {
      const r = configResults.find(r => r.configName === c.name)!
      if (r.passed && r.retriesNeeded === 0) return `${c.name}:✅`
      if (r.passed) return `${c.name}:🔄${r.retriesNeeded}`
      return `${c.name}:❌`
    }).join(' ')
    console.log(`  ${statusLine}`)
  }

  // Step 3: Summary
  writeSummary(records)
  printComparisonTable(records, CONFIG_MATRIX.map(c => c.name))
  printConfigSummary(records, CONFIG_MATRIX.map(c => c.name))

  console.log('\nDone.')
}

main().catch(err => { console.error(err); process.exit(1) })
