# Network material allocation module — business & functional specification

| | |
|---|---|
| **Document** | Business & functional specification — Network material allocation module |
| **Product** | Manufacturing operations platform; a domain module that allocates a shared raw-material supply across plants in a cluster (D50) |
| **Status** | Draft v0.3 |
| **Date** | 2026-06-14 |
| **Companion docs** | Platform architecture specification (Draft v0.10); Master Data module specification (Draft v0.4); Production scheduling module business & functional specification (Draft v0.11); Net-requirements module specification (Draft v0.3) |
| **Intended use** | Source-of-truth for the Network material allocation module build; defines how a common material supply is split across plants and the contracts it consumes and produces |

> **Status note:** NMA1–NMA11 are **Agreed**, including the NMA6 convergence rules (Section 4.1) with ML-tuned thresholds (A14) and the two-scope allocation charter (NMA11). Open client-facing items are in the question log (Section 8, NMAQ1–NMAQ5).

---

## 1. Purpose & how to read this document

This document specifies the **Network material allocation module**: the module that decides how a **shared raw-material supply** (e.g. steel coil for a body & chassis cluster, resin for a molding cluster) is **split across the plants of a sharing group** when those plants draw on a common, constrained supply (D49, D50). It exists because that split is a **network-grain supply decision**, not a sequencing decision — the same reasoning that externalized netting (D20) and capacity (D15).

Its **output lands in each plant's scheduler as ordinary inbound scheduled receipts (scheduling spec Section 4.8)** — the scheduler's input contract is unchanged (D50). Its primary demand input is the scheduler's **material requirements feedback (scheduling Section 4.10)**, aggregated across the cluster. It consumes a **supply-position contract** (defined here), the **plant-group/cluster** definition (D49, kernel), and the **Master Data `part` contract** (A13) for material identity and base UoM.

Decisions are logged as an **NMA-series** (Section 3); open questions as an **NMAQ-series** (Section 8). Cross-references: `A#` = architecture spec, `MD#` = Master Data spec, `NR#` = net-requirements spec, `D#`/`Q#` = scheduling business spec.

---

## 2. Scope

### 2.1 In scope

- **Material allocation across a cluster** — split a constrained shared-material supply across the plants of a sharing group (D49) over time (NMA1, NMA2).
- **Allocation optimization** — deterministically minimize weighted network shortfall subject to supply constraints, with configurable priority/fairness policy (NMA2, NMA7).
- **Allocation levers** — apportion inbound supply across plants; optionally direct inter-plant transfers of existing network inventory; surface unresolvable network shortfall (NMA3).
- **The allocation↔scheduler loop** — consume per-plant material requirements (4.10), produce per-plant receipts (4.8), in a stability-biased cyclic loop (NMA6).
- **Provided/consumed contracts** — consume material requirements feedback (4.10), a supply-position contract, the cluster definition (D49), the Master Data `part` contract; produce per-plant inbound receipts (4.8) and a network allocation verdict (NMA4, NMA5).

### 2.2 Out of scope

- **Demand allocation / cross-plant sourcing** — deciding *which plant makes a given customer demand* is upstream and out of scope (D32, Q12). This module allocates **material to plants that already hold their demand**; a plant that cannot get material has its demand go **at-risk**, it is **not** reassigned to another plant (NMA1). *This is the central boundary of the module.*
- **Supplier contract management, procurement, mill scheduling** — out of scope (D50); the module consumes a supply position, it does not negotiate or schedule supply.
- **Finished-good netting** — net-requirements module (NR1).
- **Component material-availability gating** — the scheduler's material gate (D36, 4.8) checks availability; this module *feeds* the receipts the gate checks against, upstream of it.
- **Sequencing / scheduling** — the scheduler's (D2); this module never sequences jobs.
- **Material identity & commonality** — Master Data owns part identity (A13); "same material" means the same global `part_no` / spec (NMAQ3).

### 2.3 Operating context

