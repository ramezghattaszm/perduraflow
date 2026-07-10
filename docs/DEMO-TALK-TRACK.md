# Demo talk-track — Magna-Coahuila (word-for-word)

Companion to `DEMO-RUN-OF-SHOW.md`. `[bracketed]` = stage direction / click; "quoted" = spoken.
**Anchor:** today = Mon Jun 29 2026. Week 1 = Jun 29–Jul 3. Holiday Fri Jul 10.
**Resource names (say these exactly):**
- Saltillo Stamping → **Press A**, **Press B**
- Ramos Arizpe Welding → **Weld Cell 1**, **Weld Cell 2**, **Leak-Test Station**

---

## OPENING — five pillars (spoken / slides, before the app, ~4 min)
Order: **structure → fit → trust → live.** Modular → Contract (+ bring-your-own-systems) → Scalable → Configurable constraints → Intelligence model. The last pillar ends by handing into the demo.
> Honesty markers (hold these): only **scheduling** is live — other modules are contract-defined, not built. Configurable-constraints has **no live admin toggle panel** (proven via the no-hardcoding rate-row change, not a toggle screen). ML *learning loop* is real and live (relearn-on-actuals), but the demo is a **seeded warm-start** — claim the *mechanism* ("learns as actuals come in"), not a long trained history. Autonomy: "earned, above a confidence bar you set" is provable in Act 2; do **not** claim a built earn-trust-from-track-record loop. Scale is **architectural readiness**, not benchmarked.

### Pillar 1 — Modular (the suite)
"Perdura isn't a scheduling tool — it's a platform. A suite of modules over a shared data foundation: production scheduling, labor optimization, demand and capacity planning, logistics. Each owns its own data and its own predictions; one deterministic engine integrates them into a single plan. You adopt what you need, when you need it — start with scheduling, add modules over time."
- ⚠️ *Scheduling is what we walk today. The rest are designed-and-contract-defined, not yet live. If asked to see another module: "contract-defined, on the roadmap" — don't open one.*

### Pillar 2 — Contract-based (the mechanism + bring-your-own-systems)
"What makes that modularity real instead of a slide is the architecture underneath: modules don't reach into each other. Each one publishes a versioned contract; the others consume it. So a module can be swapped, upgraded, or replaced without touching the rest. And that same contract boundary is how *your* systems plug in — your MES, your ERP, your existing demand signals. You don't rip and replace what works. You connect it, and Perdura sits on top."
- *Pair this visually with Pillar 1 — modular is the promise, contract-based is the proof, bring-your-own-systems is the client payoff.*

### Pillar 3 — Scalable & portable
"It's multi-tenant and cloud-portable by construction — storage and messaging sit behind abstractions, not wired to one vendor — so it stands up a new plant or a new client on safe defaults and scales across them."
- ⚠️ *Architectural readiness, not a benchmarked-at-scale claim. "Designed to scale / built for it," never "proven at N plants."*

### Pillar 4 — Configurable constraints (the fit)
"Every plant runs by its own rules, so the engine separates **hard** constraints — things that must hold or the plan is invalid: shift windows, material availability, inspection capacity, routing — from **soft** ones it trades off: changeovers, cost, on-time, operator performance, schedule stability. Those aren't hardcoded. They're configuration — which is how the same platform fits a stamping plant and a welding plant without a rewrite."
- ⚠️ *No live constraint-toggle panel exists. Configurability is proven later via the no-hardcoding rate-row change (armed beat) — don't promise a toggle screen. Don't cite sequence-dependent changeover (switch-count only) or campaign rules (not built) as examples.*

### Pillar 5 — The intelligence model (trust → hands into the demo)
"And here's how we put AI on a plant floor without asking you to give up control. Underneath everything is a **deterministic** scheduling engine — same inputs, same plan, every time, and every decision logged: what changed, why, who approved it. That engine is authoritative. The AI never overrides it.

