# Perdura — Production Readiness Plan (Magna deployment)

> Grounded in: production-scheduling functional spec (D1–D51, contracts 4.1–4.11, Q1–Q26), Master Data spec (MD1–MD14), Net-requirements spec (NR1–NR12), Network Material Allocation spec (NMA1–NMA10), platform-architecture spec (A-series, O-rules), api-spec (SKIP-*).
> **Confidence note:** functional/data scope is well-grounded. UI-ARCHITECTURE not fully re-read this session — UI-depth estimates are lighter-confidence. Deployment/topology mechanics depend on **AQ1** (open).
> **Framing:** the demo proved the deterministic kernel + AI-assist loop on a *seeded single-plant scenario*. Production for Magna needs (a) the master-data foundation, (b) the automotive scheduling constraints that are decided-but-unbuilt, (c) real integrations, (d) the modules the scheduler consumes via contract, and (e) resolution of ~26 client-discovery questions that *size* much of the above.

---

## The central insight: this is a PLATFORM, not a Magna project — the questions are mostly OUR design decisions, and the client answers become CONFIGURATION, not build

The Q-series looks like "client discovery," but that framing is a distortion. **The majority are platform-design decisions we make once, for every client** — "how should the platform *handle* this?" — answered by us, baked into a **configurable capability with a safe default (D48)**. A much smaller set are **tenant-configuration values** a client supplies at onboarding (config, not code). Only the genuine **integration connectors** to a specific client's systems are per-client *build*.

So Magna onboarding is **"answer the tenant-config questions from Magna's perspective and configure the platform"** — *not* build it. Getting this right de-risks the timeline: we are **not blocked waiting on Magna** for the majority; we make those calls now.

**Three buckets:**
- **[P] Platform-design** — we decide, we build the configurable capability + safe default. Answered now, by us.
- **[T] Tenant-config** — client supplies a value/rule/source at onboarding; set via the config surfaces (Phase 2A). No build.
- **[I] Per-client integration** — genuine engineering to connect a specific client's system.

### Q-series classified

| Q | Topic | Bucket | What it means for the build |
|---|---|---|---|
| Q1 | Does demand source already net? | **T** (+[P] the netting capability) | Build net-requirements as a **bypassable** module (NR9); tenant binds it in or out. |
| Q2 | Part numbering across plants | **T** | Mapping table is built (D12); tenant populates it (shared vs per-plant). |
| Q3 | Planning cadence + firm-window per customer | **P**+**T** | Build telescoping buckets (D22) + per-customer fence (D23); tenant sets values. |
| Q4 | Which situations need human approval | **P**+**T** | Build approval-rules engine (D25) with rule *types*; tenant sets its rule set + thresholds. |
| Q5 | Approval authority / tiers | **T** | Tiers configurable (D25); tenant defines roles→tiers. |
| Q6 | Where auto-approve is allowed | **T** | Per-rule/tier auto-commit config (D26); conservative default; tenant relaxes over time. |
| Q7 | Lot-sizing practice + defaults | **P**+**T** | Build methods + modifiers (D27); tenant sets per-part policy; ship safe default. |
| Q8 | Process batch multiples / pack data | **T** | `lot_multiple`/`round_to_pack` are config values (D27); tenant supplies. |
| Q9 | Mandatory sequencing / campaign rules | **P**+**T** | Build the 4 hard-rule types (D28); tenant configures its actual rules per resource group. |
| Q10 | Labor-paced vs machine-paced, skills, ratios | **P**+**T** | Build selective labor constraint (D29); tenant flags ops + supplies ratios/skills. |
| Q11 | Labor shortfall levers + temp tiers | **P**+**T** | Build OT/temp-tier leveling (D30/D31); tenant configures pools + authorizers. |
| Q12 | Demand pre-allocated to plant? | **P** (design assumption) | Platform assumes plant-allocated demand (D32); cross-plant sourcing explicitly out. Confirm, don't build. |
| Q13 | Role structure on the floor | **T** | Roles configurable (D33); tenant maps its org to seeded defaults. |
| Q14 | Devices used / print artifacts | **P**+**T** | Build device tiers + print (D34); tenant maps roles→devices. |
| Q15 | Master-data source systems / SoR stance | **I**+**T** | Build connector/upload/native modes (D35); **integration to client's actual SAP/PLM is per-client [I]**; SoR stance is [T]. |
| Q16 | Material/inventory + receipts source | **I**+**T** | Material gate built (D36); **feed to their inventory/receipts system is [I]**; reliability/staleness handling is [P]. |
| Q17 | Made sub-assemblies as distinct parts? | **P** | Build multi-level dependent-demand scheduling (D37); tenant's BOM data configures whether it's exercised. |
| Q18 | Made components pegged vs stock | **P**+**T** | Support both (D37); per-component config. |
| Q19 | Mixed UoM + conversion factors | **P**+**T** | Build UoM normalization (D40); tenant supplies factors. |
| Q20 | Which KPIs / thresholds | **T** | Build KPI-threshold policy on the config cascade; tenant sets values; ship Tier-1 defaults. |
| Q21 | Alert events / recipients / channels | **P**+**T** | Build alert-rule engine (D42); tenant configures event→recipient→channel. |
| Q22 | Workforce/HR system for labor pool | **I**+**T** | Labor-pool consumption built (D43); **integration to their HR system is [I]**. |
| Q23 | Retention CSRs / longest period | **T** | Retention configurable (D46); tenant sets to its longest CSR; long safe default. |
| Q24 | Real cross-plant resource sharing? | **P**+**T** | Build cluster-shared pools (D49) as a **toggle**; tenant enables + scopes. Off by default. |
| Q25 | Shared-material contracting / transfers | **P**+**T** | Build network-allocation (NMA) as an **optional module + transfer lever**; tenant enables per cluster. |
| Q26 | EV demand/release pattern differences | **P** | Confirm existing `demand_type`/fence model covers it; extend only if a pattern doesn't fit. |