- **Tenant-scoped** (D24): every entity and contract carries `tenant_id`.
- **Cluster-scoped** (D49): operates per sharing group per shared material; only materials flagged cluster-shared are allocated — plant-local materials need no allocation (NMA8).
- **Per-part base UoM** (D40): allocation math is in the material's canonical base UoM; inbound supply in other units is normalized at ingestion via Master Data factors (MD4).
- **Allocation is a hard supply constraint, not advice** (NMA6): a plant's scheduler can only consume material it was allocated; the allocated receipt is a real material-availability input to the gate (D36), unlike capacity's respect-but-may-deviate guidance (D16).
- **Demo relevance:** this module is the cross-plant material story in the Coahuila-cluster demo (steel across the body & chassis hub), complementing cluster-shared labor (D49) and OEM-change re-planning (D14/D44).

---

## 3. Decision log (NMA-series)

| ID | Decision | Rationale (summary) | Status |
|---|---|---|---|
| **NMA1** | **Material allocation ≠ demand allocation.** This module decides how a **shared material supply** is split across the plants of a sharing group; it does **not** decide which plant makes which demand. Demand arrives already plant-allocated (D32); a plant short of material surfaces its affected demand as **at-risk** (D36), and that demand is **never reassigned to another plant** by this module — cross-plant sourcing remains upstream and out of scope (D32, Q12). | The platform's hardest-held boundary (D32): deciding *who makes what* is an upstream demand decision; deciding *who gets the steel to make what they're already committed to* is a supply decision. Conflating them would smuggle cross-plant sourcing into the scheduler's ecosystem through the back door. | Agreed |
| **NMA2** | **Allocation is deterministic optimization.** The module minimizes **weighted network shortfall** (weighted by the priority/fairness policy, NMA7) subject to the available-supply constraint, producing a per-plant, time-phased allocation. Deterministic and auditable (mirrors D2: deterministic optimization owns the decision). **ML predicts uncertain inputs and thresholds — never the allocation** (platform capability, A14): supply reliability (mill on-time likelihood, the `reliability_score`) feeding conservative allocation, and the NMA6 convergence thresholds per cluster/material. **GenAI may explain/triage allocation tradeoffs.** Neither generates the allocation or replaces the deterministic stopping rules. | Allocation under scarcity is a constrained optimization; keeping the decision and convergence logic deterministic preserves auditability (D6) and provable termination, while ML tuning inputs/thresholds (A14) adapts behavior per cluster — matching the platform division of labor (D1–D3). | Agreed |
| **NMA3** | **Three allocation levers.** (a) **Apportion inbound supply** across plants over time (the primary lever). (b) **Inter-plant transfer** of existing network inventory — move material from a plant with excess to one short, subject to transfer lead time and cost — a **configurable lever** (some clients do not transfer; Q25/NMAQ1). (c) **Surface unresolvable network shortfall** as at-risk when total supply cannot cover weighted-priority demand (NMA4 verdict). | These are the real-world levers a network materials planner uses; making transfers configurable matches that not all clusters physically transfer material. | Agreed |
| **NMA4** | **Outputs: per-plant inbound receipts (scheduling 4.8) + a network allocation verdict.** The allocation lands as ordinary per-plant `inbound scheduled receipts` (4.8) — the scheduler's contract is unchanged (D50). A separate **network allocation verdict** (Section 5.3) reports the network-grain picture: total supply vs weighted demand, per-plant allocation, and any network shortfall with escalation (analogous to the capacity reconciliation verdict, 4.2.3). | The scheduler consumes allocation transparently as receipts; the verdict gives network materials planners and managers the cross-plant view the per-plant scheduler can't show. | Agreed |
| **NMA5** | **Inputs: material requirements feedback (4.10) + supply position + cluster definition + Master Data.** The demand side is the scheduler's per-plant material requirements feedback (scheduling 4.10), aggregated across the cluster. The supply side is a **supply-position contract** (Section 5.1). The cluster is the plant group (D49). Material identity/UoM is the Master Data `part` contract. | Reuses the loop-closing output the scheduler already emits (4.10) as this module's demand input — the contracts already align by design (D50). | Agreed |
| **NMA6** | **Stability-biased cyclic loop with explicit convergence rules.** The allocation runs per **cycle** (configurable cadence): aggregate cluster requirements (4.10) → optimize allocation **with a stability penalty** → emit per-plant receipts (4.8) → each scheduler re-plans **within** the allocated receipts, stability-biased (D44), surfacing uncoverable demand as at-risk and emitting updated requirements (4.10) → the next cycle rebalances. Allocated receipts are **hard** material inputs. **Four convergence rules** decide when the loop stops (full detail in Section 4.1): (1) **fixpoint** — stop when no plant's allocation moves more than `materiality_threshold` between cycles (the normal exit; tests *stability of the split*, not zero shortfall, since scarcity means shortfall never reaches zero); (2) **max-cycles backstop** — a hard `max_cycles` cap (default 3, D48), publish best-found if hit; (3) **oscillation detection** — stop if the allocation revisits a recent state, taking the higher-priority-weighted alternative (NMA7 breaks the tie); (4) **dampening** — a stability term penalizes moving material from the prior cycle's allocation unless the priority-weighted gain exceeds `reallocation_hysteresis`, which makes the fixpoint the normal exit and the backstops rare. **Thresholds (`materiality_threshold`, `reallocation_hysteresis`, `max_cycles`) are layered: shipped static default (D48) → tenant override (D42) → ML refinement per cluster/material as loop history accrues (A14).** A planner may force a full, undamped reallocation on demand (analog of D44), accepting more churn for a tighter result. The verdict (5.3) records **why** the loop stopped. | A tight real-time loop between allocation and N schedulers would oscillate; dampened deterministic rules give **provable termination** and a stable, explainable split, while ML-tuned thresholds adapt the behavior per cluster without ever touching the deterministic decision or the convergence guarantee (A14). | Agreed |
| **NMA7** | **Priority/fairness policy is per-tenant configurable.** When supply < demand, the weighting that decides who gets shorted is configuration: protect **firm OEM commitments** first, then by **customer/program criticality**, **JIS before stock**, with **proportional fair-share** as the fallback among equal-priority demand. Default: firm-before-forecast, then proportional. | OEM-shortfall consequences differ by customer/program and are contractual; a single global rule would misallocate. Portable across clients (D21). Client rule tracked as NMAQ4. | Agreed |
| **NMA8** | **Materials are flagged cluster-shared or plant-local.** Only materials designated **cluster-shared** (drawn by multiple plants of a sharing group from a common supply) are allocated here; plant-local materials need no network allocation and flow straight to the plant's receipts. The flag and the material↔cluster scope are configuration referencing the Master Data material and the plant group (D49). | Most materials are plant-local; allocating everything network-wide would be wasteful and wrong. The flag scopes the module to genuinely shared supply. | Agreed |
| **NMA9** | **Allocation in the material's base UoM** (D40); consumes the Master Data `part` contract. Supply and requirements are normalized to the material's canonical base UoM at ingestion (MD4); a shared material is one global `part_no` consumed at multiple plants (D12, resolved via MD9). | Steel coil ordered in one unit and consumed in another otherwise corrupts allocation math; normalize once (D40). | Agreed |
| **NMA10** | **Platform module** (A7/A8): tenant-scoped (D24); registers its supply-position input contract and the network allocation verdict output; consumes the scheduler's 4.10 and produces the scheduler's 4.8 as a `platform_module` binding; consumes the Master Data `part` contract; contributes a network-materials dashboard/exceptions into the kernel (A9/D6). | Follows the platform pattern (A7); network shortfall and reallocation events surface through the standard kernel frameworks. | Agreed |
| **NMA11** | **Allocation is one capability at two scopes.** The module arbitrates scarce supply against competing demand **by commercial priority** at: (a) **network scope** — splitting a shared raw-material supply across plants in a sharing group (NMA1–NMA10, existing); and (b) **intra-plant order scope** — when on-hand material cannot satisfy everything scheduled at a plant, allocating the scarce component **across orders/customers** by **priority, contribution margin, and penalty exposure** (the commercial-arbitration "who wins" decision, not a sequencing decision). Same arbitration logic, finer scope. Output is **prioritized/resolved demand** the scheduler consumes as ordinary demand (the scheduler does not allocate); **shorted orders are flagged for human sign-off** (Tier-3 of A18 / D26). The commercial inputs (margin/penalty/priority) are **Master-Data-owned order economics (MD15)**, externally sourced — not authored here. | Scarcity arbitration is the same problem whether the contested axis is plants or orders; making it one module (two scopes) avoids a second allocation home and keeps the scheduler free of commercial policy. Routing the result through the existing demand contract keeps the scheduler's inputs unchanged, exactly as network allocation already does via 4.8. | Agreed |

