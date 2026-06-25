# Predictive Scheduling — emphasis & talk track

> How to position the predictive story in the demo. The core message: this isn't a reactive scheduler that *actions* problems after they surface — it **predicts** them (material delays, material changes, tool wear), **learns from execution actuals**, and **projects the future**, then acts through a deterministic, auditable engine with predictions advisory until confidence is earned.

## The one-sentence pitch
**Reactive scheduling tells you a problem happened. Predictive scheduling tells you it *will* happen — a tool will cross its wear line in ~65 hours, material will arrive late, a delay will cascade into a downstream order — and re-sequences to protect delivery *now*, showing its confidence so you can trust it.**

## The four predictive pillars

### 1. Predict tool wear (built — the headline beat)
The system forecasts when a tool will cross its wear threshold *before* it fails — Press Line A: "predicted to cross in 65.9h," with a confidence %, projected from the trend over execution actuals. It then **pre-emptively re-sequences** to protect downstream ops from the predicted starvation — acting on the forecast, not waiting for the failure. This is predictive-maintenance-meets-scheduling; a reactive scheduler can't do it.

### 2. Predict material delays (the emphasis to grow — NOTE the build state)
The vision: the system doesn't just *gate* on a known material arrival (the deterministic constraint it does today, C2/D36) — it **predicts** that material *will* be late, from the pattern of past arrivals (the actuals are the material-arrival history), and surfaces the risk *ahead* of the confirmed delay.
- **Built today:** material arrival is a **deterministic gate** — given an arrival time, the engine schedules around it and flags the at-risk (ST-8830/PV-22), and the causal chain traces the consequence. This is *acting on* a known/seeded arrival, not *forecasting* it.
- **The predictive step (vision / production):** *learn* from material-arrival actuals (supplier on-time history per component) → *predict* the likelihood/timing of a late arrival before it's confirmed → surface "PV-22 likely to slip" as a forecast, the same advisory→confidence→action shape as tool wear. This is the ML layer applied to material, parallel to cycle-time learning. **Currently a production-roadmap item, not built** — emphasize as the architecture's natural extension (same learning overlay, new parameter), honestly framed.

### 3. Predict material changes (the emphasis to grow — vision)
The vision: predict **engineering/spec changes** or **demand-mix changes** to material requirements — anticipate that a component substitution or a BOM change is coming, from the pattern of change history, so the schedule adapts ahead of the formal change. **Vision / production** — the learning architecture (learn-from-actuals → predict) generalizes to this, but it depends on capturing change-history actuals. Frame as where predictive material intelligence goes, not a current feature.

### 4. Learn from actuals → project the future (built — the foundation)
The system has been *running and learning*: it ingests execution **actuals** and learns the *real* parameters (cycle times std→ml) rather than scheduling on nominal standards, so the plan reflects what will *actually* happen. The warm-start seed makes this visible on open ("Decision Cockpit — learning from execution actuals"; Press Line A comes up with learned values + a live wear forecast). **The actuals to emphasize as the learning fuel: cycle-time actuals (built), and — as the vision extends — material-arrival actuals and material-change actuals** (so the same learning loop that sharpens cycle times also predicts material delays and changes).

## Reinforcing predictive capabilities (built)
- **Causal cascade prediction** — the lateness chain *predicts the ripple, not just the symptom*: ST-8830's material delay *will* jam the shared Leak-Test Station and tip DL-2002 late — traced to root, before it's obvious. Predicting *consequences*, deterministically.
- **What-if / goal-seek** — predict the *outcome of a decision* before committing: "what if I add overtime → here's the result," and "how much overtime clears it → 2h (or honestly, OT can't — it's material)." Predicting the effect of your own levers.

## The anchor (what makes it trustworthy predictive scheduling, not black-box)
- **Prediction feeds a deterministic, auditable engine** — the ML layer predicts; the engine acts; every decision stays traceable (IATF-compatible). Not a black-box optimizer.
- **Advisory until confidence is earned** — a prediction stays advisory (queued, shown with confidence + sample count) and only earns autonomy as measured accuracy validates it (graduated autonomy, confidence × consequence tier).
- **Grounded, never fabricated** — a forecast shows its confidence, its sample count, "not yet measured" when thin; the system never invents a prediction it can't ground.

## Honesty caveat (strengthens credibility — hold it)
The current wear predictor is a deterministic **OLS/trend stand-in** for a production ML model (documented in the production roadmap). Material-delay and material-change *prediction* (pillars 2 & 3) are the **architecture's natural extensions, not yet built** — the same learn-from-actuals → predict overlay, applied to material-arrival and change-history actuals. For the demo: emphasize the **capability and the architecture** (predict → advisory → earned autonomy → deterministic action), demonstrate the **built** beats (tool-wear forecast, cycle-time learning, causal cascade, what-if/goal-seek), and be **honest** that material prediction and the production ML model are the productionization steps. The mechanism and the architecture are real and demonstrable; the breadth of predicted parameters and the model maturity are the roadmap. That honesty is part of the trust story.

## Emphasis order for the demo
1. **Learning from actuals** (foundation) — "it's been running and learning; here's what it knows that standard times don't."
2. **Tool-wear forecast → pre-emptive re-sequence** (headline) — "it saw the wear coming and acted before it failed."
3. **Causal cascade prediction** (the ripple) — "it predicts the downstream consequence, traced to root."
4. **What-if / goal-seek** (decision prediction) — "predict your decision's outcome; it finds the fix or honestly says there isn't one."
5. **The vision** (material delay + change prediction) — "the same learning loop extends to predicting material delays and changes — the production roadmap."
6. **The anchor** — "all of it advisory until confidence is earned, feeding a deterministic auditable engine. Predictive *and* traceable."
