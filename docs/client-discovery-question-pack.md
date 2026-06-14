# Client discovery — consolidated question pack

| | |
|---|---|
| **Document** | Client discovery question pack (Magna) |
| **Purpose** | Single working artifact for the client discovery session(s); consolidates every open client-facing question across all five specifications |
| **Status** | Draft v1.1 |
| **Date** | 2026-06-10 |
| **Source specs** | Production scheduling (v0.10), Platform architecture (v0.9), Master Data (v0.3), Net-requirements (v0.3), Network material allocation (v0.2) |

---

## How to use this pack

This pack has two parts, asked in order:

- **Part A — Engine scope & boundaries (ask first).** The client built their own demand and capacity planning and is asking us for production scheduling optimization. Before any configuration, we must confirm *what those engines do* and *exactly where the seam with our scheduler is* — because a boundary mismatch invalidates the assumptions the whole design rests on. This part's job is to **falsify our boundary assumptions** (D15, D20, D29): every question can return an answer that says "your assumption is wrong for us," and discovering that here, on paper, is far cheaper than at integration. Likely audience: the client's **engineering/architecture** people.
- **Part B — Configuration (ask after).** Once the boundaries hold, these determine how the scheduling module is set up. Likely audience: **planners and operations**.

For each question:

- **Ask** — the question to put to the client.
- **Plain-language framing** — how to explain it if they're unsure (use verbatim if helpful).
- **A good answer contains** — what "done" looks like.
- **Watch out** — the common trap.
- **Ref** — source question ID and the decision it informs.

A short **answer** field is left blank for capture during the session.

> **Sequencing:** Part A first (a mismatch there reshapes everything). Within Part B, Themes 1–3 unblock the most downstream design; Themes 7–8 are lower-urgency and partly internal.

---

# PART A — Engine scope & boundaries

> **Purpose:** confirm where the client's own engines stop and ours begins, and validate that their engines' outputs match the contracts our scheduler consumes (4.1 net requirements, 4.2 capacity envelope). The valuable outcome is finding a seam mismatch *now*.

## A0 — Framing question (ask first, sets up everything)

**Ask:** When you say you want "production scheduling optimization," what decisions do you expect that engine to own — and what stays with your existing demand and capacity planning?
**Plain-language framing:** "Draw us the line. What should our engine decide, and what have you already decided by the time it gets the data?"
**A good answer contains:** the client's own mental model of the seam — which we then test against our D15/D20 boundaries in the questions below. A mismatch here is the single most important thing to surface.
**Watch out:** Clients often assume the scheduler does more (or less) than our design. Don't correct yet — capture their model, then probe with A1–A6.
**Ref:** scope-defining → D1, D15, D20. *Answer:*

## A1 — Demand planning engine: what it outputs

**Ask:** What does your demand planning engine output — gross customer demand, or net requirements (already subtracted against stock/WIP)? At what grain (per part, per release), how often, and via what mechanism (feed, file, API)?
**Plain-language framing:** "When your demand system hands off, is it raw customer orders, or has it already worked out what you actually need to make after existing stock? How does it come to us?"
**A good answer contains:** gross vs net; the output grain and cadence; the handoff mechanism. **This determines whether our net-requirements module sits in the path or is bypassed (NR9).**
**Watch out:** "We have forecasts" ≠ netting. If they net, confirm whether they net against live inventory or stale snapshots — it changes whether our net-requirements module adds value.
**Ref:** A0 → D14, D20, NR9; pairs with Q-DM-A. *Answer:*

## A2 — Capacity planning engine: envelope or finite commitment?

**Ask:** Does your capacity planning engine hand down an *available-capacity envelope* (how much capacity exists, with leveling guidance), or does it commit *finite quantities per bucket* (this much of part X in week Y)?
**Plain-language framing:** "Does your capacity tool tell us 'here's how much you can run and some smoothing advice,' or does it tell us 'make exactly this much of this in this week'?"
**A good answer contains:** envelope vs finite commitment — **this is the load-bearing boundary test (D15).** Our design assumes envelope; if they commit finite quantities, the boundary and the 4.2 contract must be renegotiated.
**Watch out:** This is *the* question most likely to reveal a mismatch. If they say "it schedules" — probe hard: does it know the order of individual jobs? If yes, it overlaps our scheduler and the line must move.
**Ref:** A0 → D15, D19; the 4.2 contract. *Answer:*

