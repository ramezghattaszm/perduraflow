# Weight Configuration — hierarchical manual config (build) + learned-as-advisory (future)

> The objective weights (`lateness 10, changeover 1, overtime 4, inventory 0.2, displacement 2, cost 4`) are currently **hardcoded constants** (`whatif.weights.ts`, `aps-w2`). They are the engine's **objective function** — the business value system. This makes them **configurable, hierarchical, and resettable**, and documents the future **learned-advisory** layer.
>
> **The governing principle (the same authority model as the whole platform):** weights are a **stated, auditable policy**, configured by humans, never silently drifted by learning. ML may *propose* a weight change from observed behavior; the human *confirms*; the engine acts on the confirmed, stated weight. IATF auditability requires that "why did the schedule choose this?" always trace to a *stated* policy — not a drifting learned value.

---

## PART 1 — Hierarchical manual weight config (BUILD)

### The hierarchy: global → tenant → plant (stop at plant)
Cascading override; resolution order **plant → tenant → global** (most specific wins; global is the shipped-default floor, D48). Reset-to-global at any level.

| Level | Scope | Set by |
|---|---|---|
| **Global** | platform default (the current `aps-w2` constants) | Anthropic/PerduraFlow ships it |
| **Tenant** | a manufacturer's house philosophy ("we're JIT — weight holding higher") | tenant admin |
| **Plant** | a plant's own priorities (JIS plant near OEM weights lateness brutally; bulk-stamping weights changeover more) | plant admin |

**Reset:** any level can clear its override → falls back to the level above → ultimately global. So a plant can "reset to tenant," a tenant can "reset to global."

### Why it STOPS at plant — the policy-vs-physics principle (NOT line-level)
- Weights are an **objective function**; the engine scores **whole plans** against **one** objective. A schedule is per-plant → the objective is per-plant.
- **Plant is where weight variation genuinely lives** — different plants legitimately weigh trade-offs differently.
- **Line-level weights are incoherent.** If Line A valued lateness 10 and Line B valued it 5, you'd score one schedule against two objective functions — "the best plan" stops being well-defined. What varies per line is NOT the *weight* (policy) but the *operating parameters* (this line has more changeovers, runs slower) — **physics, not policy**. Those already vary per-resource via `resource_type_config` (the operating profile).
- **The distinction to hold: weights = policy (plant-level); operating parameters = physics (resource-level).** Don't make weights configurable below plant. Do make operating params configurable per resource. The "go to line level" instinct is real but it wants *operating-parameter* variation, not *weight* variation — a different (existing) config surface.
- **The one future exception:** if independent **scheduling scopes** below plant are ever modeled (a stamping area and an assembly area scheduled *separately*, never traded against each other), weights attach to the **scope**, not the line. Structure the resolution to *allow* an optional scope level only if that concept lands — not per-line.

### Build shape
- **Storage** — a `weight_set` table keyed by `(level, scopeId)` where level ∈ {global, tenant, plant}; each row holds the factor weights + `weightSetVersion`. Global is seeded with the current `aps-w2` constants. Soft-delete/transition per the standing rule.
- **Resolution** — a `resolveWeights(tenantId, plantId)` service: plant override → tenant override → global. Returns the effective weight set + which level each factor resolved from (for the UI to show "inherited from tenant" vs "overridden at plant").
- **Wire into scoring** — `scorePlan` / the sequencer read the *resolved* weights (not the hardcoded constant) via the base context (the same `buildBaseContext` threading as every other parameter). Determinism preserved (resolved weights are stable per solve).
- **Versioning** — `weightSetVersion` stamped into every rationale (as today) so a stored rationale stays interpretable against the exact weights that produced it. A weight change → a new version; old rationales keep their old version's interpretation.
- **Admin UI** — a weight-config screen per level (global read-only to tenants; tenant + plant editable by the right admin): the five+ factors with their values, "inherited / overridden" indicator per factor, and a **reset-to-parent** action. Show the *effective* resolved set alongside the overrides so the admin sees what's actually in force.
- **Audit** — every weight change is a recorded, attributable event (who, when, old→new). IATF: the schedule's choices trace to a stated, dated policy.

