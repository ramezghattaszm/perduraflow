import type { NarrationInput, NarrationMode, StructuredRationale, WhatIfOption } from '@perduraflow/contracts'

/**
 * Resolve a structured rationale into the **fact lines** the narration gateway is
 * allowed to use (A19 translate-only). Each fact maps **1:1 to a rationale detail
 * key** (a factor or a binding constraint), so every sentence the model can produce
 * traces back to a structured fact — the boundary test (DoD proof #5). This is the
 * EN language surface; the structured rationale itself stays i18n-keyed for the UI.
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
}
const label = (key: string): string => OPTION_LABELS[key] ?? key

/** A factor detail key → an EN fact sentence (params from the structured rationale). */
function factorFact(detailKey: string, p: Record<string, string | number>): string | null {
  switch (detailKey) {
    case 'whatif.factor.lateness':
      return Number(p.hours) > 0 ? `${num(p.hours)}h of firm-order lateness across ${num(p.orders)} order(s).` : null
    case 'whatif.factor.changeover':
      return `${num(p.count)} changeover(s).`
    case 'whatif.factor.overtime':
      return Number(p.hours) > 0 ? `${num(p.hours)}h of overtime added.` : null
    case 'whatif.factor.inventory':
      return Number(p.hours) > 0 ? `${num(p.hours)}h of early/holding time.` : null
    case 'whatif.factor.displacement':
      return Number(p.count) > 0 ? `${num(p.count)} operation(s) displaced from the current plan.` : null
    default:
      return null
  }
}

function constraintFact(detailKey: string, p: Record<string, string | number>): string | null {
  switch (detailKey) {
    case 'whatif.constraint.firmDelivery.late':
      return `Firm delivery is breached by ${num(p.hours)}h.`
    case 'whatif.constraint.firmDelivery.met':
      return `Firm delivery is met.`
    default:
      return null
  }
}

/** Build the narration input for one option's rationale (headline + traceable facts). */
export function optionNarrationInput(rationale: StructuredRationale, locale = 'en'): NarrationInput {
  const headline = `${label(String(rationale.headlineParams.label ?? rationale.optionId))}: ${num(rationale.headlineParams.lateOrders)} late order(s), cost/unit ${num(rationale.headlineParams.costPerUnit)}.`
  const facts: string[] = []
  for (const f of rationale.factors) {
    const fact = factorFact(f.detailKey, f.detailParams)
    if (fact) facts.push(fact)
  }
  for (const c of rationale.constraints) {
    if (!c.binding) continue
    const fact = constraintFact(c.detailKey, c.detailParams)
    if (fact) facts.push(fact)
  }
  return { mode: 'option', headline, facts, locale }
}

/** Build the across-options narration input — recommended option + why it leads. */
export function acrossNarrationInput(options: WhatIfOption[], recommendedId: string | null, locale = 'en'): NarrationInput {
  const feasible = options.filter((o) => o.feasible)
  const rec = feasible.find((o) => o.id === recommendedId) ?? feasible[0]
  const headline = rec
    ? `Recommended: ${label(rec.labelKey)} — ${rec.kpis.lateOrders} late order(s), cost/unit ${rec.kpis.costPerUnit ?? 0}.`
    : 'No feasible option.'
  const facts: string[] = []
  if (rec) {
    for (const c of rec.rationale.comparatives) {
      const other = feasible.find((o) => o.id === c.vsOptionId)
      if (!other) continue
      const verb = c.verdict === 'preferred' ? 'is preferred over' : c.verdict === 'dominated' ? 'is worse than' : 'trades off against'
      const driver = c.decidingFactors[0]
      const because = driver ? ` (driven by ${driver.key}).` : '.'
      facts.push(`${label(rec.labelKey)} ${verb} ${label(other.labelKey)}${because}`)
    }
  }
  for (const o of options.filter((x) => !x.feasible)) {
    facts.push(`${label(o.labelKey)} is infeasible.`)
  }
  return { mode: 'across_options', headline, facts, locale }
}

/** Build the narration input for the requested mode (one option or across-options). */
export function inputFor(mode: NarrationMode, options: WhatIfOption[], recommendedId: string | null, optionId?: string): NarrationInput {
  if (mode === 'option') {
    const opt = options.find((o) => o.id === optionId) ?? options[0]
    return optionNarrationInput(opt!.rationale)
  }
  return acrossNarrationInput(options, recommendedId)
}
