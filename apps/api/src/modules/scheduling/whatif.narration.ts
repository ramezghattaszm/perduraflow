import type { NarrationInput, NarrationMode, RationaleFactor, StructuredRationale, WhatIfOption } from '@perduraflow/contracts'

/**
 * Resolve a structured rationale into the **fact lines** the narration gateway is
 * allowed to use (A19 translate-only). Every fact traces to the structured rationale
 * (a factor's value + weighted contribution, a binding constraint, or a precomputed
 * comparative), so the prose can **characterise the trade-off** — what the option
 * prioritises, what it gives up, why it beats the alternatives — while inventing
 * nothing (DoD proof #5). This is the EN language surface; the rationale stays
 * i18n-keyed for the UI.
 */

const num = (v: unknown): string => (typeof v === 'number' ? String(v) : String(v ?? ''))

/** EN label for an option label key (the language surface; UI uses the key + i18n). */
const OPTION_LABELS: Record<string, string> = {
  'whatif.option.balanced': 'Re-sequence (balanced)',
  'whatif.option.protectDelivery': 'Protect delivery',
  'whatif.option.minimizeChangeover': 'Minimise changeovers',
  'whatif.option.service': 'Service now',
  'whatif.option.defer': 'Defer (keep running)',
  'whatif.option.overtime': 'Add overtime',
  'whatif.option.reroute': 'Re-route to other line(s)',
  'whatif.option.fasterOperator': 'Assign a faster operator',
  'whatif.option.wait': 'Wait for material',
  'whatif.option.resequence': 'Re-sequence around the gap',
}
const label = (key: string): string => OPTION_LABELS[key] ?? key
/** EN option label for a label key — reused by the conversation layer's artifact. */
export const optionLabelEn = label

const FACTOR_NAME: Record<string, string> = {
  lateness: 'firm-order lateness',
  changeover: 'changeovers',
  overtime: 'overtime',
  inventory: 'early/holding time',
  displacement: 'displacement (operations moved from the current plan)',
  cost: 'cost',
}

/** Human label for a rationale factor key (reused by the conversation artifact). */
export const factorLabelEn = (key: string): string => FACTOR_NAME[key] ?? key

/** A factor's human value from its structured detail params. */
function factorValue(f: RationaleFactor): string {
  const p = f.detailParams
  if (f.key === 'lateness') return `${num(p.hours)}h across ${num(p.orders)} order(s)`
  if (f.key === 'changeover' || f.key === 'displacement') return `${num(p.count)}`
  if (f.key === 'overtime' || f.key === 'inventory') return `${num(p.hours)}h`
  return `${num(f.rawValue)}${f.unit}`
}

/** One factor as a fact: its value + the amount it adds to the score (the breakdown). */
function factorLine(f: RationaleFactor): string {
  return `${FACTOR_NAME[f.key] ?? f.key}: ${factorValue(f)}, contributing ${f.contribution} to the option's score (${f.direction}).`
}

/** A binding/notable constraint as a fact. */
function constraintLine(detailKey: string, p: Record<string, string | number>): string | null {
  switch (detailKey) {
    case 'whatif.constraint.firmDelivery.late':
      return `Firm delivery is breached by ${num(p.hours)}h.`
    case 'whatif.constraint.firmDelivery.met':
      return `Firm delivery is met.`
    default:
      return null
  }
}

/** A comparative as a fact: how this option fares vs another, and the deciding factor. */
function comparativeLine(self: WhatIfOption, others: WhatIfOption[], c: StructuredRationale['comparatives'][number]): string | null {
  const other = others.find((o) => o.id === c.vsOptionId)
  if (!other) return null
  const rel = c.verdict === 'preferred' ? 'beats' : c.verdict === 'dominated' ? 'loses to' : 'trades off with'
  const d = c.decidingFactors[0]
  const why = d ? ` — the deciding difference is ${FACTOR_NAME[d.key] ?? d.key} (Δ ${d.delta} in its contribution)` : ''
  return `Versus ${label(other.labelKey)}, ${label(self.labelKey)} ${rel} it${why}.`
}

/** The complete fact set for one option: full factor breakdown + constraints + comparatives. */
function optionFacts(opt: WhatIfOption, others: WhatIfOption[]): string[] {
  const facts: string[] = []
  for (const f of opt.rationale.factors) facts.push(factorLine(f))
  for (const c of opt.rationale.constraints) {
    const line = constraintLine(c.detailKey, c.detailParams)
    if (line) facts.push(line)
  }
  for (const c of opt.rationale.comparatives) {
    const line = comparativeLine(opt, others, c)
    if (line) facts.push(line)
  }
  return facts
}

function kpiHeadline(opt: WhatIfOption, lead: string): string {
  const cost = opt.kpis.costPerUnit ?? 0
  return `${lead} ${label(opt.labelKey)} — OTIF ${Math.round(opt.kpis.otif * 100)}%, ${opt.kpis.lateOrders} late order(s), cost/unit ${cost}.`
}

/** Build the narration input for one option's rationale (full breakdown). */
export function optionNarrationInput(opt: WhatIfOption, others: WhatIfOption[], locale = 'en'): NarrationInput {
  return { mode: 'option', headline: kpiHeadline(opt, 'Option:'), facts: optionFacts(opt, others), locale }
}

/**
 * Build the across-options narration input — the **recommended** option's complete
 * breakdown (so the prose can explain the trade-off) plus the infeasible options.
 */
export function acrossNarrationInput(options: WhatIfOption[], recommendedId: string | null, locale = 'en'): NarrationInput {
  const feasible = options.filter((o) => o.feasible)
  const rec = feasible.find((o) => o.id === recommendedId) ?? feasible[0]
  if (!rec) return { mode: 'across_options', headline: 'No feasible option.', facts: [], locale }
  const facts = optionFacts(rec, feasible)
  for (const o of options.filter((x) => !x.feasible)) facts.push(`${label(o.labelKey)} is not feasible.`)
  return { mode: 'across_options', headline: kpiHeadline(rec, 'Recommended:'), facts, locale }
}

/** Build the narration input for the requested mode (one option or across-options). */
export function inputFor(mode: NarrationMode, options: WhatIfOption[], recommendedId: string | null, optionId?: string): NarrationInput {
  if (mode === 'option') {
    const opt = options.find((o) => o.id === optionId) ?? options[0]!
    return optionNarrationInput(opt, options.filter((o) => o.id !== opt.id))
  }
  return acrossNarrationInput(options, recommendedId)
}