## A3 — Capacity engine: what it decides

**Ask:** Which decisions does your capacity engine own today — leveling (build-ahead, overtime, outsourcing), demand-vs-capacity reconciliation, rough-cut labor? Does it ever decide the *sequence* of jobs?
**Plain-language framing:** "What calls does your capacity tool actually make — overtime, building ahead, outsourcing, telling you when demand won't fit? Does it ever decide what runs in what order?"
**A good answer contains:** the leveling levers it owns; whether it reconciles/escalates; a clear **no** on job sequencing (if yes → overlap with our scheduler).
**Watch out:** The test from D15: "if a decision needs to know the order of individual jobs, it's not capacity planning." Use it to classify each decision they name.
**Ref:** A0 → D15, D16; the 4.2 leveling-guidance contract. *Answer:*

## A4 — Capacity grain & bucketing

**Ask:** At what time grain does the capacity engine work (daily, weekly, monthly — or telescoping), and is its grain coarser than job-level scheduling?
**Plain-language framing:** "Does your capacity tool think in days, weeks, months? Is it always coarser than a job-by-job schedule?"
**A good answer contains:** the bucket structure (confirms or challenges the telescoping assumption D22); confirmation it's coarser than scheduling.
**Watch out:** If capacity works at the same grain as scheduling, the degenerate-case exception (D15 §6.3) may apply — clarify whether that's a one-off line or the norm.
**Ref:** A0 → D22; the 4.2 profile contract. *Answer:*

## A5 — Closing the loop back to their engines

**Ask:** Can your capacity engine *consume* feedback from the scheduler — deviation reports (where we departed from leveling guidance), labor-requirement signals, material-requirement signals — or is it one-directional (it hands down, never receives)?
**Plain-language framing:** "When our scheduler finds it has to deviate from your capacity plan, or discovers a labor or material shortfall, can your capacity tool take that back and adjust — or does information only flow one way?"
**A good answer contains:** whether the loop is closeable (our 4.5 / 4.7 / 4.10 feedback contracts have a consumer) or whether their engine is one-way (then feedback surfaces only to humans).
**Watch out:** Many home-built planning engines are one-directional. If so, our feedback outputs still produce value as planner-visible exceptions, but the automated rebalancing loop (capacity, allocation) won't close — set expectations.
**Ref:** A0 → D16, D30, D50; the 4.5/4.7/4.10 contracts. *Answer:*

## A6 — Integration mechanism & ownership of the engines

**Ask:** How would our scheduler exchange data with your demand and capacity engines (connector/API, file, event)? And longer-term, do you intend to keep these engines, or is there appetite to replace them with platform modules over time?
**Plain-language framing:** "How do we plug into your demand and capacity tools — live connection, files, events? And down the road, do you want to keep running your own, or would you consider our versions?"
**A good answer contains:** the integration mechanism per engine; a read on keep-vs-replace (shapes the roadmap and which contract bindings we configure, A8).
**Watch out:** "Keep ours" is fine — the contract-binding design (A8) supports it. This just tells us connector vs platform-module per interface.
**Ref:** A0 → D35, A8. *Answer:*

## A7 — Labor scheduling: is it an engine, or just a constraint? (the scope fork)

**Ask:** When you mention labor scheduling/optimization, which of these do you mean: (a) treat labor only as a **constraint** on production (we already model this — skill-pool availability per shift); (b) a full **labor optimization engine** (allocating skills/people to work); or (c) **co-optimizing** labor and production together in one solve? And who owns the labor decision today?
**Plain-language framing:** "Three different things hide under 'labor scheduling.' One: just make sure production respects how many skilled people you have. Two: a tool that actually decides how to deploy your workforce. Three: planning people and production together as one problem. Which are you after — and who decides labor today?"
**A good answer contains:** which of (a)/(b)/(c); who owns labor decisions now; whether they want the platform to take that over. **This defines whether labor is in-scope as a *second engine* or stays the constraint we already designed (D29).**
**Watch out:** This is the genuinely open scope item. Our current design is (a) — labor as an optional finite pool constraint (D29), with individual rostering external (D43). Option (b) is the D43 "if built, a separate module." Option (c) we **explicitly rejected** (D29) — co-optimization over-builds scope and couples two problems best kept separate; if they want (c), that's a significant scope and design conversation, not a config.
**Ref:** new (labor scope) → D29, D43. *Answer:*

