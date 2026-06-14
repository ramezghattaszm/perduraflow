# Net-requirements module — business & functional specification

| | |
|---|---|
| **Document** | Business & functional specification — Net-requirements module |
| **Product** | Manufacturing operations platform; Net-requirements is a domain module sitting between demand planning and scheduling |
| **Status** | Draft v0.3 |
| **Date** | 2026-06-10 |
| **Companion docs** | Platform architecture specification (Draft v0.8); Master Data module specification (Draft v0.3); Production scheduling module business & functional specification (Draft v0.10) |
| **Intended use** | Source-of-truth for the Net-requirements module build; defines the netting it performs and the contracts it consumes and produces |

> **Status note:** NR1–NR12 are **Agreed** (NR11/NR12 add the ML layer per A14). Open client-facing items are in the question log (Section 8, NRQ1–NRQ6).

---

## 1. Purpose & how to read this document

This document specifies the **Net-requirements module**: the module that turns **gross customer demand** and the **inventory/supply position** into the **pre-netted net requirements** the scheduler consumes (D14, D20). It isolates netting and its live-inventory dependency in one place so the scheduler's input stays single-purpose (D14).

Its **output is the scheduling module's demand-signal contract (scheduling spec Section 4.1)** — this module *produces* that contract; the scheduler *consumes* it. Its inputs are a **gross-demand contract** and an **inventory/supply-position contract**, defined here. It consumes the **Master Data `part` contract** (A13) for part identity and base UoM.

Decisions are logged as an **NR-series** (Section 3); open questions as an **NRQ-series** (Section 8). Cross-references: `A#` = architecture spec, `MD#` = Master Data spec, `D#`/`Q#` = scheduling business spec.

---

## 2. Scope

### 2.1 In scope

- **Finished-good / independent-demand netting** — net gross customer demand against the finished-good inventory & supply position, time-phased, producing net requirements (NR1, NR2).
- **CUM-aware netting** — reconcile against cumulative shipped vs cumulative required, as automotive releases are CUM-based (NR3).
- **Firmness-preserving netting** — net both firm and forecast demand, carrying the firmness flag through (NR5, D13/D23).
- **Delta-first processing** — consume gross-demand deltas and inventory refreshes; emit net-requirement deltas (NR6, D14).
- **ML-weighted supply** — predicted receipt reliability and WIP yield feed the netting roll-forward; the netting decision stays deterministic (NR11, A14).
- **Provided/consumed contracts** — consume gross-demand + inventory/supply-position; consume the Master Data `part` contract; produce the scheduling net-requirements contract (4.1) (NR8).

### 2.2 Out of scope

- **Multi-level component netting & dependent-demand generation** — for in-house `make` components, dependent demand is exploded, netted against component stock, lot-sized, and scheduled **by the scheduler** (D37, refined per NR1), not here. This module nets **independent (finished-good / saleable) demand** only.
- **Lot-sizing** — turning net requirements into production runs is the scheduler's (D27, scheduling 5.6). This module outputs **net requirements**, not lot-sized planned orders.
- **BOM explosion (structure)** — provided by the Master Data module as a service (MD5); this module does not own BOM topology.
- **Component / raw-material availability** — the scheduler's material gate (D36, scheduling 4.8) covers components needed to *run* a job; distinct from finished-good netting here.
- **Demand planning / forecasting** — upstream; produces the gross demand this module consumes.
- **Inventory ownership** — inventory is transactional, sourced from ERP/MES; this module consumes a position, it does not own stock records.
- **ML on the net result, CUM, or on-hand** — excluded (NR12): ML predicts uncertain *supply inputs* only; netting math, CUM reconciliation, and on-hand stay deterministic/exception-handled.

### 2.3 Operating context

- **Tenant-scoped** (D24): every entity and contract carries `tenant_id`; identifiers are global within a tenant.
- **Per-part base UoM** (D40): netting is performed in each part's canonical base UoM; inbound demand and inventory in other units are normalized at ingestion via Master Data conversion factors (MD4).
- **Conditionally in the data path** (NR9): where the client's demand source already nets, this module may be bypassed; where demand arrives gross, it sits between demand planning and scheduling. Per-tenant binding (A8).
- **Foundational dependency:** consumes the Master Data `part` contract; sits downstream of demand planning and upstream of scheduling.

