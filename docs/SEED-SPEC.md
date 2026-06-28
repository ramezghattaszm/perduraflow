# PerduraFlow — demo seed specification (Magna Coahuila)

> **Purpose:** the deterministic seed spec for the Magna-Mexico demo. All decisions locked in the seed-design session. The seed must be **deterministic**, **rolling-window-anchored** (relative to `today`, NOT pinned to a fixed date — survives `demo:reset` on any day), and verified to render correctly **as if today = Monday June 29, 2026** (the demo date — rehearsals before then must also work, which is why it's rolling).

---

## 1. Plants (2 — real Coahuila cities, Option A: keep built processes)
- **Saltillo Stamping** — Press A, Press B (+ dies/tooling for the wear beat).
- **Ramos Arizpe Welding** — Weld Cell 1, Weld Cell 2, Leak-Test.

Both real Magna locations in Coahuila. Processes (stamping, welding) are real automotive processes Magna runs; not chasing exact division accuracy (real Saltillo is composites) — Option A keeps the built demo beats.

## 2. Customers (real Magna-Mexico OEMs, coherent per plant)
- **Saltillo Stamping** → **GM** (Silverado/Sierra, T1XX) + **Stellantis** (Ram, DT).
- **Ramos Arizpe Welding** → **GM-Ramos** (Blazer/Equinox — the **JIT/JIS anchor**: GM runs an assembly plant *in* Ramos Arizpe, so a Magna welding plant feeding it next-door is real and ideal for the sequenced-pull story) + **VW/Audi** (Tiguan / Q-series).

Use plausible-but-fictional customer part numbers (don't copy real GM/Stellantis numbers); MD9 cross-reference just needs *a* `customer_part_no → part_no` mapping.

## 3. Parts (10 — independent per plant, no cross-plant make-component)

### Saltillo Stamping (6)
| part_no | customer | program | resource | material gate | beat anchor |
|---|---|---|---|---|---|
| SAL-1001 | GM | Silverado/Sierra | Press A | steel coil (HSLA) | **tool-wear** (die nearing stroke limit) |
| SAL-1002 | GM | Silverado/Sierra | Press A | steel coil | **operator-performance** (tight order, Ana 0.30) |
| SAL-1003 | GM | Silverado/Sierra | Press B | steel coil | — (Press B load) |
| SAL-1004 | Stellantis | Ram | Press B | steel coil | **material gate** (honest-unachievable) |
| SAL-1005 | Stellantis | Ram | Press B | steel coil | — |
| SAL-1006 | GM | Silverado/Sierra | Press A | steel coil | — (Press A load) |

### Ramos Arizpe Welding (4)
| part_no | customer | program | resource | material gate | beat anchor |
|---|---|---|---|---|---|
| RAM-2001 | GM-Ramos | Blazer/Equinox | Weld Cell 1 → Leak-Test | stamped + purchased comps | **at-risk anchor** (tight JIT) |
| RAM-2002 | GM-Ramos | Blazer/Equinox | Weld Cell 1 → Leak-Test | comps | **line-down** (reroute to Cell 2 / OT) |
| RAM-2003 | VW/Audi | Tiguan / Q-series | Weld Cell 2 → Leak-Test | comps | — (leak-test flow) |
| RAM-2004 | VW/Audi | Tiguan / Q-series | Weld Cell 2 → Leak-Test | comps | — |

**Routing:** RAM-2001 and RAM-2002 must be routable on **both** Weld Cell 1 and Cell 2 (so the line-down reroute target exists). All Ramos welds route → Leak-Test (the shared inspection-station constraint).

## 4. Shifts / calendar
- **2 shifts × 10h = 1,200 min/day**, **5 working days/week** (Mon–Fri). Both plants same model.
- Weekends (Sat/Sun) closed = OT/exception headroom; the 4h gap to midnight each day = same-day OT headroom.
- **Holidays:** the holiday model is seeded (date-specific exception rows per the constraint audit — the base for the future "open a closed window" lever), but **NO Mexican statutory holiday falls in the demo window** (Jun 8 – Jul 17, 2026). The 2026 statutory holidays cluster early-year (Constitution Day Feb 2, Benito Juárez Mar 16, Holy Week late Mar/early Apr) and late-year (Revolution Day Nov 16); Father's Day Jun 21 is a festividad, not a day off, and outside the window regardless. So the working calendar is a **uniform run of Mon–Fri working days** across all 6 weeks — no closed-day gap confounding the collisions. Clean.

## 4b. Operators / roster (external/fed-in; scheduler does crew→line allocation, not who-works)
Realistic Mexican names (Coahuila plants). Most operators at ~1.00 perf so the plant runs normally; only **Ana is the deliberate outlier** for the operator beat, and **Mateo is the faster-pricier lever**.

### Saltillo Stamping
| Operator | Home line | Perf | Labor rate | Role |
|---|---|---|---|---|
| **Ana Reyes** | Press A | **0.30** | ~$28/h | **operator beat** — slow operator on SAL-1002 (the forcing function) |
| **Mateo Ríos** | Press A | **1.05** | **$31.5/h** | **faster-pricier lever** — clears faster, costs more (cost-as-objective has teeth) |
| Carlos Méndez | Press A | 1.00 | $28/h | Press A 2nd shift |
| Sofía Torres | Press B | 1.00 | $28/h | Press B |
| Diego Ramírez | Press B | 0.98 | $27/h | Press B 2nd shift |

### Ramos Welding
| Operator | Home line | Perf | Labor rate | Role |
|---|---|---|---|---|
| Lucía Fernández | Weld Cell 1 | 1.00 | $26/h | Cell 1 |
| Javier Morales | Weld Cell 1 | 1.00 | $26/h | Cell 1 2nd shift |
| Valentina Cruz | Weld Cell 2 | 1.00 | $26/h | Cell 2 |
| Andrés Vargas | Weld Cell 2 | 0.97 | $25/h | Cell 2 2nd shift |
| Camila Reyes | Leak-Test | 1.00 | $24/h | inspection station |

**Notes:**
- **Ana @ 0.30 is deliberately extreme** (a real 30%-of-standard operator would be pulled). It's the forcing function for the operator root (SAL-1002's op must overflow its OWN window). Talk-track framing: "a new/struggling operator" or "operator-equipment mismatch" so it reads plausibly.
- **Mateo @ 1.05 / $31.5** is faster AND pricier — so when SAL-1002 is operator-late, "swap to Mateo" clears it faster but costs more, giving the cost objective real teeth in the remediation choice.
- 10 active operators total — enough to staff 2 shifts across 5 resources per plant.

### Operators OUT this window (realism — a real plant always has absences; reinforces roster = EXTERNAL/fed-in)
| Operator | Home line | Status | Notes |
|---|---|---|---|
| **Fernando Castro** | Press A | **On vacation** (whole window) | Planned absence. Press A is short a body → makes Ana's slowness MORE consequential (less coverage to absorb it) — ties the absence to the operator beat. |
| **Patricia Gómez** | Weld Cell 2 | **Sick** (same-window) | Rostered but out sick. |
| **Roberto Salinas** | Press B | **Unassigned / no shift** | On the books, not rostered to a shift this window (a float not scheduled). |

These exist in the master operator pool but are NOT in the available roster for the window. They demonstrate the **roster boundary**: who's present is external (fed in); the scheduler allocates among the PRESENT crew — it doesn't decide who shows up. Talk-track: "Fernando's on vacation, Patricia's out sick, Roberto's unassigned this week — the schedule runs on the available crew."

### Holiday (a closed-day to demonstrate the holiday model + a "compressed week" beat)
- **Friday, July 10, 2026** (≈ today+11d, week 2 of the forward window) — seed a **calendar closed-exception** (date-specific closed row, both plants).
- **Why this date:** a weekday (visibly closed on the Gantt), in week 2 (PAST the week-1 beat cluster, so it doesn't confound operator/material/at-risk), creating a long weekend (Fri+Sat+Sun). Narrate as whatever fits ("regional holiday," "plant shutdown day").
- **What it demonstrates:** the holiday constraint **firing live** (earlier finding: no statutory holiday naturally falls in the window, so the model was seeded-but-not-firing — July 10 makes it actually close a day and the schedule work around it). Talk-track: "holiday Friday the 10th → that week's capacity compresses → watch the schedule front-load to absorb it." Also the symmetric base for the future "open a closed window" lever (roadmap talk-track).
- **Note:** July 10 is rolling-anchored as today+11d (so it moves with the window); for the Jun 29 demo it lands on Fri Jul 10. If pinning vs. rolling matters for the holiday specifically, confirm — a holiday is arguably a fixed calendar date (Jul 10) rather than a rolling offset. **Recommend: pin the holiday to the absolute date (Jul 10) but ensure it always falls in the forward window for the demo date; for rehearsals on other days it stays Jul 10.**

## 5. Demand quantities (back-solved to utilization targets)

**Available regular minutes/resource:** 1,200/day × 5 = 6,000/wk → 18,000 over the 3-week forward window.

**Utilization targets (by construction) — uneven by design:**
| Resource | Util target | Target min/wk | ~Orders/wk | Role |
|---|---|---|---|---|
| Press A | **85%** (hot) | 5,100 | ~31 | beat-pressure (operator + wear) |
| Press B | **70%** (mod) | 4,200 | ~25 | escape valve (reroute/overflow) |
| Weld Cell 1 | **80%** (hot) | 4,800 | ~29 | line-down target |
| Weld Cell 2 | **68%** (mod) | 4,080 | ~25 | reroute headroom |
| Leak-Test | **~67%** (shared) | ~3,900 | (test tails) | real shared constraint, not bottleneck |

**Plant-wide ~78–80%; FLOOR at ~60% (nothing looks idle).**

**Order shape — many small (realistic):**
- Stamping: cycle ~45 sec/part, lots ~150–250 → order ≈ setup(20min)+(200×0.75) ≈ **~165 min (~2.75h)**.
- Welding: cycle ~3 min/assembly, lots ~40–60 → ≈ setup(15min)+(50×3) ≈ **~165 min (~2.75h)**.
- Leak-test: ~1.5 min/part, runs as the test-op tail of each weld order.
- **~110 orders/week total** (~56 Saltillo + ~54 Ramos); ~330+320 across the 6-week window.

**Two demand patterns:**
- **GM-Ramos (RAM-2001/2002) = JIS/JIT sequenced** — the tightest cadence: ~3 small sequenced releases/day, tight windows, **no buffer** (this is what makes RAM-2001 the at-risk anchor).
- **Everyone else (stampings, VW welds) = EDI/bucketed** — steadier, slightly larger, longer windows (the baseline load).

**Rehearsal flag:** if the dense Gantt reads as noise, dial order-size UP a notch (fewer/larger, same utilization) for legibility — a visual call at rehearsal.

## 6. Time window (rolling, relative to `today`; verify as-if Mon June 29)
- **Past executed:** ~today−21d → today−1d (≈ Jun 8–26) — actuals/OEE/cost history. Loaded to realistic util so historical OEE/cost trends look like a running plant.
- **Today:** the reference (demo: Mon Jun 29).
- **Future plan:** today → today+21d (≈ Jun 29–Jul 17). Firm/hot in week 1 (beats fire ~Jun 29–Jul 3); planned/looser by week 3.

## 7. Standing beat collisions (seeded, rolling-anchored, SPINE must stay intact)

| Beat | Part | Type | Timing (rel. today) | Root / mechanism |
|---|---|---|---|---|
| **Operator** | SAL-1002 | standing firm | due ~+1d (Tue) evening | **Ana Reyes @ 0.30 on Press A** → inflated cycle → that op overflows its window → **operator root** (binding ∈ working_window, perf<1). Press A must stay **sub-saturated** so it roots operator, NOT capacity. |
| **Tool-wear** | SAL-1001 (die) | standing | predicted crossing ~+3d | die cumulative strokes seeded so predicted-limit crossing lands ~3 days out (visible runway, not already-crossed) → advisory "approaching limit, maintenance ~+3d" → propose maintenance. Advisory/predictive (NOT a hard cap — per the constraint audit). |
| **Material (honest-no)** | SAL-1004 | standing firm | due ~+2d (Wed) | steel-coil `availableAt` set late enough that **even full OT can't pull the finish before the due** → goal-seek returns **unachievable**, attributes to **material** ("expedite or re-promise," not capacity). The ST-8830 pattern. |
| **At-risk anchor** | RAM-2001 | standing firm, **tight** | due ~+1–2d | tightest JIT, no buffer. On the HEALTHY baseline: on-time-but-tight (~no slack). Goes **at-risk under perturbation** (line-down or demand-change) → the two-door remediation target. |

### Injected beats (launcher presets — NOT standing; baseline opens healthy)
| Beat | Mechanism |
|---|---|
| **Line-down** | `resource_downtime` on Weld Cell 1 → RAM-2002 reroutes to Cell 2 (68% headroom) / OT → reroute-vs-OT what-if. |
| **Demand-change** | calibrated qty **increase** on a GM-Ramos part (RAM-2001/2002) → engine surfaces **3 options** (min-changeover / balanced / protect-delivery) → Copilot **4th option** ("give me a fourth option using overtime"). Calibrated to the option-generating band (not absorbed, not infeasible). |
| **Goal-seek achieved (rush-surge)** | inject several firm press orders due today-evening → saturate a press line to close → marginal order overflows ~2h → goal-seek returns minimal achievable OT (two-sided) → apply. |

### Spine layout (spread across resources so they don't collide)
- **Press A:** 2 standing beats (operator SAL-1002, wear SAL-1001) — **distinct ops**, must NOT entangle.
- **Press B:** 1 standing beat (material SAL-1004).
- **Ramos:** 1 standing beat (at-risk RAM-2001).

## 8. Verification checks (the build must pass these)

1. **Utilization lands on target** — Press A ~85%, Press B ~70%, Cell 1 ~80%, Cell 2 ~68%, leak-test ~67%, plant-wide ~78–80%, nothing < 60%. (The whole point — no sparse/idle look.)
2. **Operator root fires CLEANLY** — "why is SAL-1002 late?" → **operator** root (not capacity), with the HOW-narration ("Ana at 30% → inflated cycle → window overflow → late"). **Press A must stay sub-saturated** despite carrying 2 beats + 85% load — verify the operator root isn't masked by a capacity root. *(The known calibration risk — flagged.)*
3. **Wear and operator stay DISTINCT** — SAL-1001 (wear) and SAL-1002 (operator) are separate ops on Press A; the wear beat must not tip the operator root or vice versa.
4. **Material honest-no holds** — "how much OT clears SAL-1004?" → unachievable, **material** root ("expedite/re-promise"), distinct from any capacity case. Full-OT scan still can't meet the due.
5. **At-risk anchor is tight-not-late on baseline** — RAM-2001 on-time-but-tight when healthy; goes at-risk under line-down / demand-change.
6. **Rolling anchor** — every collision specified relative to `today`; `demo:reset` on any day reproduces the same relative state. Verify as-if today = Mon Jun 29 (and that a rehearsal on Jun 27/28 also renders correctly).
7. **Injected beats are induced-only** — line-down / demand-change / rush-surge fire on click, gone on reset; baseline opens healthy (no standing catastrophe).
8. **Historical window populated** — past 3 weeks of executed actuals exist (for cockpit historical OEE, cost baseline, scorecard reconciliation), at realistic util.
9. **Determinism** — no `Date.now()` inside the builder (clock-injected); same seed → byte-identical state; survives the rolling window.
10. **Spine intact** — the 4 standing collisions coexist without disturbing each other or the baseline; no stray firm at-risk beyond the intended anchors.

## 9. Open calibration risk (the one to watch)
**Press A carries two standing beats (operator + wear) on top of 85% baseline load.** The operator root REQUIRES Press A sub-saturated (per the tuning finding: a global slowdown roots at capacity; only a specific tight order overflowing its OWN window roots at operator). Carrying 2 beats + high load risks tipping Press A into a capacity root, masking the operator root. **Verify at build:** SAL-1002 roots operator cleanly; if it roots capacity, reduce Press A baseline load slightly (e.g. 80%) or move the wear beat's heavy ops off the operator order's day, until the operator root fires. This is the known finicky calibration — build it, verify the root, tune if needed.