---

## 4. The allocation model (conceptual)

What the module computes per cycle (NMA6), per cluster-shared material (NMA8), independent of implementation.

1. **Aggregate cluster demand.** Sum the per-plant material requirements (4.10) across the sharing-group plants, time-phased, in base UoM (NMA9) — required and shortfall per plant per bucket.
2. **Assemble available supply.** From the supply-position contract (5.1): committed/inbound deliveries over the horizon, plus existing network inventory of the material across the cluster (the transferable pool, NMA3b).
3. **Compare network supply vs weighted demand.** Where supply ≥ demand, allocate to need. Where supply < demand, the priority/fairness policy (NMA7) decides who is shorted.
4. **Optimize the allocation (NMA2).** Minimize weighted network shortfall subject to supply, choosing the per-plant, time-phased split — and, where enabled, inter-plant transfers (NMA3b) accounting for transfer lead time/cost.
5. **Emit per-plant receipts (4.8).** The allocation becomes each plant's inbound scheduled receipts — hard material inputs to that plant's gate (D36).
6. **Emit the network verdict (5.3).** Report total supply vs weighted demand, the per-plant allocation, and any residual network shortfall with escalation.
7. **Close the loop (NMA6).** Each scheduler re-plans within its receipts (stability-biased, D44), surfaces uncoverable demand as at-risk, and emits updated 4.10; the next cycle rebalances.