**Read of the table:** the overwhelming majority are **[P] build-once** and **[T] configure-per-tenant** — answered by *us*, now, as product design, client supplying values at onboarding. Only **Q15 / Q16 / Q22 carry genuine per-client [I] integration** (their specific SAP / inventory / HR systems). **We are not blocked on Magna for the core build** — we make the platform decisions now and build the configurable capabilities + the config surfaces that consume them.

**Consequence:** the phases below build **configurable capabilities + safe defaults**, and a dedicated **Phase 2A (Configuration Surfaces)** builds the mechanisms that make "configure, don't build" real. A short **Tenant-Onboarding** track (not a build phase) covers setting Magna's [T] values and building the [I] connectors.

> **AQ1** (deployment topology — single-tenant-in-client-cloud vs shared SaaS) remains a genuine open **platform** decision (ours), gating Kafka/scale/isolation mechanics — not a Magna question.

---

## Phase 1 — Foundation (no client dependency; start immediately)

### 1a. Master Data module — THE dependency root
Spec-complete (MD1–MD14 Agreed), **not built.** Net-requirements and scheduling **cannot operate in production without it** (MD "dependency root"). Today the scheduler owns parts/BOM/attributes/assets inline; the spec moves them to Master Data as the `part`, `bom`, `asset` contracts.
- Part master (global-within-tenant identity, D12), plant-part & customer-part mapping (MD9), BOM (multi-level topology, MD5), UoM conversion (MD4/D40), physical attributes (MD11), **asset domain** (tooling + machines/resources/resource-groups — MD10/MD14, moved *out* of scheduling).
- Domain services: **effectivity resolution** (MD3/D10 — resolve as-of scheduled date, not "current"), cross-ref resolution, BOM where-used/explosion, completeness/integrity validation (MD8/D45).
- Revision & change control (ECN/ECR, never-edit-in-place, MD6); retention floor (life+15yr, D46).
- SoR modes: connector / upload / native (MD7/D35).
- ⚠️ This is a **migration** as much as a build — parts/assets currently live in scheduling and must move behind contracts without breaking the scheduler (the O2/O3 boundary makes this enforceable but real work).

### 1b. Effectivity dating end-to-end (D10)
The scheduler must resolve master data at the **scheduled date**, not current — foundational for IATF reconstructability. Consumes MD3. Threads through the audit trace (`master_data_asof`, 4.6).