## A8 — Labor scheduling: depth, if in scope

**Ask:** *(Only if A7 = (b) or (c).)* Would a labor engine handle individual-operator rostering (specific people to shifts/stations, with certifications, availability, labor law), or skill-pool-level optimization (how many of each skill, where), or both?
**Plain-language framing:** "Down to naming individuals on a shift roster — with their certifications and time-off — or just 'we need three setters on line 4 this shift'?"
**A good answer contains:** rostering (individual, D43-class — labor law, certifications, availability) vs pool-level (skill counts); confirms which module(s) a labor engine would actually be.
**Watch out:** Individual rostering is a distinct, heavy problem (labor law, per-person availability) the platform deliberately kept external (D43) — if they want it, it's its own module, not an extension of the scheduler.
**Ref:** new (labor depth) → D29, D43; pairs with Q-LB-A/B/C. *Answer:*

---

# PART B — Configuration

> **Purpose:** once Part A confirms the boundaries hold, these determine how the scheduling module is set up.

---

## Theme 1 — Data foundations: parts, materials, units, BOM

### Q-MD-A — Part numbering across plants
**Ask:** How are parts numbered across Magna plants — a single shared master part number, or independent per-plant numbering (and/or separate ERP instances)?
**Plain-language framing:** "If two plants make the same bracket, do they use the same part number, or different ones?"
**A good answer contains:** single-shared vs per-plant; whether plants share one ERP or run separate instances; whether any cross-reference list exists today.
**Watch out:** "We all use SAP" does not guarantee shared numbering — separate SAP instances often number differently. Reassure them we build the mapping table either way; this only tells us how to fill it.
**Ref:** Q2 → D12. *Answer:*

### Q-MD-B — Mixed units of measure
**Ask:** Do parts transact in more than one unit of measure (e.g. ordered in eaches but stocked/consumed in kg or metres), and where do the conversion factors come from?
**Plain-language framing:** "Is everything counted the same way everywhere, or do some parts get ordered in one unit and stored or used in another? If so, where are the conversion factors kept?"
**A good answer contains:** whether mixed UoMs occur; the source of conversion factors (often ERP).
**Watch out:** Raw materials (coil, resin) are the usual mixed-unit case — confirm those specifically.
**Ref:** Q19 → D40. *Answer:*

### Q-MD-C — Master data sources & system of record
**Ask:** Which source systems hold master data (parts, BOMs, routings, tooling, calendars)? Can they be integrated via connector or only file export? For any data with no source system, should the platform be the system of record (maintained in-app), or always mirror an external source?
**Plain-language framing:** "For parts, BOMs, routings, tooling, calendars — where does that data live today? Can we connect to it, or would you export files? And for anything with no system behind it, do you want our platform to be the master, or always copy from somewhere else?"
**A good answer contains:** per data type, the source system and whether connector/upload is feasible, plus a clear position on system-of-record.
**Watch out:** "We have SAP" doesn't mean every data type is in it or accessible — check per data type.
**Ref:** Q15 → D35. *Answer:*

### Q-MD-D — Made vs bought sub-assemblies
**Ask:** Does Magna produce and stock in-house sub-assemblies / made components as distinct part numbers consumed by other parts, or is in-plant flow generally one part moving through a multi-operation routing?
**Plain-language framing:** "When you make something in-house that goes into another of your products, is it its own part number you track and stock, or is it just a step in making the final part?"
**A good answer contains:** whether made sub-assemblies are distinct, stocked, BOM-level components (multi-level) or just operations within one part's routing.
**Watch out:** Ask for one example BOM with an in-house made component — that settles it quickly.
**Ref:** Q17 → D37. *Answer:*

