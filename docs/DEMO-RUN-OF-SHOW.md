# Demo run-of-show — Magna-Coahuila (v2 spine)

**Anchor:** today = Mon Jun 29 2026. Week 1 = Jun 29–Jul 3. Holiday = Fri Jul 10 (both plants closed).
**Themes to land:** predictive scheduling · exception handling · AI capability · configurability — with **one auto-handled** beat.
**Arc (decided):** establish the human gate on something consequential *first*, then reveal the auto-handle as the trustworthy contrast. The auto-handle only reads as judgment, not overreach, because the room has already seen the system refuse to act alone.
**Capability tiers (decided):** **scripted** (walked, in order, narrated) · **armed** (staged + rehearsed, deployed only if the room asks — each mapped to its trigger-question below) · **cold** (exists but NOT rehearsed for this demo — do not reach for it live).

---

## OPENING FRAMING (spoken / slides — before the app, ~3–4 min)
Positions the platform; the live walk is its **first proven module**. Four pillars — each carries an honesty marker so the talk track never writes a check the live system can't cash.

**1. Modular — a suite, not a tool.** A platform of domain modules over a shared data-foundation layer: production scheduling, labor optimization, demand planning & forecasting, capacity planning & forecasting, logistics. Each owns its data + predictions; the deterministic scheduling kernel integrates them into one optimized, auditable, human-confirmed plan. Adopt the scheduler first; add modules over time — or **bring your own** (plug your existing demand planning in via contract).
- ⚠️ *Scheduling is built and is what we walk.* The other modules are **architected and contract-defined, not yet live.** Demand planning (net-requirements) is spec'd, not built. Say **"plug in *your* demand planning"** — true, and stronger than implying ours exists. Don't demo or promise a second live module.

**2. Configurable constraints — hard and soft.** The optimizer separates **hard** (must hold or the plan is invalid) from **soft** (trade-offs it weighs):
- *Hard:* shift/working windows, material availability, finite inspection capacity, within-routing precedence, minimum batch, routing eligibility, firm fence.
- *Soft:* changeover minimization, cost (run/OT/operator labor), on-time/lateness penalty, operator-performance weighting, schedule stability (anti-nervousness).
Each is config-data with a hard/soft designation and tunable weights — not hardcoded literals.
- ⚠️ (a) The **admin toggle panel for constraints isn't built** (deferred). Configurability is *stated* for constraints and *proven* live via the no-hardcoding rate-row change (armed beat) — **not** via a live constraint toggle. (b) Changeover today is **switch-count**, not a per-pair sequence-dependent matrix — don't claim sequence-dependent changeover. (c) Campaign/sequencing rules aren't built — don't cite them as an example.

**3. Contract-based architecture — how modules plug in.** Modules don't reach into each other; each **publishes a versioned contract** others consume (master-data, learning). The scheduler *reads* demand, capacity, material, labor through these contracts — so a module can be swapped, or a client's existing system substituted behind the same contract, without touching the kernel. Semver bindings keep it stable as modules evolve.
- This is the backbone of the modular claim: *modular* is the promise; *contract-based* is the mechanism that makes it real. Pair these two slides.

**4. Scalable & portable.** Multi-tenant (tenant-scoped data + config), cloud-portable via provider abstractions (storage/eventing not hardwired to one vendor), event-driven for throughput; stands up a new tenant on safe defaults.
- ⚠️ Frame as **architectural readiness**, not benchmarked scale — the demo is one seeded scenario. "Designed to scale / the architecture is built for it," **not** "proven at N plants."