Around it, three bounded layers. ML **predicts** the parameters the schedule depends on — today, tool wear, cycle drift, operator performance — and it **learns from your actuals as they come in**, so the predictions sharpen over time, each carrying a confidence score. Each module owns its own predictions, so the predicting layer extends across the floor as modules land: **yield and scrap** with the quality module, **material and supply reliability** — will the inbound part actually arrive when promised — and **changeover learning** from your real setup times. That's the execution floor. Your **demand and capacity forecasts** stay where they are — your existing planning systems feed those in through the contract; Perdura consumes them, it doesn't replace them. The agentic layer **proposes** fixes — and acts on its own only **above a confidence bar you set**; below that bar, it asks. You'll see exactly that in a minute: one prediction the system was confident enough to act on, one it held and brought to a person. And the language layer **explains** — in plain English, anchored to the engine's real reasoning, never inventing a cause the engine didn't find.

Predict, propose, explain. Three layers, one rule: the engine decides, the AI assists, and you stay in control."
- ⚠️ *"Learns as actuals come in" = the live relearn mechanism (true); don't imply a long trained history (demo is seeded warm-start). **Live/shown predictors: wear, drift, operator only.** Everything else is **future, future-tense**: yield/scrap (quality module — engine assumes 100% yield today, OEE quality leg seeded NOT modeled, the #1 gap), material/supply reliability (not built), changeover learning (per-pair matrix not built — switch-count only today). Never let these sound present-tense. **Demand & capacity are NOT Perdura predictors** — they're the client's existing planning systems, consumed via contract (reinforces Pillar 2's bring-your-own-systems). Don't claim Perdura predicts demand/capacity. "Above a confidence bar you set" is provable in Act 2 (Line A 67% asks / Line B 88% acts) — frame the bar as configurable. Bounded-LLM line ("never inventing a cause") is provable in Act 3 — say it proactively if the room looks skeptical. Do NOT claim a built "learned to trust itself over time" loop.*

**Transition into the app:** "That's the platform — modular, contract-based, every AI layer bounded, the engine in charge. Let me show you the scheduling module running a real dual-plant operation." → Act 0.

---

## Act 0 — Orient (Ramos cockpit → board)  ✅ locked

**[Cockpit, Ramos Arizpe, clean reset]**
"This is Ramos Arizpe — one of the two plants we'll walk. This is the live operating picture: the current plan, scored against how the plant's actually been running."

**[gesture across the KPI tiles]**
"Utilization's at 86% — this plant is running hard, the lines are loaded. But OEE's at 74%. That gap matters: they're busy, but about a quarter of the theoretical output is leaking away — availability, pace, quality. That's the real world, not a clean number."

**[point to At-Risk = 0]**
"And right now the current plan is all on-time — nothing flagged at risk. Hold onto that. It's about to change."

**[drill into the board / Gantt]**
"Here's the schedule itself — not a wall chart kept by hand, this is the optimizer's output. Every job placed inside real shift windows, respecting material availability, inspection capacity at the Leak-Test Station, routing order. This is the week, forward-looking."

**[point to RAM-2001 on a weld cell]**
"This one — RAM-2001, a just-in-sequence part for GM — is on time. But look at the slack: there's almost none, the orders run back-to-back. And everything on this line funnels through one shared leak-test station. On time today, with nothing absorbing a surprise. The system already knows it's fragile. Let's send one."

> *Light foreshadow: plant the shared leak-test station as a noticed detail, NOT a thesis. Don't explain "it'll cascade" — let Act 1 deliver that. The goal is Act 1's reveal lands as "there's the funnel he mentioned," not a cold surprise and not a spoiled punchline. Baseline number: On-Time ~93%, Util 86%, OEE 74%, At-Risk 0.*

**→ Act 1.**