### Q-MD-E — Pegged vs stocked made components
**Ask:** For in-house made components, are they produced to a specific parent order (pegged, make-to-order) or built to stock and drawn down by multiple parents (make-to-stock)?
**Plain-language framing:** "When you make a sub-component, do you make exactly what a specific bigger order needs, or do you build a batch to stock that several products pull from?"
**A good answer contains:** per made component, whether it is order-pegged or stock-replenished (these can differ by component).
**Ref:** Q18 → D37. *Answer:*

---

## Theme 2 — Demand, netting & cumulative accounting

### Q-DM-A — Does demand planning already net?
**Ask:** Does the client's existing demand planning already perform netting? If not, can it expose gross inventory (on-hand, WIP, in-transit), and what are the source systems and refresh frequency for that inventory data?
**Plain-language framing:** "If the OEM orders 1,000 but you already have 200 finished and 100 on the line, you only need to make 700 — does your system do that subtraction?"
**A good answer contains:** yes/no; if no, the systems holding on-hand/WIP/in-transit and their refresh (real-time, hourly, nightly).
**Watch out:** "We have forecasts" is *not* the same as netting — don't let the two be conflated.
**Ref:** Q1 / NRQ2 → D14, D20, NR9. *Answer:*

### Q-DM-B — What counts as supply
**Ask:** What exactly counts as supply for netting — does "in-transit" mean inbound plant-transfers (adds to availability) only, and how are WIP completions estimated and dated?
**Plain-language framing:** "When you work out what you still need to make, what do you count as 'already coming' — stock on the way in, work on the line finishing soon? And how do you know when work-in-progress will finish?"
**A good answer contains:** the client's inventory event definitions (excluding customer-bound in-transit); how WIP completion dates are known (MES).
**Ref:** NRQ4 → NR2. *Answer:*

### Q-DM-C — Cumulative (CUM) accounting
**Ask:** Where is cumulative-shipped (CUM) tracked, how current is it, and how is cumulative-required carried on the releases?
**Plain-language framing:** "The customer tracks a running total of what you should have shipped since the program started. Where do you keep your matching 'total shipped' number, and is it on the 830/862 releases?"
**A good answer contains:** the system holding CUM-shipped, its refresh, and confirmation that CUM-required is on the 830/862.
**Watch out:** CUM drift/discrepancies are a known automotive pain point — ask how they currently reconcile.
**Ref:** NRQ3 → NR3. *Answer:*

### Q-DM-D — Inventory staleness tolerance
**Ask:** How old can on-hand data be before netting is untrustworthy and a data-quality exception should be raised?
**Plain-language framing:** "If your stock figures are a few hours — or a day — old, at what point do you stop trusting them to plan against?"
**A good answer contains:** a per-tenant/per-part staleness threshold (ties to the refresh answer in Q-DM-A).
**Watch out:** We default conservative (flag clearly-stale data rather than plan on it).
**Ref:** NRQ5 → NR2, D45. *Answer:*

### Q-DM-E — Safety stock source
**Ask:** Where does safety stock come from — a master-data part attribute, planning configuration, or an external planning system?
**Plain-language framing:** "Do you hold a buffer stock target per part, and where is that number kept?"
**A good answer contains:** the source of safety-stock values and whether it's per part or per part family.
**Ref:** NRQ1 → NR2. *Answer:*

---

## Theme 3 — Planning practice, horizons & firm windows

### Q-PL-A — Planning cadence & firm/frozen windows
**Ask:** How do Magna's planners plan — what horizons and review cadence (e.g. daily near-term, weekly mid, monthly long)? And how are firm/frozen windows defined per customer/program in the OEM agreements?
**Plain-language framing:** "For the next couple of weeks do you plan day-by-day, then by week, then by month? And for each OEM, how many days ahead is the schedule locked and can't change?"
**A good answer contains:** the cadence/resolution; a frozen-window length per major customer/program (e.g. customer A = 5 days firm).
**Watch out:** The frozen window usually lives in the OEM's supply agreement or EDI release calendar, not just in a planner's head — ask to see it if they're unsure.
**Ref:** Q3 → D22, D23. *Answer:*