**5. The intelligence model — layered and bounded.** Three layers over the **deterministic kernel** (which stays authoritative throughout); each has a *bounded* role:
- **ML — the predicting layer.** Predicts the *parameters* the schedule depends on (cycle/setup drift, tool-wear, operator performance; yield and supply reliability as those modules land). Carries confidence, feeds the scheduler, never overrides it.
- **Reasoning / agentic AI — the resolving layer.** Proposes remediations and, at the lowest, most reversible tier, resolves them autonomously. Autonomy is **graduated** — earned by measured track record, bounded by config.
- **LLM — the explaining layer, bounded.** Verbalizes *why* — anchored to the deterministic result, async, **never in the commit path.** It explains the plan; it never decides or changes it. *(The trust property: the LLM can't invent a schedule change because it isn't allowed to make one.)*
- **Through-line + beat mapping:** deterministic authoritative · ML predicts · agentic proposes/earns · LLM explains — and each layer is a beat you'll see: **ML → the wear prediction (Act 2)**, **agentic → the auto-handle + remediation (Acts 1–2)**, **LLM → the why-narration (Act 3)**. The opening plants the model; the body shows each layer doing its job.
- ⚠️ Honesty markers: ML *predicting* is live for **wear/drift + the learned-parameter overlay**; **yield and supply-reliability prediction are roadmap** — don't claim them live. The **auto-handle is the live proof** of graduated autonomy; the full "earn trust from track record over time" loop is **architecture** (its gating KPIs are a deferred surface) — present it as the model with one live instance, not a self-tuning production system. **LLM-bounded is fully real** — lead your trust message here.

**Transition:** "That's the platform — modular, contract-based, and an AI stack where every layer is bounded and the engine stays in charge. Here's the scheduling module running a real dual-plant operation." → Act 0.

---

## SCRIPTED SPINE

### Act 0 — Orient: the plant as it is *(predictive scheduling, foundation)*
- **On screen:** Cockpit → board, healthy baseline, Saltillo. Two plants. Work-list scoped to week 1 (~54 open). KPIs lived-in: On-Time ~97%, Util ~78–80%, At-Risk, OEE ~80%.
- **Action:** pan the week; switch Saltillo↔Ramos; nudge date nav to show Jul 10 closing both plants.
- **Intent:** a *real* plant — already optimized, calendar-aware, running full, believable track record (not fake 100%). The schedule *is* the predictive output: forward, constraint-aware (material, operators, inspection, shifts).
- **Pointed line:** RAM-2001 is on-time but has *no slack* — "the system already knows what's fragile before anything's late." Sets up Act 1.

### Act 1 — Exception → the human gate *(exception handling + configurability + AI capability)*
- **Trigger:** inject **demand-change** — an OEM bumps qty on a GM-Ramos part.
- **On screen:** RAM-2001 tips **at-risk**; because it's a *firm OEM delivery at risk*, it routes to a **human** (high tier).
- **Action:** **two-door** → "See options" renders 3 costed options (min-changeover / balanced / protect-delivery, recommendation marked) + the **Copilot 4th** via "Evaluate options." Planner selects → **confirm**.
- **Intent (the hinge):** consequential changes **stop and wait for a human**. The gating tier is **config-driven** (firm-OEM-risk = the condition), not hardcoded. Options are costed; Copilot reasons over the deterministic result. Three themes, one move.
- **Say out loud:** "the system proposed; it did **not** act. *You* decide. That's the default for anything touching a firm delivery." ← this sentence is what makes Act 2 safe.