**Ready answers (if asked):**
- *Why is OEE trailing-looking while On-Time looks current?* — "Efficiency is a trailing measure; risk is forward-looking. Trailing performance, live risk."
- *Why 100% on-time here?* — "This plant's current plan is clean. The scorecard, per version, includes what already finished late — that's where past misses show. Cockpit is live 14-day plan health." (Don't open the scorecard in Act 0.)

---

## Act 1 — Exception → the human gate (demand-change at Ramos)  ✅ verified end-to-end

> **The beat (verified live):** OEM bumps D-1351 (RAM-2001 weldment, Weld Cell 1) 42 → 150. D-1351 itself **absorbs the bump and stays on time** — but its enlarged leak-test tail floods the shared **Leak-Test Station**, putting **7 other orders at risk** (3 firm: D-1354, D-1358, D-1681; 4 forecast), all on Mon/Tue, all in the viewed week. Cause = D-1351 (cyan source). Consequence = the 7 (amber). Committed at-risk stays 0 (red, none). **The weld cell is fine; the shared bottleneck behind it is what breaks.** This is the whole pitch in one beat — a single OEM change traced through a shared finite resource to its specific downstream casualties.

**[trigger the inbound signal — appears as an EDI/OEM release change]**
"Here's the kind of thing that hits a planner's desk a few times a day. One of our OEMs just revised a release — pulled more volume into the same window on a GM part. No new time, just more parts. Totally normal — and exactly where plans quietly break."

**[banner appears: "D-1351 demand changed, qty 42 → 150 — 7 orders at risk. Review impact."]**
"And the system already did the math. The moment that signal landed, it re-ran the plan in the background — and look: that one change puts *seven* orders at risk."

**[point the cyan-outlined source order]**
"Here's the part most tools would miss. The order they actually changed — this one — is *fine*. It absorbs the extra volume and still ships on time. The weld cell that runs it has room."

**[sweep the 7 amber orders on the Leak-Test Station]**
"The damage is one step downstream. Every welded part has a mandatory leak test, and they all share one station. Bigger order means a bigger leak-test tail — and that tail shoves *seven other orders* past due. Not on the weld cell — on the shared leak-test station behind it. A planner staring at the weld line would never see this coming. The system traced it in a second."

**[the gate — system flags, does NOT act]**
"Now watch what it does *not* do. Of those seven, three are *firm* customer commitments — the others are forecast. Because firm deliveries are at risk, the system stops. It does not quietly reshuffle anything — the live plan hasn't moved. It flags it and routes it to a person. That routing is a rule *you* set: anything that risks a firm delivery comes to a human. Configurable — a low-risk change might never reach you; this one always does."

**[door 1 — Review impact → See options: the costed card]**
"When I ask for options, I get costed choices, not a wall of text."
**[open the option-set]**
"A few strategies — one minimizes changeovers, one protects the deliveries outright, a balanced one in between that the system recommends, and tells me *why*. Each tile is real cost and real delivery impact. And anything that genuinely can't hit the date isn't offered as a choice — it's shown as a non-option. The system won't pretend a plan works when it doesn't."

**[door 2 — Evaluate via Copilot]**
"If I want to push on it, I can."
**[open Evaluate / Copilot]**
"Same deterministic result underneath — now I can interrogate it. 'Why not the cheaper one? What does protecting these deliveries cost me elsewhere?' The assistant reasons over the actual plan, not a guess. The engine owns the numbers; the assistant helps me understand them."

**[planner selects → confirm]**
"I make the call — protect the firm GM deliveries — and confirm. *Now* it acts. The plan updates, the orders are back on track, and all of it is logged: what changed, why, who approved it."

**[tie-off — arms Act 2]**
"Hold onto this: the system caught a problem most tools never would, did the analysis, recommended a fix — and then it *waited for me*. It proposed. It did not act. That's the default for anything consequential. Keep it in mind for what's next."

**→ Act 2.**

**Ready answers (if asked):**
- *Why is the changed order itself not late?* — "It has room on its weld cell. The constraint isn't the weld — it's the shared leak-test station every welded part funnels through. That's the kind of second-order effect this is built to catch."
- *Firm vs forecast?* — "Firm is a contractual commitment; forecast is a planning estimate. Seven at risk, but the three *firm* ones are what trip the human gate — forecast slipping is a watch item, firm slipping is a call from the customer."
- *Can it auto-approve the low-risk ones?* — "Yes — that's exactly what I'll show you next." (Segue to Act 2; don't spoil.)
- *Why lead with the card, not the assistant?* — "Engine first — fast, costed, bounded. The assistant is for interrogating it. Deterministic first, conversation second."

**Stage cues / safety:**
- Cyan = source (D-1351), amber = the 7 consequences, red = committed at-risk (none here). If the colors blur at presentation zoom, lean on the spoken "the changed order is fine / the seven behind it aren't."
- Banner count (7) and the amber highlight read the same set by construction — they can't disagree.
- Recorded fallback ready for the door-2 Copilot answer (Groq flake).
- No `demo:reset` here — Act 1's committed resolution persists into Act 2+ (one continuous session; reset only pre-flight).

## Act 2 — Two-tier predictive autonomy: tool wear (Saltillo, Press A + Press B)  ✅ verified live

> **The beat (walked end-to-end):** Two wear predictions on Saltillo, side by side at different confidence — **Press A ~67% (queued, "Need you")** and **Press B ~90% (auto-adopted, "Handled")**. The system *acted* on B (above the bar) and *asked* on A (below). Same plant, same screen — the live receipt for the opening's "acts above a bar you set, asks below." Then: dismiss A → it lands in **Set-aside** (watched, not gone) → re-solve applies B's value → **draft** → commit → **live plan carries the wear, absorbed, nothing late.**
> **Arc:** Act 1 was reactive (a change that happened). Act 2 is predictive (a problem that hasn't). And it's where the autonomy story completes — three gates: the system *adopts the value* (auto at high confidence), you *apply it to a plan* (re-solve → draft), you *commit* (final human gate). The auto-handle is real and bounded.
> **Plant switch:** Acts 0–1 Ramos; this is **Saltillo**, stay through Acts 3–4.
> ⚠️ **PRE-FLIGHT (critical):** the Press B crossing lands at **reset-time + ~2h**. **Reset 60–90 min before you reach this act** so the crossing is still *ahead* at demo time (reads as "crosses in ~1h," near-future). Reset too early and it crosses before you get here. Verified numbers below assume a fresh-enough reset.

**[Saltillo cockpit — the stale banner]**
"Let me switch to Saltillo, the stamping plant. Right away, notice this banner: *plan stale — actuals have drifted past threshold.* The presses have been wearing as they run, and the system has noticed the real cycle times drifting from plan. It's telling me the plan no longer matches reality — and it's caught it on its own."

**[into the exception screen — the two tiers]**
"Here's where it gets interesting. The system has two wear predictions right now, and look how it's sorted them. One it's *asking* me about. One it already *handled.*"

**[point Press A — Need-You, ~67%]**
"Press A — it predicts the tool crosses its wear line, at about **67% confidence**. That's a real signal, but it's not certain. So the system *will not* act on it. It's in my 'Need you' list — it proposes, and it waits. I can pre-adjust it now, or set it aside."

**[point Press B — Handled/Adopted, ~90%]**
"Press B — same kind of prediction, but at about **90% confidence**. Above the bar. So the system already adopted the learned cycle time — pre-emptively, *and it tells me it did*, with a revert button right here. It didn't sneak it in. It acted because it was confident, logged that it acted, and left me the undo. That's the whole model in one screen: above a confidence bar you set, it acts; below it, it asks."

**[dismiss Press A → Set-aside appears]**
"Let me say 'not yet' on Press A. Watch — it doesn't vanish. It drops into 'Set aside,' with its history: dismissed at 67%, and the system will re-alert *only if the wear gets materially worse.* I set it aside, but I didn't lose it, and it's still watching. Nothing the system flags ever just disappears."

**[re-solve → draft, banner clears, orange ops]**
"Now I apply what it's learned. I re-solve — and it builds a **draft**, not a live change. The stale banner clears. And look at the plan: these orange ops are running the *worn* cycle time — the system's pre-adopted prediction, priced into the schedule. Notice it's surgical — ops before the predicted crossing this afternoon still run standard; only the ops from the crossing forward carry the wear. It didn't blanket the plan. It applied the wear exactly where the tool will actually be worn."

**[commit → live plan, wear absorbed]**
"I accept it, and commit. Now it's the live plan. And here's the payoff of catching it early: the plan now runs the worn cycle times, the system planned around the degradation — and *nothing is late.* No order at risk, no fire to fight. That's what prediction buys you. The wear is handled before it ever becomes a delivery problem."

**[tie-off — arms Act 3]**
"So Act 1 it caught a change that happened and waited for me. Here it predicted wear before it happened — acted where it was sure, asked where it wasn't, and absorbed it into the plan with me in the loop the whole way. Next, let me show you what it does when something's *already* gone wrong."

**→ Act 3.**

**Ready answers (if asked):**
- *Why did it auto-adopt Press B but not Press A?* — "Confidence. B was at 90%, above the bar; A at 67%, below it. The bar is configurable — you decide where the system's allowed to act on its own. And even the auto-adopt is bounded: it adopts the learned *value*, it didn't rewrite your live plan — applying to the plan was still my re-solve and my commit." (The exact trust line.)
- *So the AI changed my schedule?* — "No. It adopted a value it was confident about. Turning that into a plan was a draft I reviewed, and a commit I made. Three gates, and I held the last two. Your live plan never moved until I committed."
- *Why didn't OEE / on-time move when I committed?* — "Those are execution numbers — they reflect what already ran. This is a forward plan change; it shows up when the wear actually executes. The plan *carries* the wear now; the floor hasn't met it yet."
- *What if I disagree with the auto-adopt?* — "Revert it — it's right there, and it drops into Set-aside like the dismissed one. You're never stuck with what it decided."

**Stage cues / safety:**
- ⚠️ **Reset timing is the #1 risk** — reset 60–90 min before this act (crossing = reset + ~2h). Confirm the crossing is still ahead before going live.
- Numbers to say: **Press A ~67% (asks), Press B ~90% (acted)** — these are the live receipt for the opening's confidence-bar claim. Read them off the screen.
- Quote the screen copy on Set-aside ("re-alerts only if it gets materially worse") — it's well-worded; don't weaken it.
- The committed cockpit KPIs correctly **hold** (backward-looking) — don't claim they move; narrate *why* they hold (ready-answer above).
- No `demo:reset` mid-act — continuous session; Act 1's resolution still stands.
- Recorded fallback not needed here (deterministic UI, no Copilot/LLM call in this act).

## Act 3 — Explain the root: operator diagnosis (Saltillo, SAL-1002 / D-1679)  ✅ verified

> **The beat (verified live):** Order **D-1679** (part **SAL-1002**, Press A) is late. Ask **MAESTRO** "why?" → it returns a real causal chain: **Ana Reyes at 30% of standard → inflated effective cycle time → overruns the open shift window → finishes late.** Then, on a *second* ask, it proposes **5 costed options** (Re-sequence balanced / Assign a faster operator / Minimise changeovers / Add overtime / Protect delivery) with **Faster Operator recommended**, scored on on-time / cost-per-unit / throughput. Apply = draft, same guardrail.
> **Why this is the strongest beat:** the cause is *three steps removed from the symptom* — a slow operator producing a late order, with cycle-inflation and window-overflow in between. Nothing on the press tells you that by eye. This is the "AI reasons, it doesn't just flag" moment, and it's the live proof of the opening's **bounded-LLM** pillar: MAESTRO verbalizes the engine's rationale; it explains, it doesn't decide.
> **Plant:** still **Saltillo** (no switch from Act 2). Continuous session, no reset.
> **Pre-flight confirm:** after Claude's rationale fix — highlight = Faster Operator AND the "why recommended" text underneath explains Faster Operator (not Re-sequence). 10-second check before going live.
> **Continuity (re-verified this session):** Act 3 now follows Act 2's **commit**. SAL-1002 / D-1679 survives the wear commit intact (operator line, independent of the press wear lines) — confirmed still late on the board after Act 2. The rationale-vs-recommendation match is confirmed: rationale argues *for* Assign a faster operator (deciding factor: firm-order lateness), matching the highlight.

**[still on Saltillo; point SAL-1002 / D-1679, late on the board]**
"Same plant, but now a problem that's already here — not predicted, *present*. This order, D-1679, is running late. And here's the thing: looking at the board, you can't tell *why*. The press looks fine. So let me just ask."

**[ask MAESTRO: "why is SAL-1002 at risk?"]**
"This is MAESTRO — the assistant sitting on top of the plan."
**[read MAESTRO's answer from screen]**
"'D-1679 is late because the assigned operator, Ana Reyes, is running at 30% of standard, which inflates the operation's effective cycle time, causing it to overrun the open shift window and finish late.'"

**[let it land]**
"Look at what that actually is. It didn't say 'operator problem' and stop. It traced a chain: a slow operator → the cycle time inflates → the operation runs past the end of its shift → the order finishes late. The cause is three steps away from the symptom. Nobody looking at that press would have seen it. And notice — MAESTRO is *explaining* the plan, not changing it. It reads the engine's reasoning back to me in plain language. It never reaches in and decides."

**[two-step seam — planner drives the second ask]**
"Now I know *why*. So let me ask the obvious next thing."
**[ask MAESTRO to propose options]**
"And it gives me five costed ways to fix it — re-sequence, assign a faster operator, minimise changeovers, add overtime, protect the delivery. Each scored on what it does to on-time, cost per unit, throughput. It recommends assigning a faster operator here — and tells me why that wins over the others."

**[apply the recommended option → draft]**
"I take the recommendation — faster operator — apply, and it's a draft I confirm. Third time you've seen that: it analysed, it recommended, it waited for me."

**[tie-off]**
"So that's the third capability. We reacted to a change. We predicted a problem. And here we *diagnosed* one — root cause in plain language, three steps deep, then a costed fix. The engine does the reasoning; MAESTRO makes it legible; I make the call."

**→ Act 4.**

**Ready answers (if asked):**
- *Is MAESTRO making up that explanation?* — "No — that's the bounded part. MAESTRO doesn't invent causes; it verbalizes the scheduler's own attribution. The engine determined the operator root; MAESTRO put it in a sentence. It can't claim a cause the engine didn't find." (Core bounded-LLM trust line.)
- *Why is Ana at 30%?* — "Could be ramp-up, a new operator, a training gap — the system doesn't judge why, it surfaces the effect and lets you act. Reassigning is one of the five options." (Don't psychoanalyze the operator; keep it operational.)
- *Could it just reassign automatically?* — "It recommends; you confirm. Same as everything else — it proposes, you decide."
- *What does 'Applied' mean in the response?* — (Internal note, not for the room.) It means the remediation *analysis* ran — nothing committed. Don't read that word aloud; it's misleading on screen.

**Stage cues / safety:**
- ★ **Recorded fallback matters most here** — this is the heaviest MAESTRO/LLM beat (two live narration calls). Groq flake risk is highest; have the recorded path ready and rehearsed.
- Quote MAESTRO's explanation from the screen, verbatim — the system saying it is more credible than you saying it.
- Confirm post-fix the rationale text matches the Faster Operator highlight before going live; don't scroll into a mismatched rationale on stage.
- "Applied:" in the options response = analysis only. Don't read it aloud; don't let it imply a commit.
- No `demo:reset` — continuous session; Acts 1–2 drafts still stand.

## Act 4 — The honest boundary: goal-seek meets a material wall (Saltillo, SAL-1004 / D-1680, Press B)  ✅ verified

> **The beat (walked live):** Ask MAESTRO to goal-seek overtime on the firm-at-risk **SAL-1004 / D-1680** (Press B). It scans overtime to the line's cap and returns an **honest no** — *"gated by material availability, not capacity — overtime can't clear it,"* naming the material (**COIL-HSLA-18**) and the real levers (expedite the coil or move the date). The capability isn't "find the number" — it's **knowing when there is no number, and why.**
> **Arc (the closer):** react (1) → predict (2) → diagnose (3) → **know its limits (4).** A system that always returns a confident fix is one operators distrust. This one says "overtime won't help — here's the actual constraint." That's the trust note to end on.
> ⚠️ **PRE-FLIGHT / #1 stage cue:** **specify the line in the prompt** — "how much overtime clears SAL-1004 **on Press Line B**." The bare prompt ("…clears SAL-1004") lets goal-seek resolve to Press *A* (where overtime has headroom) and returns a muddled cross-line answer ("overtime on A doesn't clear it… waiting on material on B"). Naming Line B gives the clean answer. Say the line.

**[SAL-1004 firm at-risk on the board, Press B]**
"One more. This order — SAL-1004 — is firm, and it's at risk. And a planner's first instinct is almost always the same: throw overtime at it. So let me ask the system the question a planner would ask."

**[ask MAESTRO: "how much overtime clears SAL-1004 on Press Line B?"]**
"How much overtime does it take to clear this?"

**[read MAESTRO's answer from screen]**
"And here's what makes this trustworthy. It comes back: *not achievable. The at-risk on Press Line B is gated by material availability, not capacity — overtime can't clear it. It's waiting for material — coil HSLA-18.*"

**[let it land]**
"Think about what it just did. It didn't give me a number to make me feel better. It scanned overtime all the way to the line's limit, found that *no* amount of overtime works — and told me *why*. This isn't a capacity problem. You can throw hours at a capacity problem. You cannot throw hours at a coil that hasn't arrived. The system knows the difference, and it won't pretend otherwise. It points me at the real fix — expedite the material, or move the date — instead of burning overtime money on a problem overtime can't touch."

**[tie-off — the close of the demo body]**
"So that's the whole picture. It caught a change and waited for me. It predicted wear and absorbed it. It diagnosed a slow operator down to the mechanism. And here — it told me the truth about something it *can't* fix, and pointed me at what actually will. It proposes, it predicts, it explains, and it knows its limits. The engine stays in charge, and I stay in control the entire way."

**→ Close.**

**Ready answers (if asked):**
- *So it just gives up?* — "No — it does the opposite of give up. It rules out the wrong fix so you don't waste time on it, and names the right one: expedite COIL-HSLA-18 or re-promise the date. That's more useful than a false 'add 3 hours.'"
- *How does it know it's material and not capacity?* — "The engine knows the order's gated on a component availability date — the coil isn't on site yet. Overtime extends *working time*; it can't conjure material. The scan proves no overtime within the cap closes the gap, and attributes the cause." 
- *Could it expedite the material itself?* — "That's the supply/material-reliability prediction we mentioned — a module on the roadmap. Today it identifies the constraint and the lever; acting on the supplier side is the next module." (Ties to the opening's future-predictor roadmap — keep future-tense.)

**Stage cues / safety:**
- ⚠️ **Name the line in the goal-seek prompt** ("…on Press Line B") — the single thing that makes this beat clean vs muddled. The #1 risk in this act.
- This is a **MAESTRO/LLM call** — recorded fallback ready (second-highest LLM-dependency act after Act 3).
- Quote the screen: "gated by material availability, not capacity" and "COIL-HSLA-18" — the exact words are what make it credible.
- SAL-1004 must be firm at-risk on the board when you reach this act (it's a standing material beat — confirm it survived Acts 1–3 on the continuous session).

## Close — tenant-agnostic platform → the trust spine  ✅ written

> **Job of the close:** zoom out from "you watched scheduling" to "this is one configurable platform," then land on the control line that's been the demo's spine. Calls back to the opening's pillars, closing the frame. **"Tenant-agnostic"** = the architecture claim (one deployed platform, isolated + configured per tenant, no per-customer fork) — say it so it self-glosses for a non-technical listener ("you're a tenant, not a fork").

**[pull back from the board to the whole picture]**
"Let me step back. Everything you just watched — the demand change, the wear prediction, the operator diagnosis, the material wall — that's *one* module: scheduling. And everything it did, it did against *your* rules. The shifts, the constraints, the costs, the confidence bar where the system's allowed to act on its own — none of that is hardcoded. It's configuration."

**[the tenant-agnostic line — self-glossing]**
"Which means this same platform stands up for any plant and any customer, each configured to itself — you're a tenant on one platform, not a custom fork someone has to maintain. Stamping in Saltillo and welding in Ramos run the same engine, tuned to each. And it plugs into the systems you already have — your demand planning, your MES — rather than replacing them."

**[the trust spine — the final word]**
"But the through-line is the one thing I'd want you to remember. Underneath all of it is a deterministic engine that's authoritative and auditable — same inputs, same plan, every decision logged. The AI predicts, it proposes, it explains — and it acts on its own only where you've told it it can, and only in ways you can undo. The engine decides. The AI assists. You stay in control. That's how you put intelligence on a plant floor without giving up the floor."

**[hand-off / stop]**
"That's Perdura — scheduling today, the suite ahead, on a foundation built to carry it. I'd love to walk through what deploying this against your actual operation would look like."

**Ready answers (if asked):**
- *Is each client a separate build?* — "No — one platform, you're a tenant on it. Your configuration, your data, isolated; the engine and the modules are shared. That's what keeps it maintainable as it scales across plants and customers."
- *What's the next module?* — "Quality and yield — for a Tier-1 that's where the money is, and it slots into the same prediction architecture you saw today." (Future-tense; ties to the opening roadmap.)

**Stage cues:**
- Calls back to all five opening pillars (modular, contract/BYO-systems, scalable, configurable, intelligence) — the close *lands* the frame the opening *set*.
- The final spine line ("engine decides, AI assists, you stay in control") is the single sentence to leave in the room. Say it slowly.
- Keep "tenant-agnostic" self-glossed — don't say the jargon bare to a non-technical buyer.