### Calibration guard (CRITICAL — carry the firm-lateness invariant)
The current weights are calibrated so **firm-lateness dominates** (lateness 10, and cost provably can't override it — the C6 calibration + the locked dominance test). **Configurable weights must NOT let an admin accidentally break firm-lateness dominance.** Options (decide at build):
- A **validation guard** on weight edits — reject (or warn hard) a weight set where firm-lateness no longer dominates (e.g. lateness weight below a floor relative to the others), so an admin can't misconfigure the engine into trading firm delivery for cost/changeover.
- At minimum, surface the consequence ("this weight set allows cost to override a firm-late order") so the change is *informed*.
The locked dominance unit test protects the *default*; configurable weights need a *runtime* guard so a custom set can't silently break the invariant.

### Verification
- Resolution cascade: set a plant override → it wins; clear it → falls to tenant; clear tenant → global. Reset-to-parent works at each level.
- Scoring uses resolved weights: change a plant's changeover weight → the plant's schedule re-scores accordingly (config-driven proof — the engine *responds* to the configured weight); other plants unchanged.
- `weightSetVersion` bumps on change; old rationales keep their version.
- Firm-lateness guard: attempt a weight set that breaks dominance → rejected/warned.
- Determinism: same resolved weights → same schedule.
- Audit: a weight change is recorded (who/when/old→new).

---

## PART 2 — Learned weights as an ADVISORY (FUTURE — document, don't build)

> The seductive-but-dangerous idea: let the system *learn* the weights from observed planner behavior (revealed preference) instead of stated config. **Build it ONLY as an advisory that proposes, never as an autonomous drift** — because auto-drifting weights break the audit story and violate the platform's own authority model.

### The idea (revealed preference)
The system observes what the planner *actually does* — which options they pick, which trade-offs they accept, when/how they override the engine — and *infers* the implied weights. "You keep choosing the lower-changeover option even when slightly later → your real changeover weight is higher than configured."

### Why it must be advisory-only, never auto-drift
- **Auto-drift breaks auditability (the dealbreaker).** If weights drift on observed behavior, "why did the schedule choose this?" becomes "because the model learned you prefer X" — *not* a stated policy an IATF auditor can trace. The entire authority model (deterministic, auditable, traceable) depends on weights being a *known, stated* policy.
- **Revealed preference learns flaws too.** If a planner always overrides to protect a favored customer (politics, not optimality), the system would *learn and entrench* that bias. Stated policy is deliberate; learned behavior includes its mistakes.
- **It removes control.** The customer *wants* to declare "we prioritize firm delivery" — a deliberate business decision, not something to be inferred and possibly drift away from.

### The correct shape (graduated autonomy / propose-then-confirm, applied to policy)
The ML layer **observes** planner decisions and **suggests** a weight adjustment — "your revealed behavior implies a changeover weight of ~1.6 vs. the configured 1.0; adjust?" The human **reviews and explicitly accepts** (or rejects). On accept, the weight becomes a **stated, dated, attributable** policy change (it flows through the same Part-1 config + audit path) — just *informed* by learned insight rather than typed from scratch. So:
- The weight is **always a stated policy** (auditable), never a silently drifting learned value.
- Learning **informs a proposal**; the human **decides**; the engine **acts on the confirmed weight**.
- This is **exactly the platform's authority model** (ML proposes within bounds → human confirms consequential change → deterministic engine acts → everything auditable), applied to policy weights. A learned-and-auto-drifting weight system would *violate* that model.

### Dependencies (why it's future)
- Capture the **decision actuals** — planner option-choices and overrides as observable, attributable events (a decision-log substrate).
- A **preference-inference model** (infer implied weights from observed choices) — an ML build, with the confidence calibration (AQ8) the rest of the ML layer needs.
- The **propose-review-accept UX** — surface the suggestion, let the human confirm, route the accept through the Part-1 config + audit.

### The one-line rule
**Weights are configured (stated, auditable); learning may *propose* a change; the human always *confirms*; the engine never acts on a weight the human didn't state.** Never auto-drift.

---

## Summary
- **Build now:** hierarchical manual weight config (global → tenant → plant, cascade, reset-to-parent, stop-at-plant), wired into scoring via resolved weights, versioned, audited, with a **firm-lateness-dominance guard** so a custom set can't break the invariant.
- **Document (future):** learned weights as an **advisory** — ML proposes a weight adjustment from revealed preference, the human confirms, the weight stays a stated/auditable policy. **Never auto-drift** — that would break auditability and violate the authority model.
- **The principle that ties them:** weights are a *stated policy*, not a *learned drift*. Configurable for control + audit; learning only ever *informs a proposal* the human confirms.
