# Seed scenario — Magna Mexico (the demo's one coherent dataset)

| | |
|---|---|
| **Purpose** | One coherent, plausible, Magna-Mexico-shaped dataset that drives **all six views and the four collisions**, authored against the canonical model. This is the platform's first real dataset — shaped exactly like real ingestion will produce. |
| **Type** | Design + seed authoring. The seed extends the existing `demo:reset` baseline command (one entry point; this becomes the scenario it resets to). |
| **Honesty posture** | Specific and realistic, **presented as an informed guess** — not claimed as Magna's actual data. Plausible to an automotive domain expert; not represented as their real plants/parts/customers. The mechanism is real; the data is an educated placeholder until pilot data replaces it. |

## Non-negotiable principles (from the build)

- **No hardcoding.** The seed populates **inputs**; every displayed figure (KPIs, cost, OEE, variance, counts) **computes** from them through the real path. Seed rates/actuals/demand — never seed the displayed outputs. Replacing this seed with real ingestion touches **no UI, no API** — only rows.
- **Authored against the canonical model.** Every seeded value must be something a real connector (MES/ERP/EDI/HR) could produce. No convenience values a real feed couldn't replicate.
- **One coherent scenario, not per-screen fixtures.** The same order, operator, line, and actuals thread through every view — the GP-1142 in the Cockpit is the same order at-risk on the Scorecard, scheduled on the Board, queued in the Exception Queue. If the data doesn't reconcile across views, the demo fragments.
- **Deterministic + idempotent** via `demo:reset` — same scenario every rehearsal.
- **Plausible, not absurd** — numbers a plant manager reads as "right order of magnitude" without being their actuals.

## Scenario shape (specific, an informed guess — adjust as you like)

**Company / region:** Magna International, Mexico (Coahuila cluster — Saltillo / Ramos Arizpe). Automotive Tier-1 stamping + welding.

**Plants (use realistic Magna-Mexico-style names):**
- **Saltillo Stamping** — body/structural stampings (presses).
- **Ramos Arizpe Assembly/Welding** — weldments / sub-assemblies.
- (a third for plant-group/allocation context if useful — e.g. **Monterrey**.)

**Customers (real OEMs Magna serves in Mexico — for priority tiers, View 5):**
- **GM** (Ramos Arizpe complex) — Tier 1 protect.
- **Stellantis** (Saltillo) — Tier 1 protect.
- secondary (Tier 2/3) for the priority story.

