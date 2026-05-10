/**
 * Run ID generation for dated benchmark output.
 *
 * Each benchmark run gets a stable run ID based on the time it starts.
 * All output files for that run use this ID as a prefix, making it
 * easy to track changes over time.
 *
 * Example: "2026-05-10T15-11-37"
 */

/** Generate a stable run ID for the current execution. */
export function generateRunId(): string {
  return new Date().toISOString().replace(/:/g, '-').split('.')[0]
}

/** Format a date for human-readable filenames. */
export function formatDate(date?: Date): string {
  const d = date ?? new Date()
  return d.toISOString().split('T')[0] // "2026-05-10"
}

/** Build a dated filename for a scenario. */
export function scenarioFilename(scenario: string, runId: string, ext: string): string {
  return `${scenario}-${runId}.${ext}`
}

/** Build a dated filename for a report. */
export function reportFilename(runId: string, ext: string): string {
  return `report-${runId}.${ext}`
}