### 1c. Compliance spine (IATF 16949) — D6 / Section 7
- Decision/audit trace (4.6) as the compliance projection of an optimizer run — **contract exists, production-grade capture doesn't.** Log model versions, objective/constraints, master-data as-of, any LLM interaction that influenced a committed plan.
- Long retention (D46 — life+15yr default, per-tenant/customer to the longest CSR; Q23 confirms the bar).
- Data-quality validation (D45) — hold + surface, never silently mis-schedule.

---

## Phase 2 — Core scheduling completeness (decided-but-unbuilt automotive constraints)

These are **D-series Agreed** decisions the demo never exercised. A real Magna stamping/welding operation needs them.

### 2a. Changeover & sequencing (D8 / D28 / D39)
- **Sequence-dependent changeover matrix** keyed on attribute transitions (D8) — the CONSTRAINT-INVENTORY audit confirmed *not built* (switch-count only today). Setup combination = replace-with-fallback (D39).
- **Hard sequencing rules** (D28) — four types: required-ordering, contiguity, forbidden-transition (with cleanout), max-consecutive. Per resource-group + per-tenant. **Not built.** These are the paint/material-campaign/cleanout rules that cause scrap if violated — core automotive.
- **Campaigning** as an optimizer soft-tradeoff (D28) — objective weighting.