### Q-PL-B — Lot sizing practice
**Ask:** How does Magna currently size production runs, and what should the per-part defaults be?
**Plain-language framing:** "When you decide how many to make in one run, do you make exactly what's needed, or do you have minimum run sizes, round up to full containers/pallets, or batch a day's or week's worth together?"
**A good answer contains:** the base approach (make-to-exact-need vs batch-a-period); whether minimums apply; whether they round to container/pallet; whether set per part or per part family.
**Ref:** Q7 → D27. *Answer:*

### Q-PL-C — Process-driven batch sizes & pack data
**Ask:** Are there process-driven batch quantities that force a lot multiple (oven, rack, heat-treat load)? And is reliable standard pack/container data available per part?
**Plain-language framing:** "Do any processes force a batch size — e.g. an oven or heat-treat load that must be full? And do you have accurate standard pack/container quantities for each part?"
**A good answer contains:** any process-unit batch sizes; whether per-part pack quantities exist and are trustworthy.
**Watch out:** If pack data is stale or missing, pack-rounding can't be relied on as a default — flag it.
**Ref:** Q8 → D27. *Answer:*

### Q-PL-D — Mandatory sequencing / campaign rules
**Ask:** What mandatory sequencing or campaign rules must production obey — paint colour ordering, material campaigns, required cleanouts between certain transitions, and any limit on how long a campaign can run before a forced clean/maintenance?
**Plain-language framing:** "Are there rules about the *order* things must run — e.g. paint must go light to dark, certain materials must run together, switching from X to Y needs a cleanout, or you can't run more than N before a clean?"
**A good answer contains:** each rule with the attribute it's keyed on (colour, material…), the rule type (required order / must-run-together / forbidden-or-cleanout / max-consecutive), and the lines/resource groups it applies to.
**Watch out:** Paint and heat-treat areas are the usual sources — ask the process engineers, not just the planners.
**Ref:** Q9 → D28. *Answer:*

### Q-PL-E — Scheduling horizon (implicit in cadence)
**Ask:** How far forward should the detailed schedule be sequenced per plant (must at minimum cover the firm window)?
**Plain-language framing:** "How many weeks ahead do you actually need a job-by-job schedule, versus just a rough plan?"
**A good answer contains:** a per-plant horizon length; confirmation it covers the firm fence (default 4 weeks).
**Ref:** D47 (default; confirm per plant). *Answer:*

---

## Theme 4 — Labor, skills & shortfall coverage

### Q-LB-A — Labor-paced vs machine-paced operations
**Ask:** Which operations are labor-paced vs machine-paced? What skills/certifications gate them? What are the operator-to-machine ratios? Does changeover need a dedicated skilled setter?
**Plain-language framing:** "For each type of operation, does throughput depend on the machine or on how many people you have? How many machines does one operator run? Which jobs need a certified or skilled person? Is there a separate crew/shift pattern for labor?"
**A good answer contains:** machine-paced vs labor-paced areas; gating skills/certifications; whether changeovers need a dedicated setter.
**Watch out:** Setup labor often binds even where run labor doesn't — ask specifically who performs changeovers.
**Ref:** Q10 → D29. *Answer:*

### Q-LB-B — Covering a skill shortfall
**Ask:** When a skill is short for a shift, what are the options and rules for covering it (overtime, second shift, temporary/contract labor)? For temps, is there a pool of pre-qualified contractors usable on availability (no onboarding) vs sourcing new temps with a lead time? Which skills, what availability, what lead time? Who authorizes it, and when do they accept the constraint instead?
**Plain-language framing:** "If you're short of skilled people for a shift, what do you do — overtime, add a shift, bring in temps? Do you have known contractors you can call in right away if they're free, or do you have to source new people with notice? Who signs off — and when do you just accept making less?"
**A good answer contains:** the levers; the pre-qualified pool (no lead time) vs new sourcing (lead time per skill); who approves each; the threshold for accepting a constraint.
**Watch out:** A free pre-qualified contractor can cover a shortfall inside the frozen window; new temp labor that takes two weeks cannot.
**Ref:** Q11 → D30, D31. *Answer:*

