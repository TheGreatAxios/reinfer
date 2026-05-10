import type { AutoFixResult } from './types'

/**
 * Attempt high-confidence syntactic fixes on malformed JSON.
 *
 * Returns (fixed string, list of fixes applied) or (null, []) if unfixable.
 *
 * Pipeline order:
 *   1. Strip <think> tags (DeepSeek reasoning traces)
 *   2. Strip markdown fences (```json ... ```)
 *   3. Extract JSON from prose wrapping (strip leading text before first { or [)
 *   4. Strip trailing non-JSON text after last } or ]
 *   5. Try parsing as-is
 *   6. Fix trailing commas
 *   7. Fix single quotes → double quotes
 *   8. Fix unquoted keys
 *   9. Combined high-confidence fixes
 *  10. Fix missing closing braces (medium confidence)
 */
export function autoFixJson(raw: string): AutoFixResult {
  const fixes: string[] = []
  let text = raw.trim()

  if (text.length === 0) return { fixed: null, fixes: [] }

  // ── Fix: Strip <think> tags (DeepSeek reasoning) ──
  if (text.includes('<think>')) {
    if (text.includes('</think>')) {
      text = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim()
    } else {
      // Unclosed think tag — remove the opening tag marker only;
      // the rest may still contain JSON content for the prose extraction step
      text = text.replace('<think>', '').trim()
    }
    fixes.push('stripped_think_tags')
  }

  // ── Fix: Strip markdown fences ──
  const fenced = text.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```\s*$/)
  if (fenced) {
    text = fenced[1].trim()
    fixes.push('stripped_markdown_fences')
  }

  // ── Fix: Extract JSON from prose wrapping ──
  if (text && !'{['.includes(text[0])) {
    const startCandidates = [text.indexOf('{'), text.indexOf('[')].filter(i => i >= 0)
    if (startCandidates.length > 0) {
      const start = Math.min(...startCandidates)
      if (Number.isFinite(start) && start > 0) {
        text = text.substring(start)
        fixes.push('stripped_leading_prose')
      }
    }
  }

  // ── Fix: Strip trailing non-JSON text ──
  if (text) {
    const lastBrace = text.lastIndexOf('}')
    const lastBracket = text.lastIndexOf(']')
    const end = Math.max(lastBrace, lastBracket)
    if (end >= 0 && end < text.length - 1) {
      text = text.substring(0, end + 1)
      fixes.push('stripped_trailing_text')
    }
  }

  text = text.trim()

  // ── Try parsing as-is ──
  try {
    JSON.parse(text)
    return { fixed: text, fixes }
  } catch {
    // continue to fixes
  }

  // ── Fix: Trailing commas ──
  let attempt = text.replace(/,\s*([}\]])/g, '$1')
  try {
    JSON.parse(attempt)
    return { fixed: attempt, fixes: [...fixes, 'removed_trailing_commas'] }
  } catch {
    // continue
  }

  // ── Fix: Single quotes → double quotes ──
  attempt = text.replace(/'/g, '"')
  try {
    JSON.parse(attempt)
    return { fixed: attempt, fixes: [...fixes, 'single_to_double_quotes'] }
  } catch {
    // continue
  }

  // ── Fix: Unquoted keys ──
  attempt = text.replace(/(?<=[{,])\s*([a-zA-Z_]\w*)\s*:/g, ' "$1":')
  try {
    JSON.parse(attempt)
    return { fixed: attempt, fixes: [...fixes, 'quoted_keys'] }
  } catch {
    // continue
  }

  // ── Combined high-confidence fixes ──
  attempt = text
    .replace(/,\s*([}\]])/g, '$1')               // trailing commas
    .replace(/'/g, '"')                           // single quotes
    .replace(/(?<=[{,])\s*([a-zA-Z_]\w*)\s*:/g, ' "$1":')  // unquoted keys

  const openBraces = (attempt.match(/{/g) || []).length - (attempt.match(/}/g) || []).length
  const openBrackets = (attempt.match(/\[/g) || []).length - (attempt.match(/\]/g) || []).length

  if (openBraces > 0 || openBrackets > 0) {
    attempt = attempt + '}'.repeat(Math.max(0, openBraces)) + ']'.repeat(Math.max(0, openBrackets))
  }

  try {
    JSON.parse(attempt)
    return { fixed: attempt, fixes: [...fixes, 'combined_fixes'] }
  } catch {
    // unfixable
  }

  // ── Fix: Missing closing braces only (medium confidence) ──
  // (Only runs if combined step's extra closing chars caused a problem)
  const justBraces = text.match(/{/g) || []
  const justClosed = text.match(/}/g) || []
  const openB = justBraces.length - justClosed.length

  const justBrackets = text.match(/\[/g) || []
  const justClosedBrackets = text.match(/\]/g) || []
  const openK = justBrackets.length - justClosedBrackets.length

  if (openB > 0 || openK > 0) {
    attempt = text + '}'.repeat(Math.max(0, openB)) + ']'.repeat(Math.max(0, openK))
    try {
      JSON.parse(attempt)
      return { fixed: attempt, fixes: [...fixes, 'closed_missing_braces'] }
    } catch {
      // truly unfixable
    }
  }

  return { fixed: null, fixes: [] }
}