### 2b. Tool-life as a hard constraint (D9)
Tooling is a first-class finite resource with eligibility, tool-life cap, single-location. Today tool-life is **advisory only** (the demo's wear prediction). Production needs the **hard cap** (a die can't run past its life; can't be in two places at once).

### 2c. Multi-level BOM / dependent-demand scheduling (D37)
BOM explosion → dependent demand for `make` components → hard precedence (parent can't start before made component available) → component-level netting → lot-sizing per level. **Not built.** Exercised heavily or lightly depending on Q17/Q18.

### 2d. Material availability hard gate (D36 / 4.8)
Explode BOM against planned qty, check component/raw availability over time vs on-hand + inbound receipts (confirmed-vs-expected). Unmet → infeasible → at-risk. The demo *seeds* a material gate (SAL-1004); production needs the real BOM-exploded gate against a live materials feed (Q16).

### 2e. Lot-sizing policies (D27)
Per-part(-plant) base method (lot-for-lot / fixed-period) + stackable modifiers (min lot, multiple, pack rounding, max lot). Tool-life cap on top. **Not built** (demo runs lot-for-lot implicitly).

### 2f. Alternate routings (D11)
Primary + alternates with preference/cost, for bottleneck relief / routing around downed machines. Partially present (the demo's reroute), needs the general model.

### 2g. Labor as a selective finite constraint (D29 / D30 / D31 / D43)
Labor pools by skill/shift (not individual operators), setup-vs-run labor, `labor_constrained` ops, temp-labor tiers (pre-qualified pool → new-hire lead time), labor requirements feedback to capacity (4.7). **Not built.** Gated on Q22 (labor-pool source).

### 2h. Nervousness control / stability-biased rescheduling (D44)
Local repair over full re-sequence, never move in-progress, protect the stability window (current + next shift), surface the delta. **Not built** as a general capability — critical for planner trust in production.

---

## Phase 2A — Configuration Surfaces (FIRST-CLASS — this is what makes "configure, don't build" real)

Every [T] question above resolves to *config*, not code — which is only true if the surfaces to hold that config exist. These are the mechanism of the platform promise; without them, "configure per tenant" is a slogan. The config **cascade already exists** (defaults→tenant→plant, audited, hosting reporting/objective policy) — these build **on** it.

- **Constraints control panel** (elevated from tracked-low-priority) — one admin surface to configure the operating model: enable/disable constraints, set parameters (OT caps, min-batch, working days, stability window D44, scheduling horizon D47), objective weights (campaigning aggressiveness D28). ⚠️ Audit finding: real on/off *toggles* barely exist today (only `boundedAuto` is engine-honored; most constraints are parameterized-but-always-on; min-batch has no admin write-path). So this is genuine build, not just a screen. Cheapest compelling version surfaces the already-configurable knobs (weights, window, OT cap, calendar) and adds toggles incrementally.
- **Approval-rules engine** (D25/D26) — configurable risk triggers (customer_delivery_risk, proposal_source, override_lever, ml_reliance, disruption_magnitude) → approval tiers, per-rule auto-commit. Answers Q4/Q5/Q6 as config. The demo's confidence gate is a hardcoded slice of this; the general engine is the build.
- **Binding resolver — connector/upload modes** (O7/D35) — native + platform_module modes exist; **connector and upload are production work.** This is what lets a tenant point a contract at their system (or a file, or native maintenance) as config. The mechanism behind every [I] and many [T] answers.
- **KPI-threshold policy** (D42/Q20) — new domain on the config cascade (defaults→tenant→plant, audited), beside reporting/objective policy. First slice designed in the 902 spec.
- **Alert/notification rules** (D42/Q21) — event→recipient→channel config.
- **Config governance depth** (D42) — effectivity-dated + audited config; a config change affecting a committed schedule produces a reschedule proposal through the guardrail (not auto-apply).
- **Roles/RBAC config** (D33) — seeded defaults + per-tenant rename/add/remove (also in Phase 6; the *config surface* for it lives here).

> **Why first-class:** [T] answers for Magna (and every future tenant) are only "configuration, not build" if these surfaces exist. This phase is the difference between a platform and a bespoke install. Safe defaults (D48) ship with each so a tenant runs install-and-go and tunes only what differs.

---

## Phase 3 — The consumed modules (contract-defined, per-tenant binding)

The scheduler consumes these via contract; for Magna each **binding** must resolve to something real (their system via connector, or a built module). Build vs bind is a per-tenant/discovery decision.

- **Net-requirements module** (NR1–NR12, spec-complete, not built) — finished-good/independent-demand netting, CUM-aware (NR3), firmness-preserving, delta-first. **Bypassable (NR9)** if Magna's demand system already nets → **Q1 decides build-or-skip.**
- **Capacity planning module** (D15/D16) — the envelope + leveling guidance; boundary defined, module external. Magna may have one; confirm the binding.
- **Network material allocation module** (NMA1–NMA10, spec-complete, not built) — splits shared material across a cluster (the Coahuila steel story). **Only needed if cross-plant material sharing is real (Q24/Q25).**
- **Demand planning** — external, exists (Magna's). Perdura consumes; confirm the contract/format (EDI 830/862/866).

---

## Phase 4 — Integration (likely the long pole)

None built (demo uses the simulator = `native` binding). Per D35, three modes per system per tenant: connector / upload / native.
- **ERP / SAP** — parts, BOM, inventory, receipts (systems of record).
- **MES** — shop-floor execution + status + actuals (the real actuals feed that replaces the simulator; the grain-aware ingestion boundary built this session is the seam — SKIP-51).
- **EDI / customer portal** — demand releases (830 planning / 862 firm / 866 sequenced JIT).
- **PLM** — engineering change (ECN/ECR → effectivity).
- **Workforce / HR** — labor-pool availability (Q22).
- The **binding resolver** (O7) is partially built (native/platform_module modes); connector + upload modes are production work.

---

## Phase 5 — Platform & AI depth

- **AI-performance surface / graduated-autonomy track record** — contract **4.11 (proposal disposition record)** is *specified as a founding contract* (full ranked option set + human disposition + selected-vs-top). This is what makes autonomy *earned from track record* (A16) rather than only configured. Capture is largely unbuilt (the demo's autonomy is confidence-gated, not track-record-earned). Feeds AI-performance KPIs (14.2), preference learning (A17).
- **Tiered approval rules engine** (D25/D26, 5.5) — configurable risk triggers (customer_delivery_risk, proposal_source, override_lever, ml_reliance, disruption_magnitude) routing to approval tiers; per-tenant. Partially embodied in the demo's confidence gate; the general rules engine is unbuilt.
- **Yield/Quality module** (D3 target 4) — the #1 deferred gap; engine assumes 100% yield, OEE quality leg seeded not modeled. Note NR11 wants to *reuse* this model — so it unblocks net-requirements' WIP-yield too.
- **902 Performance dashboard** — spec'd + instruction-ready this session; not built. Gated partly on Q20 (thresholds → the config cascade, first slice already designed).
- **Constraints control panel** (tracked low-priority) — admin UI for the constraints/rules/weights that Phase 2 introduces; becomes more valuable once 2a/2b/2g exist to configure.
- **Config governance depth** (D42) — effectivity-dated, audited config; a config change affecting a committed schedule produces a reschedule proposal through the guardrail (not auto-apply).
- **Promote EventBus → Kafka** (A4, SKIP-05) — trigger-gated on AQ1 topology / multi-instance / real actuals volume (see REMAINING-ITEMS entry).
- **A12 contract governance** (SKIP-21) — schema registry, versioning enforcement, dual-publish. Discipline-by-convention today; real enforcement as the module count grows.

---

## Phase 6 — Device & access surfaces (D33 / D34)

- **Configurable roles / RBAC** (D33) — seeded default role set, per-tenant rename/add/remove, permission set = dashboard access + per-action rights + data scope + approval tier. Kernel concern; production-grade needed.
- **Device tiers** (D34) — tablet as full web peer (authoring + what-if); phone restricted to alerts/approvals/triage/KPIs; print/PDF for dispatch lists, changeover sheets, pick lists, audit records. (UI-ARCHITECTURE not fully re-read — confidence lighter here.)

---

## Suggested sequencing across the ~2–3 month cycle

> Note: **[P] platform-design answers are ours to make now** — they don't wait on Magna. The only Magna-gated items are the **[T] config values** (set at onboarding) and the **[I] connectors** (built against their actual systems). So the critical path is *platform build*, not *client discovery*.

| Weeks | Focus | Rationale |
|---|---|---|
| **1–2** | **Resolve the [P] platform-design questions** (our design calls) **+ start Phase 1a** (Master Data) | The [P] answers unblock the configurable-capability builds; Master Data has zero dependency — start now. |
| **2–5** | **Phase 1** (Master Data, effectivity, compliance spine) | The dependency root; everything builds on it. The migration is the risk. |
| **4–8** | **Phase 2** core scheduling constraints (as **configurable capabilities + safe defaults**) | Changeover/sequencing, tool-life, material gate, dependent demand, labor, nervousness — built once for all tenants, tuned per tenant. |
| **5–9** | **Phase 2A Configuration Surfaces** (constraints panel, approval-rules engine, connector/upload binding, threshold + alert policy) | Makes "configure not build" real. Build alongside the capabilities they configure. |
| **7–11** | **Phase 3/4** consumed modules + **[I] integration connectors** | Net-req (bypassable), NMA (optional), capacity binding; the **per-client** SAP/MES/EDI/HR connectors. Long pole. |
| **9–12** | **Phase 5** AI depth + dashboards | Track-record capture (4.11), yield/quality, 902 — once constraints exist to configure and data accrues. |
| **throughout** | **Phase 1c** compliance + **Phase 6** RBAC/devices | Cross-cutting, not a final bolt-on. |
| **at onboarding** | **Tenant-Onboarding track (config, NOT build)** — set Magna's [T] values, build Magna's [I] connectors | The repeatable per-client motion: configure the platform, connect their systems. This is the product's go-to-market shape. |

## The honest long poles
1. **Master Data migration** (Phase 1a) — the dependency root; moves data out of the scheduler behind contracts. Riskier the longer the scheduler is extended first, so **do it first.**
2. **Phase 2A Configuration Surfaces** — the platform promise lives or dies here; the constraints panel is genuine build (toggles barely exist today), not a screen.
3. **[I] Integration connectors** (Phase 4) — real ERP/MES/EDI/HR; the only genuinely per-client engineering, and classic where implementations slip.

## What is NOT the risk / NOT per-client
- The **scheduling kernel + AI-assist loop** — the demo-proven mature part. Production completes the constraint model, feeds it real data, and builds the Master Data foundation it was designed to sit on — not a rebuild.
- **The majority of the Q-series** — [P] decisions we make once + [T] config the tenant sets. Not a discovery bottleneck, not per-client build. Magna onboarding = **configure, not build** — which is the entire point of building a platform rather than a bespoke system.