> **Convergence (overview).** Allocated receipts are hard and each cycle is dampened toward the prior allocation, so the loop converges to a stable split rather than oscillating; the precise stopping rules are below.

### 4.1 Convergence rules (NMA6)

The loop stops by the first rule that fires each cycle:

```
each cycle:
  optimize allocation (NMA2) WITH stability penalty            ← rule 4 (dampening)
  if max |per-plant Δ| < materiality_threshold   → CONVERGED   ← rule 1 (fixpoint)
  elif allocation revisits a recent state        → OSCILLATION ← rule 3 (publish best, NMA7 tie-break)
  elif cycle_count ≥ max_cycles                  → BACKSTOP     ← rule 2 (publish best, flagged)
  else  feed receipts, await updated 4.10, repeat
```

| Rule | What it does | Why it's needed |
|---|---|---|
| **1 — Fixpoint** | Stop when no plant's allocation changes more than `materiality_threshold` cycle-to-cycle. Tests **stability of the split**, not zero shortfall (under scarcity shortfall never reaches zero — the loop converges to a stable *distribution* of that shortfall). | The healthy, normal exit. |
| **2 — Max-cycles backstop** | Hard `max_cycles` cap (default **3**); if hit, publish the best allocation found, flagged un-converged. | Guarantees an answer against a shift/cadence deadline; bounds compute. |
| **3 — Oscillation detection** | If the allocation revisits a recent state (or alternates within the materiality band — two plants ping-ponging a scarce coil), stop and take the higher-priority-weighted alternative (NMA7 breaks the tie deterministically). | A cycle would otherwise burn the full `max_cycles` and end arbitrarily. |
| **4 — Dampening** | The optimizer carries a stability term penalizing moving material from the prior cycle's allocation; a plant loses a held allocation only if the priority-weighted gain elsewhere exceeds `reallocation_hysteresis`. | Prevents oscillation at the source (the D44 analog), making rule 1 the normal exit and rules 2–3 rare safety nets. |