### Q-LB-C — Workforce/HR system for headcount-by-skill
**Ask:** Does Magna have a workforce scheduling / HR system that can provide available headcount by skill per shift, and can it be integrated (connector/upload) or is that data maintained manually?
**Plain-language framing:** "Where do you keep who's working which shift and what skills they have — a workforce/HR/scheduling system, or spreadsheets? Can we pull headcount-by-skill-by-shift from it?"
**A good answer contains:** the system (or confirmation it's manual) and whether connector/upload is feasible.
**Note:** Individual rostering stays in their system; we only need the resulting available headcount by skill per shift.
**Ref:** Q22 → D43. *Answer:*

---

## Theme 5 — Multi-plant, clusters & shared resources

### Q-MP-A — Demand already plant-allocated?
**Ask:** Does demand arrive already allocated to a specific plant, or does Magna expect the system to decide which plant makes a given demand (cross-plant sourcing/load-balancing)?
**Plain-language framing:** "When demand comes in, is it already assigned to a specific plant, or would you want the system to choose between plants that can both make the part?"
**A good answer contains:** whether allocation happens upstream (common for decentralized plants) or is expected of the scheduler.
**Watch out:** Occasional manual re-sourcing between plants is different from systematic load-balancing — clarify which they mean. (Our design assumes demand arrives plant-allocated.)
**Ref:** Q12 → D32. *Answer:*

### Q-MP-B — Cluster-shared resources (labor, tooling)
**Ask:** For dense plant clusters (e.g. the ~11 Coahuila plants), do plants actually share resources across plant boundaries today — skilled labor (setters, maintenance techs), tooling, or anything else — and if so, who arbitrates when two plants want the same resource?
**Plain-language framing:** "When one plant is short a setter or a maintenance tech and the plant next door has slack, do people actually move between plants? Who decides?"
**A good answer contains:** what is shared (labor, tools, nothing); how often; whether formal or ad hoc; who has authority to move a resource between plants.
**Watch out:** Divisions matter — a Cosma plant and a Seating plant side by side may share nothing; sharing likely follows division + geography together. If nothing is shared today, ask whether they *want* the system to enable it.
**Ref:** Q24 → D49. *Answer:*

### Q-MP-C — Shared material contracting & allocation
**Ask:** For shared raw materials (steel coil for body & chassis, resin for molding): how is supply contracted and allocated today — per plant, per division, or centrally? At what cadence is allocation revisited? Who decides a reallocation when one plant runs short while another has excess? Do physical inter-plant transfers happen (with what lead time)?
**Plain-language framing:** "When you buy steel, does each plant order its own, or is there one contract whose volume gets split across plants? If plant A is about to run out and plant B has extra coil of the same spec, can it move — and who makes that call?"
**A good answer contains:** the contracting level (plant/division/central); allocation cadence (annual/monthly/weekly); whether inter-plant transfers happen and their lead time; the deciding role.
**Watch out:** "Same material" must mean same spec/grade — steel grades and resin types are not interchangeable; ask how they identify true commonality.
**Ref:** Q25 / NMAQ1 → D50, NMA3, NMA7. *Answer:*

### Q-MP-D — Shared-material supply source & reliability
**Ask:** Where does the shared-material supply position come from (committed/inbound mill deliveries, transferable network inventory), at what refresh, and how reliable are the mill delivery dates?
**Plain-language framing:** "For the steel/resin shared across plants, where do you see what's committed and arriving when, and do those promised dates usually hold?"
**A good answer contains:** the source system(s), refresh frequency, and whether mill dates slip.
**Ref:** NMAQ2 → NMA5, NMA2. *Answer:*

### Q-MP-E — Material commonality identification
**Ask:** What defines "same material" across plants (exact spec/grade), and how is true commonality identified so allocation doesn't pool non-interchangeable grades?
**Plain-language framing:** "How do you know that the steel one plant uses is genuinely the same as another's — same grade, same spec — and not just 'steel'?"
**A good answer contains:** the spec/grade identity rule and who confirms commonality (materials engineering).
**Ref:** NMAQ3 → NMA8. *Answer:*

### Q-MP-F — Material allocation priority & cadence
**Ask:** When shared material is short, what is the priority/fairness rule (which customers/programs are protected, fallback among equals)? What cadence should the allocation cycle run at, and what's the tolerance for material-driven reschedules?
**Plain-language framing:** "If you don't have enough steel for everyone this week, who gets it first? And how often should the system re-balance — without disrupting the floor too much?"
**A good answer contains:** a ranked customer/program priority; confirmation of firm-before-forecast + proportional fallback; a cycle cadence and stability expectation.
**Ref:** NMAQ4, NMAQ5 → NMA7, NMA6. *Answer:*

---

## Theme 6 — Inventory & supplier data for the material gate

### Q-IN-A — Component inventory & inbound receipts
**Ask:** Where does component/raw-material inventory and inbound supplier-delivery (scheduled receipt) data come from, at what granularity and refresh, and how reliable are the expected delivery dates?
**Plain-language framing:** "For the parts and materials that go *into* what you make, where do you track stock on hand, and where do you see what's arriving from suppliers and when? How current is that, and how reliable are the promised dates?"
**A good answer contains:** the system(s) for on-hand and for inbound/scheduled receipts; refresh frequency; whether supplier dates are trustworthy.
**Watch out:** Confirmed vs merely-expected receipts matter — the gate leans on confirmed ones; ask how they distinguish them.
**Ref:** Q16 → D36. *Answer:*

### Q-IN-B — Training data for supply-reliability ML
**Ask:** Are actual receipt-arrival and WIP-completion events available (via the MES actuals feed) to train supply-reliability and yield predictions?
**Plain-language framing:** "Do you capture when receipts actually arrived versus when they were promised, and how much good product a work order actually yielded versus planned?"
**A good answer contains:** confirmation that receipt-arrival timestamps (vs promised) and WIP good-vs-nominal completions are captured.
**Ref:** NRQ6 → NR11, D5. *Answer:*

---

## Theme 7 — Roles, devices & operations

### Q-OP-A — Role structure on the floor
**Ask:** What is Magna's actual role structure on the plant floor — role names, who does what, how many distinct roles — and who is allowed to change a schedule, and who approves changes?
**Plain-language framing:** "What do you call the people who run the lines, plan the schedule, supervise, manage the plant, handle materials and tooling? Who can change a schedule, and who approves changes?"
**A good answer contains:** their role names mapped to responsibilities and to who can view/edit/approve.
**Watch out:** Titles vary by plant — confirm whether the structure is consistent. (Roles are fully configurable; this shapes defaults.)
**Ref:** Q13 → D33. *Answer:*

### Q-OP-B — Approval authority & tiers
**Ask:** Which situations should require human approval before a schedule goes live (the risk appetite), who holds approval authority at each level, and where is the client comfortable with automatic approval (including AI-influenced proposals)?
**Plain-language framing:** "When the system proposes a schedule, in which situations would you *not* want it to go live automatically — a firm order might be late, it needs overtime, it reshuffles a lot of jobs? Who signs off at each level? And which low-risk cases could go live automatically — including AI-suggested ones?"
**A good answer contains:** a list of risky conditions with rough thresholds; the approval roles/levels and what each can approve; an explicit stance on auto-approval and on AI-influenced proposals (default: conservative, AI reviewed at launch).
**Ref:** Q4, Q5, Q6 → D25, D26. *Answer:*

### Q-OP-C — Devices & print artifacts
**Ask:** What devices are used on the floor (large screens/wallboards, tablets, phones), who uses which, and what do they print today?
**Plain-language framing:** "On the floor, do people work from big screens, tablets, or phones? Do any teams have only tablets? What paper do you hand out today — dispatch lists, changeover sheets, pick lists?"
**A good answer contains:** roles mapped to devices (especially any tablet-only users); the printed artifacts they rely on.
**Watch out:** Tablet-only users get full capability — identify them specifically.
**Ref:** Q14 → D34. *Answer:*

### Q-OP-D — Shop-floor authentication
**Ask:** How should shop-floor users authenticate — shared-terminal sessions, badge/RFID login, kiosk-mode timeouts — given operators often work on shared devices?
**Plain-language framing:** "On a shared floor terminal, how should an operator log in — a badge tap, a shared session, a short PIN? And how quickly should it lock?"
**A good answer contains:** the login mechanism for operator roles and session/timeout expectations (distinct from office SSO).
**Ref:** AQ5 → A9. *Answer:*

---

## Theme 8 — KPIs, alerts, retention & deployment

### Q-KP-A — KPIs & targets
**Ask:** Which KPIs does Magna track, at what level (plant, line), and what are the targets/thresholds?
**Plain-language framing:** "What numbers do you watch to know the plant is running well — on-time delivery, adherence, OEE, scrap — and what's a good vs bad value for each?"
**A good answer contains:** the KPIs that matter, the level tracked, and target/warning values.
**Watch out:** Ask which ones drive action today — those belong on the default dashboards and may warrant alerts.
**Ref:** Q20 → D42. *Answer:*

### Q-KP-B — Alerts & notifications
**Ask:** What events should raise alerts, to whom, and on which channel (in-app, phone, email)?
**Plain-language framing:** "When something needs attention — an at-risk delivery, a machine down, a shortage, something waiting for approval — who should be told, and how?"
**A good answer contains:** events mapped to recipient roles and channels, with a severity.
**Watch out:** Over-alerting makes people ignore alerts — focus on the few events that truly need a person.
**Ref:** Q21 → D42. *Answer:*

### Q-RT-A — Record retention requirements
**Ask:** Which OEM customer-specific requirements (CSRs) and regulations govern record retention for Magna's programs, and what is the longest required period?
**Plain-language framing:** "For each customer/program, how long are you contractually required to keep production and traceability records? Any at 20 years?"
**A good answer contains:** the binding CSRs (GM, Ford, Stellantis…) and the longest period.
**Watch out:** The IATF baseline (life + 1 year) is almost never the binding number — the customer manual is. (We default to life of program + 15 years.)
**Ref:** Q23 → D46. *Answer:*

### Q-DP-A — Who operates isolated deployments
**Ask:** For any isolated single-tenant deployment, who operates it — vendor-operated in vendor accounts, vendor-operated in the client's cloud account, or client-operated? (May differ per deployment.)
**Plain-language framing:** "If you wanted a dedicated, isolated instance rather than the shared service, would you want us to run it in our cloud, run it in *your* cloud, or run it yourselves?"
**A good answer contains:** the operating model and any cloud/residency constraints (determines which clouds we must support).
**Note:** Partly a commercial/IT-strategy question; lower urgency than the operational themes.
**Ref:** AQ1 → A1, D24. *Answer:*

---

## Internal / deferred (not for the client — tracked for our own resolution)

These are open but resolved by us, not the client. Listed for completeness so nothing is lost.

| Item | What | Resolve when | Ref |
|---|---|---|---|
| Optimizer engine | Build vs configure; CP / MILP / metaheuristic / commercial APS | Scheduling-module detailed design, via benchmark on representative client constraint sets (needs Q-PL-D rules as input) | AQ6 / D18 |
| Agent confidence model | Composition of agent proposal confidence + graduated-autonomy calibration thresholds | Deferred agentic build; conservative human-approved posture until then | AQ8 / A16, A17 |
| Eventing schema language | Avro/Protobuf + schema registry (resolved direction; finalize at build) | Implementation | AQ4 / A4, A12 |

---

## Coverage map (traceability)

Every open client-facing question in the specs is represented, plus new boundary/labor-scope questions this consolidation surfaced:

| Source log | IDs covered | Pack location |
|---|---|---|
| **Boundary & engine scope (new)** | A0–A8 | **Part A** — validates D1/D15/D20/D29/D43 against the client's real engines; raises the labor-scope fork |
| Scheduling Q-series | Q1–Q26 (all) | Part B, Themes 1–8 |
| Net-requirements NRQ | NRQ1–NRQ6 | Themes 2, 6 |
| Network allocation NMAQ | NMAQ1–NMAQ5 | Theme 5 |
| Architecture AQ (client-facing) | AQ1, AQ5 | Themes 7, 8 |
| Architecture AQ (internal) | AQ4, AQ6, AQ8 | Internal/deferred section |
| Master Data MDQ | (all resolved — none open) | — |

---

*End of pack — Draft v1.1.*