---

## 3. Decision log (NR-series)

| ID | Decision | Rationale (summary) | Status |
|---|---|---|---|
| **NR1** | **Scope = finished-good / independent-demand netting authority; multi-level component netting stays in the scheduler.** This module nets **independent (saleable / customer) demand** against the finished-good inventory & supply position. Dependent demand for in-house `make` components is exploded (via Master Data MD5), netted against component on-hand, lot-sized (D27), and scheduled with precedence **by the scheduler** (D37). *Considered and rejected:* full multi-level MRP in this module (net every BOM level here). Rejected because lot-sizing drives child gross requirements level-to-level, and lot-sizing is deliberately the scheduler's (D27, coupled with campaigning); splitting netting from lot-sizing across levels breaks that coupling or forces lot-sizing to move. Keeping component netting with the scheduler keeps the coupled logic (explode → net → lot-size → schedule with precedence) in one module, while this module owns the genuinely distinct finished-good netting (CUM, in-transit, safety stock, firm/forecast). | Each module owns the netting it is *coupled* to: finished-good netting (customer-facing, CUM-based) here; component netting (lot-size-coupled, schedule-coupled) in the scheduler. Honors D14/D20/D27/D37 with one clarification to D37. | Agreed |
| **NR2** | **Netting method = time-phased projected-available-balance (PAB) roll-forward.** Per part, per time bucket across the horizon: `PAB = prior PAB + scheduled receipts/WIP completing − gross demand`, starting from `on-hand − safety stock`. The first bucket where PAB goes negative yields a **net requirement** equal to the shortfall, dated to that bucket. **EOQ-style lot-sizing is not applied** (consistent with the platform's rejection of EOQ for dependent JIT demand, D27); output is net requirements, lot-sized downstream. | PAB roll-forward is the standard, auditable netting calculation; producing unsized net requirements keeps lot-sizing where it belongs (NR1). | Agreed |
| **NR3** | **CUM-aware netting (automotive).** Netting reconciles against the **cumulative** position: customer releases (830/862) carry CUM-required, and the module nets against CUM-shipped so the net requirement reflects what is owed to the running cumulative, not just a single release's quantity. A CUM mismatch (behind/ahead) adjusts the net requirement and is surfaced for planner visibility. | Automotive demand is cumulative; netting on per-release quantities without CUM reconciliation drifts from what the customer is actually owed. | Agreed |
| **NR4** | **JIS vs stock distinction in netting.** `JIS` (just-in-sequence) demand is build-to-sequence with no finished-goods buffer: net = gross, passed through unnetted (each sequenced unit is produced). `JIT`/`stock` demand nets normally against the finished-good position. The `demand_type` (4.1) drives this. | You do not net sequence-specific JIS units against generic stock; netting them would under-produce. | Agreed |
| **NR5** | **Firmness preserved through netting** (D13/D23). Firm and forecast demand are both netted; the `firmness` flag is carried unchanged to the output. The scheduler sequences the firm net requirements and uses the forecast net requirements for material/capacity smoothing only (D13). | The firm/forecast distinction is the scheduler's most important input signal; netting must not blur it. | Agreed |
| **NR6** | **Delta-first processing** (D14). The module consumes gross-demand deltas (`change_type`/`revision_seq`) and inventory refreshes; on any change it **recomputes the affected part's net across the horizon** (PAB roll-forward is horizon-wide per part) and emits **net-requirement deltas** (add/change/remove) as the 4.1 output. Recompute granularity is per-part-horizon, not per-line. | Netting is horizon-wide per part, so a single demand or inventory change can shift multiple net buckets; emitting deltas keeps the scheduler's input efficient (D14). | Agreed |
| **NR7** | **Netting in the part's canonical base UoM** (D40). All quantities — gross demand, inventory, safety stock, output — are in the part's base UoM. Inbound foreign-unit quantities are normalized at ingestion via Master Data conversion factors (MD4); the module consumes the Master Data `part` contract for identity and UoM. | Mixed units make netting error-prone; normalizing once at ingestion (D40) keeps the math clean and matches the platform-wide rule. | Agreed |
| **NR8** | **Two input contracts, one output contract.** Inputs: a **`gross-demand`** contract (Section 5.1) and an **`inventory-position`** contract (Section 5.2). Output: the scheduling **net-requirements** contract (scheduling 4.1). Each input is a per-tenant binding (A8): the demand source and the inventory source each bind connector / upload / native / platform-module independently. | Contract-first boundaries (A8) let a tenant source gross demand from one system and inventory from another, and switch either without touching this module. | Agreed |
| **NR9** | **Bypass when the client already nets** (Q1). If a tenant's demand source already produces net requirements, this module may be **bypassed** — the scheduler binds its 4.1 input directly to the client feed. Where demand arrives gross, the module is bound between demand planning and scheduling. Per-tenant configuration (A8/D42). | D20/Q1: some clients' demand planning already nets; the module should be optional in the path, not forced, without changing the scheduler's contract. | Agreed |
| **NR10** | **Platform module** (A7/A8): tenant-scoped (D24), registers its `gross-demand` and `inventory-position` input contracts and the net-requirements output contract into the platform registry, consumes the Master Data `part` contract, and contributes any planner-facing netting views/exceptions into the kernel dashboards (A9) and audit (D6). | The module follows the platform pattern (A7); netting exceptions (e.g. CUM mismatch, stale inventory) surface through the standard kernel frameworks. | Agreed |
| **NR11** | **ML predicts uncertain supply inputs; netting stays deterministic** (platform ML capability, A14). Two targets feed the PAB roll-forward (NR2): (a) **receipt/supply reliability** — predicted on-time likelihood per inbound receipt/WIP line (the `reliability_score`, 5.2), so netting leans on confirmed-plus-likely supply and discounts shaky receipts (the supply-side analog of NMA2's mill reliability, D3-class); (b) **WIP good-completion yield** — netting against *expected good completions* rather than nominal WIP quantity, **reusing the scheduling module's existing scrap/yield model** (D3 target 4) through the platform ML capability (A14) rather than building a parallel model. Predictions carry confidence (D41) and retrain closed-loop from actual receipt arrivals and WIP completions (D5, via the MES actuals feed). **Cold-start:** with no history, netting runs on nominal, status-weighted supply exactly as NR2 already specifies (D48); ML refines the reliability/yield weighting as history accrues, layered default → tenant override (D42) → ML (A14). The netting arithmetic, CUM reconciliation, and the net result itself stay deterministic and auditable. | Netting accuracy is hostage to the reliability of its supply inputs, which are genuinely uncertain (receipts slip on supplier-consistent patterns; WIP scraps at process-stable rates) — the same uncertainty ML already predicts elsewhere. Reusing scheduling's yield model proves A14 means *shared models*, not just a shared pattern. | Agreed |
| **NR12** | **CUM reconciliation, the net result, and on-hand inventory are never ML-predicted** (deliberate exclusions). (a) **CUM mismatch** is flagged as a data-quality exception (NR3/D45), not predicted away — predicting it would obscure exactly the discrepancy the planner must see. (b) **The net requirement** is exact arithmetic (PAB + CUM), never ML-generated — ML predicts inputs, never the decision (A14/D2). (c) **On-hand is not ML-adjusted** for staleness; staleness is handled deterministically (stale-beyond-threshold raises an exception, NRQ5/D45). On-hand drift prediction is an **explicitly excluded option, reactivatable only if a client's irreducible inventory-refresh constraints demand it** (e.g. nightly-only ERP with high intraday churn, with the opacity accepted). | On-hand is the system-of-record number planners and auditors treat as ground truth; quietly substituting a model's estimate trades a small accuracy gain for a large trust/auditability cost and papers over a fixable data-quality root cause (against the D45 surface-don't-guess posture). The honest answer to staleness is the deterministic exception, not a guess. | Agreed |

---

## 4. The netting model (conceptual)

What the module computes, independent of implementation.

1. **Assemble the part's horizon.** For a part/plant, gather gross demand (firm + forecast, time-phased) and the supply position (on-hand, WIP completing, scheduled receipts, in-transit), all in base UoM (NR7).
2. **Establish the opening balance.** `opening PAB = on-hand − safety stock` (NR2). Safety-stock source per NRQ1.
3. **Roll forward bucket by bucket.** Add receipts/WIP completing in the bucket — **reliability-weighted** (NR11): low-reliability `expected` receipts are discounted, and WIP adds its ML-predicted good completions (`expected_good_qty`) rather than nominal quantity. Subtract gross demand. Track PAB.
4. **Emit net requirements.** Where PAB goes negative, the shortfall is a net requirement dated to that bucket (NR2). Positive PAB carries forward (build-ahead / coverage).
5. **CUM reconciliation (NR3).** Adjust against cumulative shipped vs required so the net reflects the owed cumulative, not a single release.
6. **Type handling (NR4).** `JIS` passes through (net = gross); `JIT`/`stock` net against the position.
7. **Preserve firmness (NR5).** Firm and forecast both netted; flag carried.
8. **Emit deltas (NR6).** Compare to the prior net result for the part; emit add/change/remove net-requirement lines as the 4.1 output.

> **Staleness matters.** Netting is only as good as the inventory `as_of` (NRQ5): stale on-hand produces net requirements that over- or under-state need. The inventory `as_of` is carried so the scheduler and planners can judge confidence, and stale-beyond-threshold inventory raises a data-quality exception (D45 pattern) rather than silently netting on old data.

---

## 5. Data contracts (property level)

Conventions match the other specs: **Req** = Y/N/C; `reference` = FK; all entities **tenant-scoped** (D24, `tenant_id` omitted for brevity); quantities in the part's base UoM (D40, NR7).

### 5.1 INPUT — Gross demand

**Source:** demand planning (module or external). **Grain:** one record per gross demand line (per part, per delivery requirement, per release revision). Mirrors scheduling 4.1 but carries **gross** quantity and is pre-netting.

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `demand_line_id` | string | Y | Unique identifier for the gross demand line. |
| `release_reference` | string | Y | Originating customer release / EDI document (830/862/866). Carried through (D6). |
| `revision_seq` | integer | Y | Monotonic revision counter; supports delta processing (NR6/D14). |
| `change_type` | enum(`add`,`change`,`remove`) | Y | Delta indicator vs prior revision. |
| `revision_timestamp` | datetime | Y | When demand planning produced this revision. |
| `part_no` | reference → Master Data `part` | Y | Resolved global `part_no` (D12; resolution via MD9). |
| `customer_part_no` | string | N | OEM part number. |
| `program` | reference → Program (kernel) | N | |
| `customer_id` | reference → Customer (kernel) | Y | |
| `plant_id` | reference → Plant (kernel) | Y | Producing plant (demand arrives plant-allocated, D32). |
| `demand_type` | enum(`JIT`,`JIS`,`stock`) | Y | Drives netting treatment (NR4). |
| `firmness` | enum(`firm`,`forecast`) | Y | Carried through netting (NR5). |
| `gross_required_qty` | decimal | Y | **Gross** demand quantity, before netting. |
| `uom` | enum | Y | UoM of `gross_required_qty`; normalized to base at ingestion (NR7). |
| `required_date` | datetime | Y | Required delivery/availability date. |
| `delivery_window_earliest` / `delivery_window_latest` | datetime | C | Required for `JIT`/`JIS`. |
| `ship_to_location` | string | Y | |
| `dock` | string | N | |
| `standard_pack_qty` | decimal | N | Informs downstream lot sizing (passed through). |
| `cum_required_qty` | decimal | N | Customer cumulative-required reference for CUM netting (NR3). |
| `priority` | integer | N | Relative priority; passed through. |
| **JIS-only block** | | | Present when `demand_type = JIS`; passed through (NR4). |
| `jis_sequence_number` | integer | C | |
| `jis_line_side_time` | datetime | C | |
| `jis_vin_reference` | string | N | |
| `jis_broadcast_id` | string | N | |

### 5.2 INPUT — Inventory & supply position

**Source:** ERP / MES / inventory systems via the binding modes (A8). **Purpose:** the supply side of netting. **Grain:** per part × plant (× location where tracked), plus time-phased supply events.

**Finished-good on-hand**

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `part_no` | reference → Master Data `part` | Y | Finished-good part. |
| `plant_id` | reference → Plant (kernel) | Y | |
| `location` | string | N | Stock location, if tracked. |
| `on_hand_qty` | decimal | Y | Available finished-good on-hand. |
| `uom` | enum | Y | Normalized to base at ingestion (NR7). |
| `as_of` | datetime | Y | Snapshot time; staleness affects validity (NRQ5). |

**WIP & scheduled receipts (supply completing over time)**

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `supply_id` | string | Y | Unique identifier. |
| `part_no` | reference → Master Data `part` | Y | |
| `plant_id` | reference → Plant (kernel) | Y | |
| `supply_type` | enum(`wip`,`scheduled_receipt`,`in_transit`) | Y | WIP completing to FG / planned receipt / inbound transfer. |
| `expected_qty` | decimal | Y | |
| `expected_datetime` | datetime | Y | When the supply becomes available. |
| `source_reference` | string | N | Order/transfer/supplier reference. |
| `status` | enum(`confirmed`,`expected`) | Y | Netting leans on `confirmed`; `expected` informs with lower confidence. |
| `reliability_score` | decimal (0–1) | N | ML-predicted on-time likelihood for this receipt/WIP line (NR11, A14); netting discounts low-reliability supply. |
| `reliability_confidence` | decimal (0–1) | N | Confidence in `reliability_score` (D41); low-confidence surfaced. |
| `expected_good_qty` | decimal | N | For `wip`: ML-predicted good completions (scheduling's yield model reused, NR11); netting uses this over nominal `expected_qty` when present. |

**Safety stock & CUM position**

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `part_no` | reference → Master Data `part` | Y | |
| `plant_id` | reference → Plant (kernel) | Y | |
| `safety_stock_qty` | decimal | N | Buffer held back before netting (NR2). Source per NRQ1. |
| `customer_id` | reference → Customer (kernel) | C | For CUM, scoped per customer. |
| `cum_shipped_qty` | decimal | C | Cumulative shipped against the customer's CUM (NR3). |
| `cum_as_of` | datetime | C | |

### 5.3 OUTPUT — Net requirements

**This module produces the scheduling net-requirements contract (scheduling spec Section 4.1).** It is not redefined here. The module computes `required_qty` (the **net** result, NR2/NR3), preserves `firmness` (NR5), `demand_type` (NR4), CUM reference (as `cumulative_qty`), dates, windows, and the JIS block, and emits `change_type`/`revision_seq` deltas (NR6). Fields scheduling marks pre-netted (D14/D20) are exactly this module's output guarantee.

| 4.1 field | How this module sets it |
|---|---|
| `required_qty` | **Net** result of PAB roll-forward + CUM reconciliation (NR2/NR3). |
| `firmness` | Carried unchanged from gross demand (NR5). |
| `demand_type` | Carried; governs JIS pass-through vs netting (NR4). |
| `cumulative_qty` | CUM reference carried for downstream reconciliation (NR3). |
| `change_type` / `revision_seq` | Emitted as net deltas from per-part-horizon recompute (NR6). |
| `part_no`, `plant_id`, `customer_id`, dates, windows, ship-to, JIS block | Passed through (resolved/normalized at ingestion). |

---

## 6. Relationship to the platform & consumers

### 6.1 Position in the data path

```
 Demand planning ──gross-demand──┐
 (module or external)            │
                                 ▼
 Inventory/MES ──inventory-pos──▶  Net-requirements  ──net requirements (4.1)──▶  Scheduling
                                 ▲
        Master Data ──part contract (identity, UoM)──┘
```

- **Consumes:** the `gross-demand` and `inventory-position` input contracts (each per-tenant bound, NR8); the Master Data `part` contract (NR7).
- **Produces:** the scheduling net-requirements contract (4.1).
- **Bypass (NR9):** where the client's demand source already nets, scheduling binds 4.1 directly to it and this module is out of the path — a per-tenant binding choice (A8), no contract change.

### 6.2 Contract registration (A8/A12)

The `gross-demand` and `inventory-position` contracts register at `1.0` with open/closed enum annotations (A12). The module's output *is* the existing 4.1 contract — it binds as a `platform_module` producer of 4.1 where present (A8 four-mode binding). Evolution per A12 (pin-major/float-minor, schema registry).

---

## 7. Traceability & exceptions

- **Netting is auditable** (D6): each net result records the gross demand, the supply position `as_of`, the safety stock and CUM values used, and the resulting PAB roll-forward inputs, so a net requirement can be reconstructed — consistent with the platform's reconstructability posture (D6/Section 7 of the scheduling spec).
- **Data-quality exceptions** (D45 pattern): stale-beyond-threshold inventory, an unresolvable part reference (MD9), or a CUM mismatch beyond tolerance raise exceptions rather than silently netting on bad data, surfaced through the kernel notification/exception framework (NR10).
- **Retention:** net-requirement outputs that fed a committed schedule inherit the schedule's retention (D46), so a past schedule's demand basis remains reconstructable.

---

## 8. Open questions (NRQ-series)

| ID | Question | Why it matters / what resolves it | Related | Status |
|---|---|---|---|---|
| **NRQ1** | Where does **safety stock** come from — a Master Data part attribute, net-requirements configuration, or an external planning system? | Safety stock sets the opening balance (NR2); its source determines whether it's master data (cross-module potential under MD12 → Master Data) or a netting-only policy (here). Lean: a planning parameter with cross-module potential → likely Master Data part attribute, sourced like other master data. Confirm with the client's planning practice. | NR2, MD12 | Open |
| **NRQ2** | *(= scheduling Q1)* Does the client's demand planning already net? If not, can it expose gross inventory (on-hand, WIP, in-transit), and what are the source systems and refresh frequencies? | Determines whether this module is in the path (NR9) and where the inventory inputs come from. Resolved with the client; see scheduling Q1 analyst guidance. | NR8, NR9, Q1 | Open |
| **NRQ3** | Where is **CUM-shipped** tracked, how current is it, and how is CUM-required carried on the releases (NR3)? | CUM netting needs a trustworthy cumulative position. A good answer names the system holding CUM-shipped, its refresh, and confirms CUM-required is on the 830/862. Watch out: CUM drift/discrepancies are a known automotive pain point. | NR3 | Open |
| **NRQ4** | What exactly counts as **supply** — does in-transit mean inbound plant-transfers (adds to availability) only, and how are WIP completions estimated/dated? | The supply side of netting (NR2) must include the right things and exclude customer-bound in-transit. Clarify the client's inventory event definitions and how WIP completion dates are known (MES). | NR2, NRQ2 | Open |
| **NRQ5** | What is the **inventory staleness tolerance** — how old can on-hand be before netting is untrustworthy and a data-quality exception is raised? | Ties netting validity to refresh frequency (NRQ2). A good answer is a per-tenant/per-part threshold; default conservative (block on clearly stale data, D45 bias). | NR2, NR6, D45 | Open |
| **NRQ6** | Are **actual receipt-arrival and WIP-completion events** available (via the MES actuals feed) to train the supply-reliability and yield predictions (NR11)? | The NR11 ML targets retrain closed-loop (D5) from actuals; this confirms the training data exists. Likely yes — the same MES actuals feed the scheduler uses (scheduling 4.3). A good answer confirms receipt-arrival timestamps vs promised dates and WIP good-vs-nominal completions are captured. | NR11, D5 | Open |

---

## Appendix A — Cross-reference

| Element | Owner |
|---|---|
| Gross-demand contract (5.1) | **This module's input** (from demand planning) |
| Inventory/supply-position contract (5.2) | **This module's input** (from ERP/MES) |
| Net-requirements contract (scheduling 4.1) | **This module's output**; scheduling consumes |
| Part identity, base UoM, conversion factors | Master Data (`part` contract, MD1/MD4); consumed here |
| BOM explosion (structure) | Master Data service (MD5); used by the scheduler for dependent demand, not here (NR1) |
| Multi-level component netting + dependent-demand scheduling | Scheduler (D37, refined per NR1) |
| Lot-sizing | Scheduler (D27); this module outputs unsized net requirements (NR2) |
| Component / raw-material availability gate | Scheduler (D36, scheduling 4.8); distinct from FG netting here |

---

*End of document — Draft v0.3.*