**Resources / lines:** Press lines (e.g. Press Line A/B — stamping), Weld cells (Weld Cell 1/2). Realistic cycle/setup times for stamping/welding. Cost rates (run cost/hr, setup cost, overhead) plausible for the operation type — these drive Tier-B cost-per-unit, so they must be sane (a stamping $/unit a domain expert won't wince at).

**Parts:** specific-ish automotive stampings/weldments (e.g. body bracket, cross-member, reinforcement, welded sub-assembly) with part numbers (FG-1001 etc. or realistic). Physical attributes (material/gauge/colour) that drive changeover. **Specific, labelled as an informed guess.**

**Operators + certifications (drives Workforce, View 3 + Collision 4):** Mexican names. Cert structure with the **leak-test / torque / CMM** certifications. **Coherent cert-gap setup:** the leak-cert operator who is **OUT** next shift creates the gap; a **different** leak-certified operator is **available** to be called in on OT. (Fixes the current Jorge-is-both-out-and-the-fill contradiction.)

**Cost rates (Tier-B, Master-Data-owned):** run_cost_per_hour, setup_cost per resource; overhead_per_unit. Sane for stamping/welding so cost-per-unit computes plausibly.

## The four collisions (the demo's spine — all must be seeded coherently)

The seed must support the demo's four disruption beats, each driven by real seeded data through the real mechanism:
1. **Demand change** — e.g. GM **GP-1142** raised 100→120 (drives Cockpit costed options + Scorecard at-risk + Exception Queue row — **same order everywhere**).
2. **Cycle drift / tool-wear** — Press Line A cycle creeps ~8% (the simulator drift; drives the closed loop, board std→ml, variance, tool-wear flag).
3. **Material shortage / allocation** — a component short forces allocation by priority (Stellantis vs others) — NMA, sign-off (drives Exception Queue allocation row).
4. **Cert gap** — leak-test cert gap from the OUT operator → OT call-in proposal (Workforce + Exception Queue).

Each collision's data must reconcile across every view it appears in.

## Open choices for RG
- **Part specificity:** how specific the parts/part-numbers get (generic "stamped bracket" vs named component families). RG chose **specific, labelled a guess** — confirm the level.
- **Third plant:** include Monterrey (for plant-group/allocation) or keep two for now.
- **Collision timing:** are all four seeded "ready to trigger," or staged in sequence for the run-of-show (staging concern — likely later).

## Done when
- `demo:reset` restores this scenario deterministically; baseline board is all-`std`, 0 learned, no variance.
- Every view draws from it and reconciles (same order/operator/line across Cockpit, Scorecard, Workforce, Exception Queue, Board).
- All four collisions are seeded and trigger through the real mechanism on real seeded inputs.
- Cost/OEE/variance all **compute** (no hardcoded outputs); a domain expert finds the numbers plausible.
- Honesty: the dataset is realistic-but-clearly-illustrative; nothing represents it as Magna's actual data.

---

# Magna de México dataset (BUILT — `demo:reset` restores it; verified)

> Authored against the canonical model (only fields the schema/contracts already expose). **Informed
> guess, clearly illustrative — not Magna's real data.** All displayed figures **compute** from these
> inputs. **Signed off** (parts, cert-gap, cheapest-OT-fill with id tie-break, Monterrey light, timing
> deferred). Build notes applied: **DL-1006 is computed late** (early due date → sequencer flags it,
> never hardcoded); **Collision 3 (`PV-22`) is a staged anchor, not a live mechanism** (tagged in the
> seed; replace when NMA lands). Verified via the API: GP-1142 scheduled, DL-1006 the sole at-risk,
> Ramos leak gap → fill = Jorge (cheapest off-shift), priority tiers correct; baseline all-std, 0 learned.

## Tenant & org
- **Tenant brand:** `Magna de México` (shell brand zone; `logoUrl` null → placeholder).
- **Plants:** `Saltillo Stamping` (Coahuila — presses, body/structural stampings) · `Ramos Arizpe Welding`
  (Coahuila — weld cells + leak-test) · `Monterrey Components` (Nuevo León — breadth/allocation context).
- **Plant group:** `Coahuila cluster` = {Saltillo Stamping, Ramos Arizpe Welding}, `allowsResourceSharing=true`
  (allocation context, Collision 3). Monterrey standalone.
- **Calendar:** one standard two-shift calendar referenced by all resources (shift detail deferred, SKIP-17-ish).

## Customers (priority tiers — View 5) & programs
| Customer | `priority` | Tier (View 5) |
|---|---|---|
| General Motors | `critical` | Tier 1 · protect |
| Stellantis | `critical` | Tier 1 · protect |
| Nissan Mexicana | `high` | Tier 2 · balance |
| Aftermarket / Service Parts | `standard` | Tier 3 · flex |

Programs (firm-fence + optional priority override): `Silverado/Sierra body` (GM), `RAM 1500 underbody` (Stellantis).

## Resources + cost rates (Tier-B, Master-Data-owned)
| Resource | Plant | type | std cycle (min/pc) | std setup (min) | run $/hr | setup $ | overhead $/unit |
|---|---|---|---|---|---|---|---|
| Press Line A | Saltillo | line | 0.30 | 30 | 145 | 130 | 0.65 |
| Press Line B | Saltillo | line | 0.32 | 28 | 140 | 125 | 0.60 |
| Weld Cell 1 | Ramos Arizpe | cell | 1.40 | 22 | 98 | 75 | 0.48 |
| Weld Cell 2 | Ramos Arizpe | cell | 1.45 | 20 | 95 | 70 | 0.45 |

Groups: `Saltillo stamping presses` = {A, B} · `Ramos weld cells` = {1, 2}. *(Cycle/setup/cost = plausible
order-of-magnitude for structural stamping vs sub-assembly welding; illustrative. Stamping cost/unit lands
~$2–4; welded ~$3–6 — domain-plausible.)*

## Parts (specific, informed guess) + changeover drivers
| Part no | Description | type | material / gauge / colour | changeover key | plant | customer |
|---|---|---|---|---|---|---|
| `FG-2001` | Rear floor cross-member | finished | Steel HSLA / 1.5mm / Black | colour | Saltillo | GM (GP-1142) |
| `FG-2002` | B-pillar reinforcement, LH | finished | Steel / 1.2mm / Silver | colour | Saltillo | GM |
| `FG-2004` | Front seat cross-member | finished | Steel / 1.0mm / Black | colour | Saltillo | Nissan / Aftermarket |
| `FG-3001` | Front rail weldment, LH | finished | Steel / 2.0mm / — | material | Ramos Arizpe | Stellantis (ST-8830) |
| `FG-3002` | Rear shock-tower weldment | finished | Steel / 1.8mm / — | material | Ramos Arizpe | Stellantis |
| `PV-22` | Reinforcement gusset (purchased) | component | Steel / 2.0mm / — | — | (supply) | feeds FG-3001 |

Routings: each FG → 1 primary routing (stamped FGs 1 op on the press group; welded FGs 1 op on the weld
group), std times from the resource table. `PV-22` is a purchased component for the Collision-3 shortage
story (BOM/explosion deferred SKIP-45 → no BOM link yet; seeded as the shortage anchor).

## Operators + certifications (Workforce View 3 + Collision 4)
Certs: `LEAK` (Leak test) · `TORQUE` (Torque-critical) · `CMM` (CMM inspection) · `WELD` (MIG/spot weld).

| Operator | Home plant | certs | `available` (next shift) | labor $/hr |
|---|---|---|---|---|
| Luis Cruz | Ramos Arizpe | LEAK, TORQUE | **false (OUT)** | 28.0 |
| Jorge Morales | Ramos Arizpe | LEAK | **false (off-shift, OT fill)** | 26.5 |
| Diego Hernández | Ramos Arizpe | WELD, TORQUE | true | 27.0 |
| María Fuentes | Ramos Arizpe | WELD, CMM | true | 27.5 |
| Bruno García | Ramos Arizpe | CMM | true | 24.5 |
| Ana Reyes | Saltillo | TORQUE | true | 26.0 |
| Sofía Ramírez | Saltillo | TORQUE | true | 25.5 |

**Coherent cert gap (the key fix).** At **Ramos Arizpe** next shift: `LEAK` has **no available certified
operator** — Luis Cruz (the regular leak operator) is **OUT** → the gap. The other certs are covered by
present staff (TORQUE→Diego, CMM→María/Bruno, WELD→Diego/María), so it's a **single, clean leak gap**
(readiness 3/4 stations). The **OT call-in fill is a *different* operator, Jorge Morales** — leak-certified,
off-shift, callable. This removes the prior contradiction (one operator who was both the absence and the fill).

**Small accompanying logic refinement (flagged for approval):** the coverage fill currently picks the *first*
qualified operator. To name the fill coherently it should pick the **cheapest off-shift qualified operator**
(`!available`, min `laborRate`, tie-break name) → Jorge ($26.5) over Luis ($28.0). Deterministic + a sane
"cheapest OT call-in" rule; ~2 lines in `SchedulingService.coverage`. Data-only if RG prefers, but then the
fill is list-order-dependent.

## Demand lines (the schedule + the four collisions)
**Saltillo (presses):**
| ref | customer | part | qty | firmness | due | role |
|---|---|---|---|---|---|---|
| `GP-1142` | GM | FG-2001 (Black) | 100 | firm | Mon | **Collision 1** — raised 100→120 live |
| `DL-1002` | GM | FG-2002 (Silver) | 80 | firm | Mon | changeover variety |
| `DL-1003` | Nissan | FG-2004 (Black) | 120 | forecast | Tue | tier-2 forecast |
| `DL-1004` | GM | FG-2001 (Black) | 60 | firm | Wed | |
| `DL-1005` | Aftermarket | FG-2004 (Black) | 40 | forecast | Tue | tier-3 flex |
| `DL-1006` | GM | FG-2002 (Silver) | 70 | firm | (early) | seeded **at-risk (late)** |

**Ramos Arizpe (weld):**
| ref | customer | part | qty | firmness | due | role |
|---|---|---|---|---|---|---|
| `ST-8830` | Stellantis | FG-3001 | 90 | firm | Tue | **Collision 3** — slips if PV-22 short (priority allocation) |
| `DL-2002` | Stellantis | FG-3002 | 60 | firm | Wed | |

## Collision wiring (each reconciles across the views it appears in)
1. **Demand change — `GP-1142` (GM, FG-2001, Saltillo).** Same order on the Board (FG-2001 bars), Scorecard
   at-risk, Cockpit options, Exception Queue (4–5). Seeded @100 firm; the 100→120 raise is the live what-if.
2. **Cycle drift — Press Line A (Saltillo).** The dev simulator drifts its cycle ~8% → closed loop → board
   `std→ml`, variance "behind plan", tool-wear flag, stale-plan signal. Real mechanism on seeded data.
3. **Material shortage — `PV-22` short → Stellantis `ST-8830` (FG-3001).** Allocation by priority (Stellantis
   Tier-1). NMA is deferred (SKIP-13) → seeded as the data anchor + Exception-Queue row (4–5); not auto-run now.
4. **Cert gap — Ramos Arizpe `LEAK`.** Luis OUT → gap; call in Jorge on OT (Workforce confirmed proposal +
   Exception Queue 4–5). Single clean gap; fill is a distinct operator.

## RG open choices (in this draft)
- **Part specificity:** specific named components + `FG-2xxx`/`FG-3xxx`/`PV-22` numbering, labelled a guess (per RG). Confirm the level.
- **Third plant:** Monterrey **included** (selector breadth + allocation context), light (no resources yet).
- **Collision timing:** all four seeded "ready to trigger" (drift via the dev simulator; demand-raise/allocation are live/phase-4–5). Run-of-show staging deferred.