### Act 2 — The auto-handle contrast *(predictive scheduling + earned autonomy + configurability)*
- **Trigger:** **tool-wear** drift on Press A — predicted *before* anything is late.
- **On screen:** system pre-positioned a small cycle adjustment and **auto-applied** it; **Exception Queue** shows it **auto-handled**, logged, with the ~2d predicted-limit runway.
- **Action:** open the auto-handled entry; show the log + reversibility note.
- **Intent (explicit contrast):** "you just saw a firm OEM risk wait for you; here's something the system handled on its own — and here's *why that's safe*." **Low-tier** (small, within tolerance), **transparent** (logged, in the queue), **reversible** (if the wear doesn't materialize, actuals re-step it — no gamble). Same machinery, different tier, tier set by config.
- **Trust line:** "autonomy here is *earned and bounded* — reversible action, observed, lowest-risk class. Everything consequential still routes to you."

### Act 3 — Explain the root *(AI capability — the "why")* **[promoted into spine]**
- **Trigger:** "why is SAL-1002 late?"
- **On screen:** grounded **operator** root — "Ana at 30% → inflated cycle → window overflow → late" — the *mechanism*, not just the who. Then the **faster-operator** remediation lever.
- **Action:** ask the Copilot; show the HOW-narration; surface the faster-operator option (human-confirmed — quietly reinforces the gate).
- **Intent:** the strongest "explain" beat — the AI attributes lateness to a *cause* and offers a costed, human-confirmed fix. Differentiates from dashboards that only flag, never explain.

### Act 4 — Compute the answer *(AI capability — the "how much")*
- **Trigger:** **goal-seek / rush-surge** — "how much overtime clears this?"
- **On screen:** the **minimal achievable OT** (two-sided: not under, not over), or an honest *can't-be-on-time* if it can't.
- **Action:** run goal-seek; show the precise answer + cost.
- **Intent:** the reasoning showpiece — a precise answer to what a planner would white-board by hand, grounded in the deterministic engine.

### Close — configurability / client-agnostic *(configurability)*
- **On screen:** tiers, KPI targets, horizon, calendar exceptions are **configuration**, not code — same platform stands up for any tenant with safe defaults.
- **Line:** deterministic engine authoritative; ML predicts; GenAI proposes; the human confirms — and *where* the auto/confirm line sits is yours to set.

---

## ARMED (rehearsed; deploy only if the room asks — each tied to its trigger-question)

| Capability | The audience question it answers | What you show |
|---|---|---|
| **Line-down reroute** | "What happens when a cell/machine goes down mid-shift?" / "How does it handle disruption?" | Weld Cell 1 down → RAM-2002 reroutes to Cell 2 **vs** OT-extend, cost-differentiated. (Verified end-to-end.) |
| **Material honest-no** | "What if the material isn't there?" / "Does it promise dates it can't hit?" | SAL-1004 → goal-seek returns **unachievable**, material root ("expedite/re-promise"). The truth beat. |
| **Line drift (under the hood)** | "How did it *know* the tool was wearing?" / "What's the prediction *based on*?" | Lift the hood on Act 2: the raw drift signal from actuals (`rampOverEvents`) the wear auto-handle consumed. NOT a separate capability — it's the basis of Act 2. |
| **No-hardcoding / config proof** | "Is this staged?" / "Is that number hardcoded?" | Change a rate row → cost/unit moves live. Proves config-data, not literals. Best answer to a skeptical buyer. |
| **Calendar/shift awareness** | "Does it know our shifts and holidays?" | Deepen Act 0: Jul 10 closes both plants; work runs Jul 9 & Jul 13 around it; 2×10h shift model. |

---

## COLD (exists, NOT rehearsed for this demo — do not reach for live)
- Anything not in the two tiers above. If asked, "that's on the roadmap / happy to show it in a follow-up" — never improvise a cold path live. The fastest way to break a demo is reaching for a half-rehearsed capability because the room asked.

---

## Demo-safety / pre-flight
- All injected presets are **induced-only** — fire on click, gone on `demo:reset`. Open every run from a clean reset; baseline healthy.
- **Recorded fallback** ready for every Copilot/narration beat (Act 1 Copilot, Act 3 HOW-narration) — the Groq flake in the dry-run is the reminder.
- Rolling anchor: rehearsing off-day (Jun 27/28) renders Monday relative state — confirm before going live.
- Overdue lane not live-exercised on a clean clock — if showing it, reset at an injected post-due time so it renders.

## Open decisions before talk-track
1. **Act order within the body:** explain (Act 3) before compute (Act 4) as written — or compute first? Current order escalates "why → how much," and Act 3's human-confirmed lever re-echoes the gate. Confirm or flip.
2. **Cold-open plant:** Act 1 is at Ramos; opening there saves a switch, but Saltillo carries the richer baseline for Act 0. Open Saltillo (richer) and switch, or open Ramos (fewer clicks)?
3. **Runtime:** 4-beat body + orient + close is a full demo. If the slot is short, Act 4 (goal-seek) is the most cuttable to armed-tier, since Act 3 already carries "AI capability."