**Thresholds are layered (A14/D48/D42):** each of `materiality_threshold`, `reallocation_hysteresis`, and `max_cycles` ships with a safe static default (D48), is tenant/cluster-overridable (D42), and is **ML-refined per cluster/material** as loop history accrues (A14) — default → tenant override → ML refinement, with cold-start running on the static default until history exists. ML tunes the thresholds; the four rules themselves stay deterministic, giving **provable termination**.

**Forced full reallocation:** a planner may run an undamped reallocation on demand (the D44 analog), accepting more churn for a tighter result; the trade — a stable, explainable split over a marginally-better moving one — is the deliberate default (mirrors D44's stability-over-optimization choice).

---

## 5. Data contracts (property level)

Conventions match the other specs: **Req** = Y/N/C; `reference` = FK; all entities **tenant-scoped** (D24, `tenant_id` omitted); quantities in the material's base UoM (D40, NMA9). The **demand input** is the scheduler's material requirements feedback (scheduling 4.10) — not redefined here. The **per-plant allocation output** is the scheduler's inbound scheduled receipts (scheduling 4.8) — not redefined here.

### 5.1 INPUT — Supply position (shared material)

**Source:** procurement / supplier portal / ERP via the binding modes (A8). **Grain:** committed/inbound supply of a cluster-shared material over time, plus transferable network inventory.

**Committed & inbound supply**

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `supply_id` | string | Y | Unique identifier. |
| `material_no` | reference → Master Data `part` | Y | The cluster-shared material (NMA8). |
| `plant_group_id` | reference → Plant group (kernel) | Y | Sharing group the supply serves (D49). |
| `committed_qty` | decimal | Y | Volume available/committed in the window (base UoM, NMA9). |
| `available_from` / `available_to` | datetime | Y | When the supply is available. |
| `destination_plant_id` | reference → Plant (kernel) | C | Pre-assigned destination, if the supplier ships to a specific plant; null = allocable across the group. |
| `supplier_reference` | string | N | Contract / source reference. |
| `status` | enum(`confirmed`,`expected`) | Y | Allocation leans on `confirmed`; `expected` informs with lower confidence. |
| `reliability_score` | decimal (0–1) | N | Predicted likelihood of on-time delivery (ML, NMA2); informs conservative allocation. |

**Transferable network inventory** (for the inter-plant transfer lever, NMA3b)

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `material_no` | reference → Master Data `part` | Y | |
| `plant_id` | reference → Plant (kernel) | Y | Plant currently holding the stock. |
| `on_hand_qty` | decimal | Y | Transferable on-hand (base UoM). |
| `transfer_lead_time` | duration | N | Time to move stock to another plant in the group (NMA3b). |
| `as_of` | datetime | Y | Snapshot time; staleness affects validity (NMAQ2). |

### 5.2 Configuration — Cluster-shared material designation (NMA8)

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `material_no` | reference → Master Data `part` | Y | The material designated shared. |
| `plant_group_id` | reference → Plant group (kernel) | Y | The sharing group across which it is allocated (D49). |
| `transfer_allowed` | boolean | Y | Whether inter-plant transfer (NMA3b) is permitted for this material/cluster. Default false. |
| `priority_policy_ref` | reference | Y | The priority/fairness policy applied (NMA7). |
| `materiality_threshold` | decimal | N | Convergence rule 1 (NMA6): min per-plant change that counts as material. Layered default→override→ML (A14). |
| `reallocation_hysteresis` | decimal | N | Convergence rule 4 (NMA6): priority-weighted gain required to move held material. Layered (A14). |
| `max_cycles` | integer | N | Convergence rule 2 (NMA6): loop cap. Default **3** (D48); tenant-overridable (D42); ML-refined (A14). |
| `active` | boolean | Y | |

### 5.3 OUTPUT — Network allocation verdict

**Consumer:** network-materials planners/managers (dashboard), and escalation. **Grain:** one record per cluster-shared material × sharing group × horizon, with per-plant detail.

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `verdict_id` | string | Y | Unique identifier. |
| `material_no` | reference → Master Data `part` | Y | |
| `plant_group_id` | reference → Plant group (kernel) | Y | |
| `horizon_start` / `horizon_end` | datetime | Y | Allocated horizon. |
| `total_supply` | decimal | Y | Network supply available over the horizon (base UoM). |
| `total_weighted_demand` | decimal | Y | Aggregated cluster demand (NMA7-weighted). |
| `status` | enum(`covered`,`shortfall`) | Y | Whether network supply covers weighted demand. |
| `per_plant_allocation` | list of {plant_id, allocated_qty, shortfall_qty} | Y | The allocation result by plant; mirrors what each plant receives as receipts (4.8). |
| `network_shortfall_qty` | decimal | C | Residual unmet weighted demand; required when `status = shortfall`. |
| `at_risk_demand_lines` | list of reference → Demand line | C | Demand at risk from the shortfall; required when `status = shortfall`. Feeds at-risk (4.4) and may trip approval rules (D25). |
| `transfers` | list of {from_plant_id, to_plant_id, qty, lead_time} | N | Inter-plant transfers in the allocation (NMA3b), if any. |
| `escalation_required` | boolean | Y | True when firm demand cannot be covered; triggers escalation rather than silent absorption (mirrors 4.2.3). |
| `converged` | boolean | Y | Whether the loop reached fixpoint (NMA6 rule 1) vs published early. |
| `stop_reason` | enum(`converged`,`max_cycles`,`oscillation`,`forced`) | Y | Why the loop stopped (NMA6); recorded for audit (D6) and surfaced when an allocation was published un-converged. |
| `cycles_run` | integer | Y | Number of allocation cycles executed this run. |

> **Per-plant allocation → receipts.** Each `per_plant_allocation` entry is emitted as an inbound scheduled receipt (scheduling 4.8) for that plant: `material_no`, `plant_id`, `expected_qty = allocated_qty`, `expected_datetime`, `status`. The scheduler's material gate (D36) consumes them unchanged (D50).

---

## 6. Relationship to the platform & consumers

### 6.1 The allocation loop (NMA6)

```
   Per-plant schedulers ──material requirements (4.10)──┐
        ▲                                               │ aggregate across cluster (D49)
        │ inbound receipts (4.8, hard)                  ▼
        └──────────────  Network material allocation  ◀── supply position (5.1)
                          (optimize, NMA2/NMA7)        ◀── cluster def (D49)
                                 │                      ◀── Master Data part (identity/UoM)
                                 ▼
                          network allocation verdict (5.3) ──▶ dashboards / escalation
```

- **Consumes:** material requirements feedback (4.10), supply position (5.1), the cluster definition (D49), the Master Data `part` contract.
- **Produces:** per-plant inbound receipts (4.8, hard inputs to each plant's gate), and the network allocation verdict (5.3).
- **Loop:** cyclic and stability-biased (NMA6); allocated receipts are hard, the scheduler re-plans within them (D44), reports back, the next cycle rebalances. Converges by construction.

### 6.2 Contract registration (A8/A12)

The supply-position input and the network-allocation-verdict output register at `1.0` with open/closed enum annotations (A12). The module binds as a `platform_module` producer of the scheduler's 4.8 receipts and consumer of its 4.10 feedback (A8 four-mode binding) — the contracts already align by design (D50). Evolution per A12.

### 6.3 Where it sits among the modules

| Concern | Owner |
|---|---|
| Which plant makes which demand (cross-plant sourcing) | **Upstream / out of scope** (D32, Q12) — *not this module* |
| Splitting shared material supply across plants | **This module** (NMA1) |
| Finished-good netting | Net-requirements (NR1) |
| Per-plant component material-availability gate | Scheduler (D36, 4.8) — consumes this module's receipts |
| Sequencing within a plant | Scheduler (D2) |
| Material identity / commonality | Master Data (A13) |
| Supplier contracts / mill scheduling | Out of scope (D50) |

---

## 7. Traceability & exceptions

- **Allocation is auditable** (D6): each allocation records the aggregated cluster demand, the supply position used (`as_of`, status), the priority policy applied, and the resulting per-plant split and any transfers — so an allocation can be reconstructed (D6/Section 7 of the scheduling spec).
- **Data-quality exceptions** (D45 pattern): stale supply data (NMAQ2), an unresolvable material reference (MD9), or ambiguous material commonality (NMAQ3) raise exceptions rather than silently allocating on bad data.
- **Network shortfall** surfaces as the verdict's escalation (5.3) and as per-plant at-risk (4.4); firm-demand shortfall trips escalation and may trip approval rules (D25).
- **Retention:** allocation verdicts that fed committed schedules inherit the schedule's retention (D46).

---

## 8. Open questions (NMAQ-series)

| ID | Question | Why it matters / what resolves it | Related | Status |
|---|---|---|---|---|
| **NMAQ1** | *(= scheduling Q25)* How is shared material contracted and allocated today — per plant, per division, or centrally; at what cadence; who decides a reallocation; and do physical inter-plant transfers happen (with what lead time)? | Determines whether the module models an existing process or creates one, and whether the transfer lever (NMA3b) is real. See scheduling Q25 analyst guidance. | NMA3, NMA7, Q25 | Open |
| **NMAQ2** | Where does the **supply position** come from (committed/inbound mill deliveries, transferable network inventory), at what refresh, and how reliable are mill delivery dates? | Allocation is only as good as the supply data; reliability informs conservative allocation (the `reliability_score`, NMA2). A good answer names the system, refresh, and whether mill dates slip. | NMA5, NMA2 | Open |
| **NMAQ3** | What defines **"same material"** across plants — exact spec/grade identity — and how is true commonality identified (so allocation doesn't pool non-interchangeable grades)? | Allocation requires that the shared `material_no` is genuinely one interchangeable material (D50: steel grades/resins are not interchangeable). Resolved with materials engineering; confirms the cluster-shared flag (NMA8) is set on real commonality. | NMA8, NMA9, MD9 | Open |
| **NMAQ4** | What is the client's actual **priority/fairness rule** when shared material is short — which customers/programs are protected, and what is the fallback among equals? | Configures the priority policy (NMA7). A good answer ranks customer/program criticality and confirms firm-before-forecast and a proportional fallback. | NMA7 | Open |
| **NMAQ5** | What **cadence** should the allocation cycle run at, and what is the client's tolerance for material-driven reschedules (how often can allocation shift receipts before it disrupts the floor)? | Sets the loop cadence (NMA6) and balances responsiveness vs stability (D44). A good answer gives a cadence (e.g. daily for near-term) and a stability expectation. | NMA6, D44 | Open |

---

## Appendix A — Cross-reference

| Element | Owner |
|---|---|
| Material requirements feedback (scheduling 4.10) | Scheduler **output**; **this module's demand input** |
| Supply-position contract (5.1) | **This module's input** (procurement/ERP) |
| Cluster-shared material designation (5.2) | **This module's configuration** (references Master Data + plant group) |
| Per-plant inbound receipts (scheduling 4.8) | **This module's output**; scheduler's material gate consumes |
| Network allocation verdict (5.3) | **This module's output** (dashboards / escalation) |
| Plant group / cluster | Kernel org model (D49/A10) |
| Material identity, base UoM | Master Data (`part` contract, MD1/MD9); consumed here |
| Which plant makes which demand | Upstream / out of scope (D32, Q12) — **not this module** (NMA1) |
| Supplier contracts / mill scheduling | Out of scope (D50) |

---

*End of document — Draft v0.2.*
