# Phase 5 hook — "so what": prediction → decision

> Captured during phase-4 board review. **Not built in phase 4.** Input to the phase-5 planning pass.

## The gap
Phase 4 predicts "Press Line A crosses the wear threshold ~05:31, confidence 53%, 3.8h out." A planner's real questions are the **so what**:
1. **What happens if it crosses?** — consequence (line slows, maintenance due). *(Minimal version surfaced in phase 4 — the consequence text.)*
2. **What's the impact to my line?** — **quantified**: which order goes late (e.g. ST-8830), throughput loss, **+$ cost** (Tier-B). *(Phase 5.)*
3. **What's the solution?** — **costed options**: service at 04:00 / call in OT / re-sequence — ranked, recommended. *(Phase 5.)*

## Why it's phase 5
#2 and #3 are exactly the explain-and-compare layer:
- **Quantified impact** = the plan-comparison primitive (D57) applied to "plan with the predicted wear" vs "plan without" → the delta in late orders / cost / throughput.
- **Costed solution options** = what-if option-sets (D55) applied to a prediction (service-now vs defer vs OT), each costed.
- **Narrated** = A19 verbalizes the structured rationale: *"Press Line A is wearing; unaddressed it crosses ~05:31, putting ST-8830 late and adding $Y; recommend servicing in the 04:00 window."*

## The phase-5 scene this defines
**Turn a prediction into a decision.** This is the Cockpit costed-options pattern (View 1) applied to a *predictive* trigger, narrated — a compelling, demo-relevant phase-5 beat:
> prediction (phase 4) → quantified impact (D57) → costed options (D55) → narration (A19) → human picks → re-solve.

Carry into the phase-5 planning pass as a concrete worked example of what-if + baseline + narration converging on one screen.
