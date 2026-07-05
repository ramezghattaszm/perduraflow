# Production scheduling module — business & functional specification

| | |
|---|---|
| **Document** | Business & functional specification — production scheduling module |
| **Product** | Manufacturing operations platform; production scheduling is module #1 (first deployment: Magna International) |
| **Status** | Draft v0.11 |
| **Date** | 2026-06-14 |
| **Companion docs** | Platform architecture specification (Draft v0.10); Master Data module specification (Draft v0.4); Net-requirements module specification (Draft v0.3); Network material allocation module specification (Draft v0.3) |
| **Intended use** | Source-of-truth for the build; to be handed to Claude Code for implementation |

---

## 1. Purpose & how to read this document

This document captures the **business and functional** decisions for the production scheduling module. It is deliberately implementation-agnostic: it states *what* the system must do, *what data it consumes and produces* (to the property level), and *the rules it must respect*. It does **not** specify technology, deployment, model architectures, or solver internals — those belong in the separate architecture specification.

**Platform context (A7/A8):** production scheduling is **module #1 of the manufacturing operations platform** defined in the platform architecture specification. The platform kernel owns the cross-cutting concerns this document describes generically — identity & access, tenancy, roles & permissions (Section 9), the organizational model (5.7), configuration (Section 14), audit (D6), notifications (14.3) — and this module **registers** its dashboards, actions, approval hooks, configuration entries, and notification events with that kernel. The data contracts in Section 4 are founding entries of the **platform contract registry** (A8); each contract's counterpart is a per-tenant binding — another platform module, a connector, an upload, or native maintenance. Nothing in this document's functional rules changes as a result; the platform context governs *where capabilities live*, not what they do.

Where a functional decision has an implementation consequence, it is flagged with `→ Architecture doc` rather than resolved here.

Sections 4 (data contracts), 5 (master data model), and 9–10 (roles and dashboards) carry the property-level detail intended to drive build scaffolding. A glossary of terms and acronyms is in Appendix A.

---

## 2. Scope

### 2.1 In scope

The platform is the **scheduling and reasoning core** that turns demand and capacity signals into a committed, executable production schedule, using machine learning for parameter prediction and generative AI for reasoning around the schedule.

### 2.2 Out of scope (external inputs / existing systems)

> **Note (A8):** "external" here means *external to this module*, not necessarily external to the platform. Each item below sits behind a registered contract; per tenant, the counterpart may be the client's existing system (connector/upload), native in-app maintenance, or — where the platform offers one — **another platform module** the tenant subscribes to. The contracts are fixed; the counterpart is a binding choice.

- **Demand planning module** — already exists. Produces the gross demand signal (digested OEM releases) that the net-requirements module nets into the demand input the scheduler consumes (Section 4.1, D20).
- **Capacity planning module** — being built separately per the boundary in Section 6; provides the capacity envelope and leveling guidance (Section 4.2). Its internal logic is out of scope here, but its **output contract** is defined in this document because the scheduler consumes it.
- **Net-requirements module** — derives pre-netted net requirements from gross demand and gross inventory (on-hand / WIP / in-transit) (D14, D20). Built and documented separately (its own specification); the scheduler consumes its output as the demand signal in Section 4.1.
- **ERP (SAP), PLM, MES, EDI/customer portal** — systems of record and execution layers the platform integrates with. Integration mechanics → Architecture doc.
- **Workforce rostering / HR system** — external. Assigns individual operators to shifts/stations and provides the resulting **labor-pool availability** (headcount by skill per shift, Section 5.3) the platform consumes. Individual operator scheduling is out of scope (D29); if built later it will be a separate module (D43).
- **Network material allocation module** — decides the split of a shared raw-material supply across plants in a sharing group (D50). Built and documented separately; the scheduler consumes its result as inbound scheduled receipts (Section 4.8) and returns the material requirements feedback (Section 4.10).
- **Outbound logistics / carrier planning** — shipment consolidation, carrier selection, and transport scheduling are external. The platform's outputs (committed schedule, ASN-related signals via EDI, Section 13) may feed such systems, but no transport decision is made here.

### 2.3 Operating context (assumptions)

- Tier 1 automotive supplier environment: EDI-driven demand (planning 830, firm shipping 862, sequenced JIT 866), JIT and just-in-sequence (JIS) delivery obligations.
- Regulated under **IATF 16949** — production decisions must be reconstructable (Section 7).
- **Multi-plant from day one** (Magna is highly decentralized). Plant scoping and the plant-local→global part mapping (D12) are active from the initial release (D32). The scheduler operates per plant; cross-plant allocation is an upstream decision (D32, Q12). Plants may be grouped into tenant-defined **plant groups** (clusters/divisions, D49) for reporting scope and, where enabled, shared-resource pooling.
- **EV transition is a target operating context, not a separate feature set.** EV programs are expected to stress existing capabilities rather than require new ones: frequent engineering change (D10 effectivity), ramp-up volatility (firm fence D23, demand deltas D14, nervousness control D44), new part families (extensible attributes, Section 5.4), and potentially different release patterns (e.g. platform-based pull rather than JIS — `demand_type` in 4.1). Whether EV programs follow a materially different demand/release pattern is a client question (Q26).

### 2.4 Product vision (platform, multi-client)

The longer-term goal is a **client-agnostic manufacturing operations platform** — a platform kernel with subscribable domain modules giving a single view across manufacturing and supply-chain processes (A7), of which **production scheduling is module #1**, with **Magna as the first deployment** (D21, D51). Future module candidates include a foundational **Master Data module** (parts & BOM; A13), plus demand planning, capacity planning, net-requirements, network material allocation, labor scheduling & optimization, maintenance, and supply-chain logistics — each slotting in behind a contract this document (or a sibling specification) already defines.

Not every component will be built for the initial Magna release, but the functional model and data contracts in this document must avoid encoding Magna-specific assumptions that would prevent scaling to other clients. Concretely: all master data is conceptually **tenant-scoped** (one client's plants, parts, and resources are isolated from another's), and "global" identifiers — e.g. the global `part_no` in D12 — are global **within a client/tenant**. Tenancy and isolation mechanics → Architecture doc.

The platform must support **two deployment topologies without rework** (D24): multiple tenants sharing one instance/database with logical isolation (the SaaS offering), and a single tenant in a fully isolated, dedicated instance/database (the single-client offering with strict isolation). Because the same product is sold either way, tenant scoping is pervasive in the data model from the start.

---

## 3. Decision log

Each decision is numbered for stable reference. Rationale is summarized; fuller reasoning lives in the design discussion.

| ID | Decision | Rationale (summary) | Status |
|---|---|---|---|
| **D1** | Build the scheduling + reasoning core only. Demand and capacity planning are external input modules. | Keeps scope on where the ML/GenAI value lives. | Agreed |
| **D2** | **Division of labor**: deterministic optimization owns the schedule; ML predicts uncertain parameters that feed the optimizer; GenAI reasons *around* the schedule and never generates the job sequence. | LLMs are strong at orchestration/explanation, weak at combinatorial optimization; auditability requires deterministic sequence generation. | Agreed |
| **D3** | ML prediction targets, in priority order: (1) sequence-dependent changeover/setup time, (2) cycle/processing time, (3) downtime/failure probability, (4) scrap/yield. | These are the noisy inputs that most degrade schedule quality when taken from static master data. | Agreed |
| **D4** | A **guardrail/validation layer** gates every proposal in two stages: (1) **hard gates** — deterministic feasibility, delivery-window, and material-availability checks a proposal must pass to be valid; (2) an **approval policy** that routes valid-but-risky proposals to human approval (D25, D26). LLM output is always a *proposal*, never a committed plan. | Safe deployment of GenAI in a regulated manufacturing environment. | Agreed |
| **D5** | **Closed feedback loop**: execution actuals retrain the ML prediction models. | Keeps predictions tracking reality (tooling wear, mix, seasonal labor). | Agreed |
| **D6** | **Traceability** of AI decisions: log model versions, optimizer objective/constraints used, and any LLM prompt/output that influenced a committed plan. Pin model versions; low temperature for decision-influencing LLM calls. | IATF reconstructability vs LLM stochasticity. | Agreed |
| **D7** | Master data holds the **nominal/standard baseline** (standard setup, standard cycle). ML overlays **learned corrections** stored *separately*. | Master data stays the auditable, governable baseline; ML adjustments stay transparent and reversible. | Agreed |
| **D8** | Model changeover by **attribute transitions**, not part-to-part pairs. Parts carry scheduling attributes (colour, material, gauge, tool family); the changeover matrix is keyed on attribute transitions. | N×N part matrix is unmaintainable and sparse; attribute model is compact and maintainable. | Agreed |
| **D9** | **Tooling (dies/molds/fixtures) is a first-class finite constrained resource**, not a part attribute. Has eligibility (which machines it fits), tool life, and single-location constraint. | Prevents plans that require one die in two places at once. | Agreed |
| **D10** | **Effectivity dating** on all master data; the scheduler resolves the version effective at the *scheduled* date, not "current." | Frequent engineering changes (ECN/ECR), ramp-up/down; required for reconstructability. | Agreed |
| **D11** | Model **alternate routings** (primary + alternates with preference/cost). | Gives the optimizer room to relieve bottlenecks or route around downed machines. | Agreed |
| **D12** | **Multi-plant scoping**: do **not** assume plants share part numbers. Support **plant-local part numbers mapped to a global part identity** via an explicit Plant part mapping (Section 5.1). Internal references use the global `part_no`; inbound plant-local / customer numbers are resolved at ingestion. Process and resource models remain plant-specific. | Magna is decentralized (independent plant numbering / ERP instances likely); an explicit mapping handles both shared and independent numbering and supports scaling to other clients. | Agreed |
| **D13** | Demand **firmness horizon must be explicit** (firm vs forecast). The scheduler sequences the firm zone; the forecast zone informs material/capacity smoothing only. | Prevents schedule churn from soft-forecast wiggles; the top cause of planner distrust. | Agreed |
| **D14** | Prefer demand **deltas** over full snapshots. The scheduler consumes **pre-netted net requirements**; netting against gross inventory happens upstream, not in the scheduler. | Keeps the scheduler's input single-purpose and isolates netting logic plus its inventory dependency in one place. | Agreed |
| **D15** | **Capacity module boundary = the envelope.** It owns the available-capacity profile, leveling decisions, and the demand–capacity reconciliation verdict. It does **not** hand down committed finite quantities-per-bucket. | Committing finite quantities would force the capacity module to replicate the scheduler's full constraint model, creating two sources of truth that drift. Model each binding constraint once, at the grain where it binds. | Agreed |
| **D16** | Capacity leveling guidance is **respect-but-may-deviate**. The scheduler may deviate when fine-grain reality forces it and **reports deviations back**. | Keeps the two modules from fighting; closes the loop. | Agreed |
| **D17** | **Shared reference data** (resource calendars, maintenance windows) is modelled **once** (one source of truth) and consumed at each layer's own grain. | The one legitimate case of both layers touching the same data; neither *decides* it. | Agreed |
| **D18** | Build-vs-configure of the optimization engine, and the specific optimization technique (CP/MILP/metaheuristic/APS), are deferred. **The optimizer sits behind a contract** (A8): the optimizer is a per-tenant **binding** to `{ native_heuristic \| platform_optimizer \| external_solver_connector }`, the last being a third-party engine (an OptiSuite-class solver) — so "wrap an existing solver or replace it" is a binding/config change, not a code change, with no consumer impact. Engine selection (AQ6) stays open and orthogonal: whatever is chosen, or a third party, plugs in identically. | Implementation choice. The contract-bound binding makes the solver pluggable for free (the platform's general module-replaceability applied to the optimizer). | Open `→ Architecture doc` |
| **D19** | The constraint-placement split between capacity module and scheduler is fixed per Section 6.2. | Operationalizes D15. | Agreed |
| **D20** | A separate **net-requirements module** sits between demand planning and the scheduler: it consumes gross demand and gross inventory (on-hand / WIP / in-transit) and outputs the pre-netted net requirements the scheduler consumes (Section 4.1). Documented in its own specification. | Isolates netting and its live-inventory dependency from the scheduler; whether the client's demand planning module already nets or must expose gross inventory is an open client question (Q1). | Agreed |
| **D21** | **Product goal: a client-agnostic (multi-tenant capable) scheduling platform**, with Magna as the first deployment. Not all components will be built for the initial release, but the data model and contracts must avoid Magna-specific assumptions that would block scaling to other clients. Tenancy / isolation mechanics → Architecture doc. | Build a reusable product, not a one-off. | Agreed |
| **D22** | **Capacity buckets are telescoping**: fine grain near-term (e.g. daily), coarser mid-horizon (weekly), coarsest far out (monthly). Exact boundaries pending client planning practice (Q3). | Matches how demand certainty decays; avoids hiding near-term peaks while keeping the long horizon cheap. Stays coarser than scheduling per D15. | Agreed |
| **D23** | **Firm/forecast fence is configurable per customer/program**, with the per-line `firmness` flag (Section 4.1) as the operative source of truth. | OEM frozen windows are contractual and differ by customer/program; a single global fence would misrepresent them. Portable to other clients (D21). | Agreed |
| **D24** | **Multi-tenancy is a first-class requirement.** The platform must support both deployment topologies without rework: (a) multiple tenants sharing one instance/database with logical isolation (SaaS), and (b) a single tenant in a fully isolated, dedicated instance/database (single-client). Tenant scoping is pervasive in the data model (Section 4 conventions). Isolation, deployment, and data-residency mechanics → Architecture doc. | The offer is sold either as a single-client deployment or as multi-client SaaS. | Agreed |
| **D25** | Human-in-the-loop uses a **configurable, rule-based trigger set with tiered approval** (not a single global risk score). Each rule watches a risk dimension; a fired rule routes the proposal to its configured approval tier (e.g. planner → supervisor → plant manager), and the highest required tier wins. Rules and tiers are **per-tenant configurable** (D24). See Section 5.5. | Transparent and auditable (you can see *which* rule fired); flexible across clients; supports starting conservative and automating as trust grows. | Agreed |
| **D26** | **LLM-influenced proposals require human approval by default.** Auto-approval is permitted only where explicitly configured, and that configuration is **per rule/tier**, never global. Launch posture is conservative. | Maximum client flexibility while keeping AI-influenced decisions human-reviewed until trust is established. | Agreed |
| **D27** | **Lot-sizing is a per-part(-plant) policy**: one **base method** (`lot_for_lot` or `fixed_period`) plus optional **stackable modifiers** (minimum lot, lot multiple, pack rounding, maximum lot). Tool-life max (D9) always applies on top as a hard constraint and is not a policy option. **EOQ is excluded** (unsuitable for dependent JIT demand). Default for a new part: lot-for-lot with pack rounding on. See Section 5.6. | Matches how planners actually size runs (a base rule plus exceptions); flexible without being a free-for-all. | Agreed |
| **D28** | **Campaigning is optimizer-decided by default** — a soft tradeoff between changeover savings (via the D8 attribute model) and JIT/inventory cost; how aggressively it campaigns is an objective weighting → Architecture doc. **Mandatory** sequencing is captured separately as **hard, attribute-keyed sequencing rules** of four types — required ordering, contiguity, forbidden/conditional transition, max-consecutive — configurable **per resource group and per tenant** (D24). The changeover matrix (D8) expresses transition *cost*; sequencing rules express transition *legality*. See Section 5.4. | Lets the optimizer optimize where it should, while enforcing the non-negotiable rules (paint, material campaigns, cleanouts) that would otherwise cause scrap. Scales to each client's rule set. | Agreed |
| **D29** | **Labor is an optional, selectively-applied finite constraint** — default machine-paced (labor not binding for the run); operations flagged `labor_constrained` carry a labor requirement. Modeled as a **capacity pool by skill per shift** (not individual operators) for initial scope; individual operator rostering is a later enhancement (MES/HR concern). **Setup labor is distinguished from run labor** (a changeover may need a skilled setter even on a machine-paced line). Aggregate labor availability can feed the capacity envelope (D15); fine-grain labor contention is the scheduler's. **Refined to certification grain by D54** (a specific certification required at a specific operation, with gap detection) for cases like leak-test/torque-critical stations. The skill/certification taxonomy is **Master-Data-owned (MD15)**, consistent with the resource-ownership move (D53). See Section 5.3. | Labor binds in some operations (assembly, inspection, setup) and not others (machine-paced presses); modeling it selectively avoids both ignoring real constraints and over-building a full labor scheduler. | Agreed |
| **D30** | **The scheduler feeds a labor requirements signal back to the capacity module** (closing the requirements loop). Over the firm horizon it derives required headcount by skill per shift (D29 labor requirements applied to scheduled work) and returns it (Section 4.7); the capacity module compares required vs available and resolves any shortfall as a leveling decision (D16) — authorize overtime, second shift, or **temporary/contract labor** (possibly skill-specific) — or, if none is available, the shortfall stands as a hard constraint and the affected demand surfaces as **at-risk** (which can trip approval rules, D25). The capacity module also computes its own rough-cut labor requirement over the longer/forecast horizon where no schedule exists yet (CRP logic → its own spec). | The scheduler has the most accurate near-term view of labor need; feeding it back lets the client add resources or accept the constraint deliberately, rather than discovering the shortfall on the floor. | Agreed |
| **D31** | **Temporary/contract labor has two sourcing tiers** (D30). (a) A **pre-qualified contractor pool** the company already has access to — prior experience, no onboarding — usable immediately *subject to its availability*; modeled as a Labor pool with `pool_type = contractor_prequalified`. (b) **New temp acquisition** beyond that pool — available only after a `lead_time`. Shortfall coverage draws from the pre-qualified pool first (no lead time), then new hires (lead time). | Lead time is not constant: known contractors can be leveraged on availability, while new sourcing carries a lead time that may exceed the frozen window. | Agreed |
| **D32** | **Multi-plant from day one.** The platform operates across multiple plants from the initial release; plant scoping (`plant_id`) and the plant-local→global part mapping (D12) are active from the start, not deferred. **Scheduling is performed per plant** (resources, tools, routings, calendars are plant-specific, D12). **Cross-plant sourcing/allocation** — deciding *which* plant makes a given demand — is an upstream demand/capacity decision and out of scope for the scheduler; demand arrives already allocated to a plant (Section 4.1 `plant_id`), pending client confirmation (Q12). | Magna is decentralized with many autonomous plants; building multi-plant from the start avoids a costly retrofit and matches the multi-tenant goal (D24). | Agreed |
| **D33** | **Roles are configurable, not hardcoded.** Each tenant is seeded with a default role set on launch; every role can be renamed, added, or removed. A role maps to a **permission set** = dashboard access **plus per-action rights within each dashboard** (view / edit / approve / etc.), a **data scope** (plant / multi-plant / tenant), and an **approval tier** (D25). See Section 9. | Clients use different role names and structures; the same underlying capability set maps differently per tenant (D24). | Agreed |
| **D34** | **Capability follows the user/role, not the device.** The **tablet is a full peer to the web** (including schedule authoring and what-if), since some floor users have only a tablet. The **phone is restricted** to alerts, approvals with context, exception triage, status, and key KPIs — no full editing. **Print/PDF** covers dispatch lists, changeover sheets, pick lists, KPI summaries, and approval/audit records. See Section 11. | Don't lock a tablet-only user out of authoring; don't cram authoring onto a phone. | Agreed |
| **D35** | **Integration supports three modes per external system**, selectable per tenant: (a) a **configured connector** to a source system, (b) **structured file upload** (defined templates), and (c) **native in-app maintenance** — the platform itself is the system of record. Whether the platform is ever system of record vs always mirroring an external source is a per-tenant choice (Q15). See Section 13. | Multi-tenant clients differ — some run SAP, some have no ERP; the platform must serve all without assuming a particular source. | Agreed |
| **D36** | **Material/component availability is an explicit input** feeding the material-availability hard gate (D4). The scheduler explodes the BOM (Section 5.1) against planned quantities and checks component/raw availability over time against (a) current inventory position and (b) inbound scheduled receipts (supplier deliveries). A component shortfall makes a job infeasible at that time; an unresolved shortfall surfaces as **at-risk** (like labor, D30). Distinct from finished-good netting, which the net-requirements module handles (D20). Sourced via the D35 modes. See Section 4.8. | The material hard gate cannot function without a materials data source; modeling it explicitly closes that gap. | Agreed |
| **D37** | **Multi-level scheduling with a make/buy split.** The scheduler explodes the BOM (Section 5.1); for `make` components (own routing) it generates **dependent demand** and schedules their production with a **hard precedence** constraint (a parent operation cannot start until its required made components are available), each level subject to its own lot-sizing (D27) and its production lead time (derived from its routing). `buy` components are validated against the material-availability input only (D36), never scheduled. Linear in-plant flow within a single part stays a multi-operation routing (already supported); multi-level is reserved for genuinely distinct made parts. Dependent demand is **system-generated** and distinct from the demand input (4.1), which is independent/customer demand only. Cross-plant stays out (D32): a made component from another plant is an inbound receipt (4.8), not cross-plant scheduling. **Dependent demand is netted against the component's on-hand/WIP before production** (the scheduler owns component-level netting; finished-good/independent netting is the net-requirements module's, NR1). | Tier 1 plants make in-house sub-assemblies as distinct stocked parts; without dependent scheduling the material gate would simply fail when they aren't on hand. | Agreed |
| **D38** | **Foundational reference and header entities defined.** Reference entities `Plant`, `Customer`, and `Program` are defined (Section 5.7); the per-customer/program firm fence (D23) lives on `Customer` (default) and `Program` (override). Transactional header records `Schedule version` and `Optimizer run` are defined (Section 4.9): committed-schedule rows (4.4) belong to a `Schedule version`, and the audit trace (4.6) is the compliance projection of an `Optimizer run`. | Several entities were referenced but undefined; defining them and siting the firm fence closes the loop. | Agreed |
| **D39** | **Setup-time combination = replace-with-fallback.** The effective setup for a job on a resource is the matched `changeover_matrix.setup_time` (the full sequence-dependent setup for that attribute transition, D8) when a transition rule matches; otherwise it falls back to `operation.setup_time_std` (the standalone setup — first job on the resource, following idle, or no matching transition). The two are **never summed** (no double-counting). The ML layer corrects the matrix transition value against actuals (D3, D7). | Unambiguous and hard to misuse; matches the matrix-as-cost framing. An additive base + increment model is available later only if a client has a genuinely separable always-incurred fixed setup. | Agreed |
| **D40** | **Single canonical base UoM per part.** Each part has one base unit of measure (Part master `uom`); all internal quantities for that part — demand, inventory, BOM `qty_per`, planned quantities, lot-sizing — are in that base UoM, so BOM explosion and the material check need no runtime conversion. Inbound quantities in another unit are converted to the base UoM **at ingestion** via a per-part UoM conversion table (Section 5.1). `qty_per` is expressed as component base-UoM per one parent base-UoM. | Mixed units (ordered in eaches, stocked in kg) otherwise make BOM explosion and material checks error-prone; normalizing once at the boundary keeps the engine clean. | Agreed |
| **D41** | **ML predictions carry a confidence score.** Each prediction (changeover, cycle, downtime, yield — D3) is produced with a normalized confidence (0–1); the values used in a schedule persist their confidence (Section 4.4) and are surfaced on dashboards. Low-confidence predictions are visually flagged (schedule board, approval queue), and the `ml_reliance` approval trigger (D25) evaluates confidence (and/or deviation from standard). Low-confidence thresholds are per-tenant configurable. | Planners need to know how much to trust an ML-adjusted value; confidence makes reliance visible and gives the `ml_reliance` trigger something concrete to act on. | Agreed |
| **D42** | **Configuration catalog & governance.** All tenant configuration is consolidated in Section 14; it is tenant-scoped (D24), gated by the `configure` permission (D33), effectivity-dated (D10) and audited (D6), and a change that affects a committed schedule produces a reschedule proposal through the guardrail rather than auto-applying (Section 12). KPI definitions/targets and alert/notification rules are added as configurable entities (Sections 14.2–14.3). | One place to see everything that must be set up per tenant; configuration changes are governed like any other parameter change. | Agreed |
| **D43** | **Workforce rostering is an external system.** Assigning individual operators to shifts/stations is out of scope (D29); the platform consumes the resulting **labor-pool availability** (headcount by skill per shift, Section 5.3) from an external workforce rostering / HR system (via the D35 modes) and may share its labor requirements feedback (4.7) to inform rostering. If such scheduling is built later, it will be a **separate module** (like the net-requirements and capacity modules), not folded into the scheduler. **Scope clarification (D54):** consuming *certification-level availability* as a constraint — and surfacing a *human-confirmed* cross-train/overtime **fill proposal** when a certification gap is detected — is in scope and is **not** rostering; the system never owns operator→station assignment (that confirmed-proposal boundary keeps D43 intact). | Rostering is a distinct problem (labor law, individual availability, per-person certifications) best modularized; keeps the scheduler focused. | Agreed |
| **D44** | **Stability-biased rescheduling (nervousness control).** Re-optimization minimizes disruption by default: it prefers local repair over full re-sequencing, never moves in-progress jobs, and protects committed jobs inside a configurable **schedule stability window** (default: current shift + next shift), changing only what the trigger requires and surfacing the delta. Full re-optimization is available on demand. Mechanics → Architecture doc. | A scheduler that reshuffles the board on every change loses planner trust; stability is the right default, full re-optimization the exception. | Agreed |
| **D45** | **Master-data completeness is validated, not assumed.** Before scheduling a part the platform checks that required master data is present and valid (routing/operations, attributes where sequencing applies, labor requirement where labor-paced, UoM, calendars). Missing or invalid data does not produce a silent or guessed schedule: the affected demand is held and a **data-quality exception** is surfaced (default `block`; `warn` configurable per tenant). | Silent mis-scheduling on incomplete master data is worse than a visible gap; detect and surface. | Agreed |
| **D46** | **Long, configurable data retention for recall traceability.** Schedule versions (4.9/4.4) and audit traces (4.6) are retained for the **life of the program plus 15 years** by default, never auto-purged without an explicit configured trigger, and configurable per tenant/customer/regulation to the **longest applicable requirement** (IATF baseline is life-of-part + 1 year; OEM customer-specific requirements run longer — e.g. GM 15 years after last build, some programs 20). Storage/tiering mechanics → Architecture doc. | Automotive recalls surface years after build; retention must clear the highest customer/regulatory bar, so the safe default is long. | Agreed |
| **D47** | **Scheduling horizon is per-plant configurable.** The detailed scheduling horizon (how far forward the scheduler sequences) is a per-plant setting (default 4 weeks) and must at minimum cover the firm fence (D13/D23). Demand beyond the horizon informs but is not finitely sequenced. | Horizon length is plant/industry specific; a per-plant default with a firm-fence floor keeps it sane out of the box. | Agreed |
| **D48** | **Configuration ships with a complete, safe default set (install-and-go).** Every configurable item ships with a sensible, broadly applicable default (lot-sizing D27, machine-paced labor D29, stability window D44, retention D46, scheduling horizon D47, seeded roles D33, and so on, Section 14.4) so a tenant can install/subscribe and operate with minimal setup, overriding only what differs. Defaults bias to the safe choice (require approval, long retention, block on bad data). | The product should be usable on day one without a configuration project; clients tune rather than build. | Agreed |
| **D49** | **Plant groups (clusters/divisions) are a first-class, tenant-defined grouping entity.** A `Plant group` collects plants under a `group_type` (`cluster`, `division`, `region`, `custom`); a plant may belong to multiple groups of different types. Two distinct uses, deliberately kept separate: (a) **reporting/scope groups** (e.g. divisions) drive roll-up dashboards, KPIs, and role data scope; (b) **resource-sharing groups** (e.g. a co-located cluster) may scope shared finite pools — initially **labor pools** (Section 5.3), later optionally tools. A cluster-scoped pool is contended for by the per-plant schedulers that share it. This **amends D32's scope, not its core**: scheduling remains per plant and demand allocation remains upstream; what changes is that a shared pool can bind across plants in the same sharing group. Group membership never implies sharing — sharing is opted into per pool. Client structure tracked as Q24. | Magna's Mexico footprint shows both needs: division roll-up (Cosma vs Exteriors vs Seating) and a dense geographic cluster (~11 Coahuila plants within ~30 km) where labor realistically flexes across plant boundaries. A flat tenant→plant model can't express either. | Agreed |
| **D50** | **Shared raw-material allocation across plants is an external module** (the network material allocation module), consistent with the module pattern (D15, D20, D43). It decides how a common supply (e.g. steel coil for a body & chassis cluster, resin for a molding cluster) is split across the plants in a sharing group; its allocation lands in the scheduler as ordinary per-plant **inbound scheduled receipts (4.8)** — the scheduler's input contract is unchanged. To close the loop, the scheduler emits a **material requirements feedback** output (Section 4.10, mirroring the labor feedback 4.7): per-plant component requirements and shortfalls over the firm horizon, which the allocation module uses to rebalance. The scheduler never reallocates material between plants itself; an unresolved shortfall surfaces as at-risk (D36), unchanged. Allocation logic, supplier contracts, and mill scheduling are out of scope of this document (own specification). Client sourcing practice tracked as Q25. | Mill/supplier allocation is a supply decision at network grain, not a sequencing decision — same reasoning that externalized netting and capacity. Routing it through the existing receipts contract keeps the scheduler clean; the feedback output is the only genuinely new surface. | Agreed |
| **D51** | **Production scheduling is module #1 of the manufacturing operations platform** (architecture spec A7–A11). The platform kernel owns identity & access, tenancy & module entitlement, the shared organizational model (Plant, Plant group, Customer, Program, Calendar, users/roles/tiers), and the configuration, audit, and notification frameworks; this module **consumes** those kernel capabilities and **registers** its contributions (contracts 4.1–4.10 into the platform contract registry per A8; Section 10 dashboards and actions; D25 approval hooks; Section 14 configuration entries; 14.3 notification events). The "external modules" of 2.2 become per-tenant **contract bindings** — client system, upload, native, or platform module. No functional rule in this document changes; the platform context governs where capabilities live, not what they do. | The boundaries this spec already drew (D15, D20, D43, D50) *are* the platform pattern; formalizing them as a kernel + subscribable modules creates the single-view, multi-module product without redesigning the scheduling functionality. | Agreed |
| **D52** | **Tooling/equipment and physical part attributes are Master-Data-owned, not scheduling-owned** (Master Data spec MD10/MD11, governed by the ownership principle MD12). The **Tool/die/mold** entity and Tool–part mapping (5.3) move to the Master Data **asset domain** (`asset` contract); the scheduler consumes asset definitions and consumes live tool usage/status as transactional state (like inventory, 4.8). **Physical part attributes** — `material`, `gauge`, `colour` (5.4) — move to Master Data (nested in the `part` contract); the scheduler retains only the **changeover matrix** and **sequencing rules** that reference them. The tool-life cap (D9), single-location constraint, eligibility, and the attribute-keyed changeover model (D8) are unchanged in behavior — only the ownership of the underlying data moves. | The ownership principle (MD12): tooling and physical attributes have clear cross-module potential (maintenance, quality, logistics), so they are foundational master data; the scheduler's optimizer logic that acts on them stays scheduling's. No functional change, ownership relocated. | Agreed |
| **D53** | **Production resources (machines, lines, work-centres) and resource groups are Master-Data-owned** (Master Data spec MD14, ownership principle MD12). The **Resource** and **Resource group** definitions (5.3) move to the Master Data **asset domain** (`asset` contract); scheduling and the capacity envelope (4.2) **consume** them, and operations reference a Master Data `resource_group_id` for eligibility. Live resource state (up/down, utilization) is transactional (sourced via MES / future maintenance module), consumed not owned. Resource-group interchangeability and the capacity grain are unchanged in behavior — only data ownership moves. | The ownership principle (MD12): machines are the clearest cross-module asset (maintenance, OEE, capacity all read them); resource groups travel with them as the shared capacity grain. No functional change, ownership relocated. | Agreed |
| **D54** | **Certification-grain labor constraint with human-confirmed fill (refines D29).** Beyond the skill-pool grain (D29), a `labor_constrained` operation may require a **specific certification** (e.g. leak-test, torque-critical) as a **hard constraint**. The scheduler detects a **certification gap** — no present, qualified operator covers a required certification this shift — and treats it as a feasibility constraint on the affected operation (re-sequences around the reduced effective capacity, with D44 stability). It may surface a **fill proposal** — a cross-train pull or an overtime call-in of a *named* qualified operator — but only as a **human-confirmed proposal** (Tier-3 of A18 / D26): the system **never owns operator→station assignment** (D43 boundary). The skill/certification taxonomy and operator qualifications are **Master-Data-owned (MD15)**, externally sourced; live presence/availability is transactional via D35. | The demo's leak-test cert gap is a real, common constraint a machine-only scheduler misses; modelling it at certification grain (not just headcount-by-skill) catches the station-stopping case. Keeping fill to a confirmed proposal makes it labor-*aware scheduling*, not rostering — D43 stands. | Agreed |
| **D55** | **What-if option-sets with structured rationale (the explicit-trade-off decision).** For a single change (e.g. a demand revision 100→120), the scheduler generates a small set of **feasible options**, **costs** each against its objective (delivery, changeover, overtime, inventory, displacement), and **ranks** them — generation, costing, and ranking are all scheduling, the same objective math that picks the live sequence. Each option carries a **structured rationale**: the per-factor objective contribution, the binding constraints, and the score. A selected option is a **proposal committed through the guardrail** (D4/D26) — chosen by a human, re-solved live, never auto-applied. **Verbalising** the rationale into plain language is the **narration surface (A19)** — translation only, never reasoning; the structured rationale is the source of truth and stands without it. Option contract = {schedule delta, costed KPIs, rank, structured rationale}. The disposition (which option chosen, edited, reason) feeds the proposal disposition record (4.11, A17). **Demo-scoped now** (single-change option-sets); a general dynamic scenario-generation engine is later (completion log). | This is the lead decision Magna asked for — turning a planner's judgement call into a fast, transparent, comparable, *explained* decision. Splitting structured rationale (deterministic, scheduling) from its verbalisation (A19) is what lets GenAI narrate the "why" without ever making or reasoning about the decision (D2). | Agreed |
| **D56** | **Tool-wear signal from the closed loop.** When the closed-loop/actuals path (D5, 4.3) observes learned-vs-standard **cycle deviation crossing a configurable threshold** (sustained), it emits a **typed drift/wear event** — a signal only, not a maintenance decision or a tool-life model. The (deferred) maintenance module is its eventual consumer; for now it routes to the **notification surface (14.3)**. The same drift drives the Tier-1 learned-parameter update (A18/A14) — the wear flag is a byproduct of learning the true cycle time, not separate machinery. | The "flagged the tool before anyone noticed" beat is nearly free — it is a threshold on a deviation the loop already computes. Emitting a signal (not owning maintenance semantics) keeps tool-life logic out of the scheduler and honest about what is built (a flag, not prediction-of-failure). | Agreed |
| **D57** | **Plan-comparison primitive + baseline-as-frozen-engine-mode.** A primitive that **snapshots a plan and diffs two plans' KPIs**, with a typed baseline source: (a) `frozen_engine_snapshot` — *this engine* with the continuous-learning and stability layers **frozen at a periodic snapshot** and **naive policies** substituted (FIFO/EDD sequencing, first-come allocation, overtime-to-cover); both arms share the continuously-learned standards up to the freeze, so the gap is purely the value of the live layers and **ages honestly** (re-snapshot cadence is per-tenant config, safe default). The baseline is a **mode of the scheduler, not a separate model** (inherits A18 — standards are learned, the baseline just omits the *post-freeze* continuous learning + stability). (b) `measured_historical` — a tenant's actual recorded outcomes (MES/historian, via D35); the pilot/real-data proof and the calibration check on the counterfactual. **Shared with D55's what-if** (a what-if option is an alternate plan; both reduce to score-and-diff two plans). Adds a **schedule-churn / nervousness metric** to the dashboard (§10/14.2) and KPI source-tagging: scheduler-computed (delivery, utilization, changeover, throughput), event-derived (line-stops-avoided), consumed-from-labor-model (labor cost — needs an MD15 labor-rate field), churn. The **naive policy set** is a small deterministic build, reused for the demo climax. | A replan baseline must be reproducible, explainable, and ML-free in the *comparison* sense — and "the same engine with the live layers off" achieves all three by construction, while ageing with the plant because both arms inherit learned standards. One primitive serves the daily counterfactual, the demo climax, and the pilot's real-data benchmark, so nothing is throwaway. | Agreed |

---

## 4. Data contracts — inputs & outputs (property level)

### Conventions

- **Type** values are *logical* (string, integer, decimal, datetime, boolean, enum, reference). Physical types/formats → Architecture doc.
- **Req** = Required: `Y` mandatory, `N` optional, `C` conditional (condition stated in Rules).
- `reference` = a foreign key to a master-data or transactional entity defined elsewhere in this document.
- All datetimes are timezone-qualified at the property level (plant-local with offset) — exact representation → Architecture doc.
- All entities are **tenant-scoped** (D24): a `tenant_id` is part of every record's identity and every `reference`. It is omitted from the per-property tables below for brevity. Global identifiers (e.g. `part_no`) are global *within* a tenant.
- Quantities for a part are expressed in that part's **canonical base UoM** (Part master `uom`, D40); inbound quantities in other units are converted at ingestion. A `uom` shown on a transactional record echoes that base unit.

---

### 4.1 INPUT — Demand signal

**Source:** Net-requirements module (D20; separate specification), which derives this from the demand planning module's gross demand and gross inventory. **Grain:** one record per demand line (per part, per delivery requirement, per release revision).

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `demand_line_id` | string | Y | Unique identifier for the demand line within the platform. |
| `release_reference` | string | Y | Reference to the originating customer release / EDI document (830/862/866). Carried through to the schedule for traceability (D6). |
| `revision_seq` | integer | Y | Monotonic revision counter for this demand line; supports delta processing (D14). |
| `change_type` | enum(`add`,`change`,`remove`) | Y | Delta indicator vs prior revision (D14). Full snapshots represented as a set of `add`s. |
| `revision_timestamp` | datetime | Y | When the demand module produced this revision. |
| `part_no` | reference → Part master | Y | The global `part_no` (D12); plant-local or customer numbers are resolved to it at ingestion. |
| `customer_part_no` | string | N | OEM part number (differs from internal). |
| `program` | reference → Program | N | Customer / vehicle program. |
| `customer_id` | reference → Customer | Y | Customer (OEM); resolved at ingestion. |
| `plant_id` | reference → Plant | Y | Producing plant (D12). |
| `demand_type` | enum(`JIT`,`JIS`,`stock`) | Y | Drives sequencing obligations. |
| `firmness` | enum(`firm`,`forecast`) | Y | Firm = must sequence/hit; forecast = planning only (D13). |
| `required_qty` | decimal | Y | **Net** demand quantity — already netted against on-hand / WIP / in-transit by the net-requirements module (D14, D20). |
| `uom` | enum | Y | Unit of measure for `required_qty`. |
| `required_date` | datetime | Y | Required delivery/availability date. |
| `delivery_window_earliest` | datetime | C | Earliest acceptable delivery. Required for `JIT`/`JIS`. |
| `delivery_window_latest` | datetime | C | Latest acceptable delivery. Required for `JIT`/`JIS`. |
| `ship_to_location` | string | Y | Customer ship-to / plant. |
| `dock` | string | N | Receiving dock at ship-to. |
| `standard_pack_qty` | decimal | N | Standard pack/container quantity; informs lot sizing. |
| `cumulative_qty` | decimal | N | Customer cumulative (CUM) received reference for reconciliation. |
| `priority` | integer | N | Relative priority for contention; lower = higher priority. Default by `program`/contract if absent. |
| **JIS-only block** | | | Present when `demand_type = JIS`. |
| `jis_sequence_number` | integer | C | Position in the customer build sequence. |
| `jis_line_side_time` | datetime | C | Required line-side delivery time. |
| `jis_vin_reference` | string | N | VIN/unit linkage. |
| `jis_broadcast_id` | string | N | Broadcast/pull batch identifier. |

**Netting (D14, D20):** the scheduler receives **pre-netted net requirements** and does not net. Netting against gross inventory is performed upstream by the separate net-requirements module, whose input/output contract — including the inventory sources and refresh frequency it consumes — is defined in its own specification. Whether the client's existing demand planning module already performs netting or must instead expose gross inventory for this module is an open client question (Q1).

**Firm/forecast fence (D23):** the per-line `firmness` flag is the operative signal the scheduler acts on. A configurable fence **per customer/program** sets how far out demand is expected to be firm and bounds how far the scheduler hard-sequences; it is configuration data, not a demand-line property. Fence values per customer/program are pending client input (Q3).

**Independent demand only (D37):** this input carries independent / customer demand. Dependent demand for in-house `make` components is generated by the scheduler via BOM explosion and is not part of this input.

---

### 4.2 INPUT — Capacity envelope & leveling guidance

**Source:** Capacity planning module. **Grain:** one record per resource group × time bucket, plus an associated leveling-guidance set and a reconciliation verdict. Per D15 this is an **envelope**, never committed finite quantities.

#### 4.2.1 Available-capacity profile

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `capacity_record_id` | string | Y | Unique identifier. |
| `plant_id` | reference → Plant | Y | |
| `resource_group_id` | reference → Resource group | Y | Aggregate resource the capacity is stated for (not a specific machine). |
| `bucket_start` | datetime | Y | Start of the time bucket. |
| `bucket_end` | datetime | Y | End of the time bucket. |
| `available_capacity` | decimal | Y | Net available capacity in the bucket, with calendars/shifts/planned downtime already applied (D17). |
| `capacity_uom` | enum(`hours`,`units`,`shifts`) | Y | Unit of `available_capacity`. |
| `planned_downtime` | decimal | N | Planned downtime already netted out (reported for transparency). |
| `aggregate_load` | decimal | N | Rough-cut load placed against this group/bucket by the capacity module's finite check. For reference only — not a committed job plan. |
| `overload_flag` | boolean | Y | True if rough-cut load exceeds available capacity (rough-cut finite check). |

> **Telescoping grain (D22):** buckets are variable-width — typically daily near-term, weekly mid-horizon, monthly far out. `bucket_start`/`bucket_end` carry the actual span; consumers must not assume uniform bucket length. Exact boundaries pending client planning practice (Q3).

#### 4.2.2 Leveling guidance (boundary conditions — respect-but-may-deviate, D16)

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `guidance_id` | string | Y | Unique identifier. |
| `plant_id` | reference → Plant | Y | |
| `resource_group_id` | reference → Resource group | Y | |
| `effective_from` | datetime | Y | |
| `effective_to` | datetime | Y | |
| `build_ahead_qty` | decimal | N | Suggested build-ahead to smooth load. |
| `overtime_authorized` | boolean | N | Whether OT capacity is sanctioned in this window. |
| `second_shift_authorized` | boolean | N | Whether a second shift is sanctioned. |
| `outsourcing_authorized` | boolean | N | Whether outsourcing is sanctioned for affected parts. |
| `temp_labor_authorized` | boolean | N | Whether temporary/contract labor is sanctioned to cover a skill shortfall (D30). |
| `temp_labor_skill_id` | reference → Skill | C | Skill the temp authorization applies to; required when `temp_labor_authorized` is skill-specific. |
| `temp_labor_headcount` | decimal | C | Additional heads authorized for the window. |
| `temp_labor_lead_time` | duration | C | Time until the authorized new heads are available: ~0 when drawn from the pre-qualified contractor pool, otherwise the new-hire onboarding lead time (D31). |
| `guidance_note` | string | N | Free-text rationale for planner visibility. |

#### 4.2.3 Reconciliation verdict

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `reconciliation_id` | string | Y | Unique identifier. |
| `plant_id` | reference → Plant | Y | |
| `horizon_start` / `horizon_end` | datetime | Y | Reconciled horizon. |
| `status` | enum(`feasible`,`overloaded`,`infeasible`) | Y | Aggregate-grain verdict of demand vs capacity. |
| `escalation_required` | boolean | Y | True when firm demand cannot fit the envelope; triggers upstream escalation rather than silent absorption (D15). |
| `escalation_note` | string | C | Required when `escalation_required = true`. |

---

### 4.3 INPUT — Execution actuals (feedback loop)

**Source:** MES / shop floor. **Grain:** one record per executed operation event. Feeds ML retraining (D5) and the deviation report (Section 4.5). *Integration mechanics → Architecture doc.*

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `actual_event_id` | string | Y | Unique identifier. |
| `schedule_job_id` | reference → Scheduled job | C | Links actual back to the scheduled job, when known. |
| `resource_id` | reference → Resource | Y | Specific machine the work ran on. |
| `tool_id` | reference → Tool | N | Tool actually used. |
| `part_no` | reference → Part master | Y | |
| `op_id` | reference → Operation | Y | |
| `actual_start` | datetime | Y | |
| `actual_end` | datetime | Y | |
| `actual_setup_time` | decimal | N | Observed changeover/setup duration (trains D3 changeover model). |
| `actual_cycle_time` | decimal | N | Observed per-piece cycle (trains D3 cycle model). |
| `good_qty` | decimal | Y | Conforming pieces produced. |
| `scrap_qty` | decimal | N | Scrapped pieces (trains D3 scrap/yield model). |
| `downtime_minutes` | decimal | N | Unplanned downtime during the event (trains D3 downtime model). |
| `downtime_reason` | string | N | Coded reason. |
| `preceding_part_no` | reference → Part master | N | Part that ran immediately before on this resource — the changeover *from* context (D8). |

---

### 4.4 OUTPUT — Committed schedule

**Consumers:** MES/SAP for execution; planners for review. **Grain:** one record per scheduled operation (job-operation) on a specific resource.

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `schedule_version_id` | string | Y | Version of the schedule this record belongs to. Schedules are versioned, never edited in place (D6). |
| `schedule_job_id` | string | Y | Unique scheduled job-operation identifier. |
| `status` | enum(`proposed`,`validated`,`committed`) | Y | A record only reaches `committed` after passing the guardrail layer (D4). |
| `part_no` | reference → Part master | Y | |
| `op_id` | reference → Operation | Y | |
| `op_seq` | integer | Y | Operation sequence within the routing. |
| `routing_id` | reference → Routing | Y | The routing chosen (primary or alternate, D11). |
| `resource_id` | reference → Resource | Y | Specific machine/line assigned. |
| `tool_id` | reference → Tool | C | Required when the operation needs a tool (D9). |
| `sequence_position` | integer | Y | Position of this job in the resource's ordered queue. |
| `planned_start` | datetime | Y | |
| `planned_end` | datetime | Y | |
| `planned_qty` | decimal | Y | Quantity to produce, derived from the net requirements (already netted upstream, D14/D20); respects lot/pack rules (D27, Section 5.6). |
| `predicted_setup_time` | decimal | Y | Effective setup used in planning, after replace-with-fallback resolution (D39). |
| `setup_source` | enum(`standard`,`ml_adjusted`) | Y | Whether the value is the master-data baseline or an ML correction (D7). |
| `predicted_cycle_time` | decimal | Y | Cycle used in planning. |
| `cycle_source` | enum(`standard`,`ml_adjusted`) | Y | As above (D7). |
| `linked_demand_lines` | list of reference → Demand line | Y | Which demand lines this job satisfies (traceability + CUM). |
| `jis_sequence_number` | integer | C | Carried through for JIS jobs. |
| `jis_delivery_commit_time` | datetime | C | Committed line-side delivery time for JIS. |
| `generated_by_run_id` | reference → Optimizer run | Y | The optimization run that produced this record (D6). |
| `validation_status` | enum(`pass`,`pass_with_override`,`pending`) | Y | Guardrail outcome (D4). |
| `approver_id` | string | C | Required when human approval was needed (D4, D25). |
| `approved_at` | datetime | C | As above. |
| `approval_tier_id` | reference → Approval tier | C | Tier the proposal was routed to; null if auto-committed (D25). |
| `triggered_approval_rule_ids` | list of reference → Approval rule | N | Which approval rules fired (D25); recorded for traceability. |
| `demand_origin` | enum(`independent`,`dependent`) | Y | `independent` = from the demand input (4.1); `dependent` = generated by BOM explosion for a made component (D37). |
| `pegged_to_job_id` | reference → Scheduled job | C | For dependent jobs, the parent job-operation this production supplies (D37). |
| `setup_confidence` | decimal (0–1) | C | ML confidence in `predicted_setup_time`; present when `setup_source = ml_adjusted` (D41). |
| `cycle_confidence` | decimal (0–1) | C | ML confidence in `predicted_cycle_time`; present when `cycle_source = ml_adjusted` (D41). |
| `at_risk` | boolean | Y | True if the job's delivery is at risk (e.g. labor or material shortfall, tight window). Drives the delivery/risk dashboard and the `customer_delivery_risk` approval trigger (D25, D30, D36). |
| `at_risk_reason` | enum + free text | C | Why it is at risk; required when `at_risk = true`. |

---

### 4.5 OUTPUT — Deviation report (to capacity module)

**Consumer:** Capacity planning module (D16). **Grain:** one record per resource group × bucket where the committed schedule departs from leveling guidance.

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `deviation_id` | string | Y | Unique identifier. |
| `plant_id` | reference → Plant | Y | |
| `resource_group_id` | reference → Resource group | Y | |
| `bucket_start` / `bucket_end` | datetime | Y | Bucket the deviation applies to. |
| `guidance_id` | reference → Leveling guidance | N | The guidance deviated from, if applicable. |
| `planned_load` | decimal | Y | Load the committed schedule actually places. |
| `guided_load` | decimal | N | Load the capacity guidance assumed. |
| `deviation_reason` | enum + free text | Y | Why the scheduler departed (e.g. changeover infeasibility, tool contention, JIS window). |

---

### 4.6 OUTPUT — Decision / audit trace

**Consumer:** compliance/traceability, planner explanations (D6, Section 7). **Grain:** one record per committed schedule version (with child references to influencing artifacts).

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `trace_id` | string | Y | Unique identifier. |
| `schedule_version_id` | reference → Schedule version | Y | |
| `optimizer_run_id` | reference → Optimizer run | Y | |
| `objective_summary` | string | Y | The optimizer objective/weights used for this run. |
| `constraint_set_ref` | reference | Y | The active constraint configuration. |
| `ml_model_versions` | list of {model_name, version} | Y | Every prediction model version that fed the run (D6). |
| `master_data_asof` | datetime | Y | Effectivity timestamp used to resolve master data (D10). |
| `llm_interaction_refs` | list of reference | N | Any LLM prompt/output that influenced this committed plan (D6). Empty if none. |
| `generated_at` | datetime | Y | |

---

### 4.7 OUTPUT — Labor requirements feedback (to capacity module)

**Consumer:** Capacity planning module (D30). **Grain:** one record per skill × shift over the firm horizon. The scheduler derives required labor from the operation labor requirements (Section 5.3) applied to the scheduled work; the capacity module compares to availability and resolves shortfalls via leveling (Section 4.2.2) or accepts the constraint.

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `feedback_id` | string | Y | Unique identifier. |
| `plant_id` | reference → Plant | Y | |
| `plant_group_id` | reference → Plant group | C | Set when the requirement draws on a cluster-shared pool (D49); the shortfall is reported at the pool's scope, not artificially split per plant. |
| `skill_id` | reference → Skill | Y | |
| `shift_bucket_start` / `shift_bucket_end` | datetime | Y | The shift/bucket the requirement applies to. |
| `required_headcount` | decimal | Y | Derived from scheduled labor-paced and setup labor needs (D29). |
| `available_headcount` | decimal | Y | From the labor pool (Section 5.3), including any authorized temp uplift. |
| `shortfall_headcount` | decimal | Y | `required − available` when positive; 0 otherwise. |
| `at_risk_demand_lines` | list of reference → Demand line | C | Demand at risk if the shortfall is not resolved; required when `shortfall_headcount > 0`. Feeds reconciliation and may trip approval rules (D25). |

---

### 4.8 INPUT — Material availability

**Source:** ERP / inventory / MES via the D35 modes. **Purpose:** feeds the material-availability hard gate (D4, D36). The scheduler explodes the BOM (Section 5.1) against planned quantities and checks component availability over time. Distinct from finished-good netting (handled upstream by the net-requirements module, D20) — this covers the components and raw materials needed to *run* a job.

**Inventory position** — current on-hand by material and location.

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `material_no` | reference → Part master | Y | Component/raw-material part (BOM components are parts). |
| `plant_id` | reference → Plant | Y | |
| `location` | string | N | Stock location within the plant, if tracked. |
| `on_hand_qty` | decimal | Y | Available on-hand quantity. |
| `uom` | enum | Y | |
| `as_of` | datetime | Y | Snapshot time; staleness affects feasibility. |

**Inbound scheduled receipts** — expected supplier/transfer deliveries.

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `receipt_id` | string | Y | Unique identifier. |
| `material_no` | reference → Part master | Y | |
| `plant_id` | reference → Plant | Y | |
| `expected_qty` | decimal | Y | |
| `expected_datetime` | datetime | Y | When the receipt is expected to be available. |
| `supplier_reference` | string | N | Source/supplier or transfer reference. |
| `status` | enum(`confirmed`,`expected`) | Y | Confirmation level; the gate should lean on `confirmed` receipts. |

> A job is material-feasible at a planned start only if its exploded component needs are met by on-hand plus receipts expected to land (per `status`) by that time. Unmet component needs make the job infeasible then; an unresolved shortfall surfaces as at-risk (D36).

---

### 4.9 Schedule version & optimizer run (header records)

Header/transactional records the contracts above reference (D38). *Lifecycle/persistence mechanics → Architecture doc.*

**Schedule version** — a versioned schedule snapshot; committed-schedule rows (4.4) are its lines.

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `schedule_version_id` | string | Y | |
| `plant_id` | reference → Plant | Y | Schedules are per plant (D32). |
| `status` | enum(`proposed`,`committed`,`superseded`) | Y | Versioned, never edited in place (D6). |
| `horizon_start` / `horizon_end` | datetime | Y | The window this version covers. |
| `generated_by_run_id` | reference → Optimizer run | Y | The run that produced it. |
| `created_at` | datetime | Y | |
| `supersedes_version_id` | reference → Schedule version | N | The version this one replaced. |

**Optimizer run** — one execution of the optimization engine.

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `run_id` | string | Y | |
| `plant_id` | reference → Plant | Y | |
| `trigger` | enum(`scheduled`,`event`,`manual`,`what_if`) | Y | What initiated the run (new demand, disruption, planner action, scenario). |
| `objective_summary` | string | Y | Objective/weights used (mirrored into the audit trace, 4.6). |
| `constraint_set_ref` | reference | Y | Active constraint configuration. |
| `ml_model_versions` | list of {model_name, version} | Y | Prediction model versions used (D6). |
| `started_at` / `finished_at` | datetime | Y | |
| `status` | enum(`success`,`infeasible`,`failed`) | Y | |

> The audit trace (4.6) is the compliance projection of an `Optimizer run` for a committed `Schedule version`: the run record carries operational metadata, the trace carries what IATF reconstruction needs (D6).

---

### 4.10 OUTPUT — Material requirements feedback (to network material allocation module)

**Consumer:** Network material allocation module (D50); may also inform procurement. **Grain:** one record per shared material × plant × time bucket over the firm horizon. The scheduler derives component requirements by exploding the BOM (Section 5.1) against the committed schedule; the allocation module compares requirements across the sharing group (D49) and rebalances supply, which returns as revised inbound receipts (4.8). Mirrors the labor feedback pattern (4.7, D30).

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `feedback_id` | string | Y | Unique identifier. |
| `plant_id` | reference → Plant | Y | |
| `plant_group_id` | reference → Plant group | C | The sharing group context, when the material is group-allocated (D49/D50). |
| `material_no` | reference → Part master | Y | The shared component/raw material. |
| `bucket_start` / `bucket_end` | datetime | Y | Requirement bucket. |
| `required_qty` | decimal | Y | Component quantity the committed schedule consumes in the bucket (BOM-exploded, base UoM, D40). |
| `covered_qty` | decimal | Y | Portion covered by on-hand plus receipts expected by need time (per 4.8 status rules). |
| `shortfall_qty` | decimal | Y | `required − covered` when positive; 0 otherwise. |
| `at_risk_demand_lines` | list of reference → Demand line | C | Demand at risk if the shortfall is not resolved; required when `shortfall_qty > 0`. Feeds the at-risk flag (4.4) and may trip approval rules (D25). |
| `schedule_version_id` | reference → Schedule version | Y | Version the requirement derives from (D6). |

> The scheduler reports requirements; it does not request or perform reallocation. Whether and how supply moves between plants is the allocation module's decision; the result arrives as updated receipts (4.8) and triggers stability-biased rescheduling as needed (D44).

---

### 4.11 OUTPUT — Proposal disposition record (AI suggestion vs. human decision)

**Consumers:** AI performance KPIs (14.2), preference learning (architecture A17), the graduated-autonomy track record (A16), audit (D6). **Grain:** one record per AI decision point that offered one or more proposals. Persists the **full ranked option set and the human's disposition** — not just the committed option — so "AI suggestion vs. actual" is concrete evidence rather than a lost signal.

| Property | Type | Req | Description / business rules |
|---|---|---|---|
| `disposition_id` | string | Y | Unique identifier. |
| `decision_point_ref` | reference | Y | What the proposals addressed (e.g. an optimizer run 4.9, a disruption triage, a reschedule). |
| `proposal_source` | enum(`optimizer`,`llm_influenced`,`agent_orchestrated`) | Y | What produced the proposals (mirrors the approval-rule source, 5.5). |
| `proposed_options` | list of {option_rank, option_ref, ai_confidence, summary} | Y | The **full ranked set** the AI offered, with its ranking and confidence (D41); one or more options. |
| `selected_option_rank` | integer | C | Which rank the human chose; null if none accepted (all rejected / deferred). |
| `selected_vs_top` | enum(`top`,`lower_ranked`,`none`) | Y | Whether the human took the AI's top pick, a lower-ranked option, or none — the core "did the human agree with the AI's ranking" signal. |
| `edited_before_commit` | boolean | Y | Whether the human modified the chosen option before committing. |
| `reason_code` | enum + free text | N | **Optional** rationale for the choice (encouraged, never mandatory — approvals are never blocked on it, A17). Unreasoned selections are weighted lower as learning signal. |
| `approver_id` | string | C | The deciding human; required when a human decided (D25). |
| `committed_schedule_version_id` | reference → Schedule version | C | The version that resulted, if one committed. |
| `outcome_ref` | reference | N | Link to realized outcome (from execution actuals, 4.3) for proposal-vs-outcome evaluation (A17); populated once actuals land. |
| `created_at` | datetime | Y | |

> **Why the full set, not just the winner (A17):** recording only the committed option discards the signal in "the human rejected the AI's top pick for #3." Persisting the ranked set, the selection, the edit flag, and the optional reason makes the AI's hit-rate measurable (14.2) and gives preference learning (A17) something to learn from — while `outcome_ref` ensures trust is judged against realized performance, not mere agreement (A16/A17).

---

## 5. Master data model (property level)

Master data and related configuration, organized into product definition (5.1), process definition (5.2), the resource model (5.3), sequencing drivers (5.4), the approval policy (5.5), and lot-sizing policy (5.6). All entities carry plant scoping where noted (D12) and effectivity dating where marked (D10). Master data is the **nominal baseline**; ML corrections are stored separately (D7) and are *not* part of these records. (5.5–5.6 are configuration rather than master data, kept here for completeness.)

### 5.1 Product definition

> **Platform note (A13/D51):** the entities in this subsection — **Part master, Plant part mapping, BOM component, UoM conversion** — are owned by the **Master Data module** (a foundational platform module), whose specification holds their authoritative definitions and which exposes them as the platform **part** and **BOM** contracts. The scheduling module **consumes** these via those contracts (per-tenant system-of-record binding per D35/Q15 attaches there) and **extends** the part with its own domain data keyed on the global `part_no` — routings and operations (5.2), the resource/tool model (5.3), sequencing attributes (5.4), and lot-sizing policy (5.6). The tables below are retained as a consuming view for readability; on any discrepancy the Master Data module spec governs. No functional rule changes; ownership is relocated to the Master Data module.

**Part master** — keyed on the **global** part identity (`part_no`); attributes may vary by plant.

| Property | Type | Req | Notes |
|---|---|---|---|
| `part_no` | string | Y | Global identity (D12). |
| `revision` | string | Y | |
| `customer_part_no` | string | N | OEM mapping. |
| `program` | string | N | |
| `uom` | enum | Y | The part's **canonical base UoM**; all internal quantities for the part are in this unit (D40). |
| `make_buy` | enum(`make`,`buy`) | Y | |
| `plant_id` | reference → Plant | C | Set where the record is plant-specific. |
| `effective_from` / `effective_to` | datetime | Y | (D10) |

**Plant part mapping** — maps each plant's local part number to the global `part_no` (D12). Do not assume plants share numbering.

| Property | Type | Req | Notes |
|---|---|---|---|
| `plant_id` | reference → Plant | Y | |
| `plant_part_no` | string | Y | Part number as used in that plant's own systems. |
| `part_no` | reference → Part master | Y | Resolved global part identity. |
| `effective_from` / `effective_to` | datetime | N | Optional; supports re-mapping over time (D10). |

> **Uniqueness & resolution:** `(plant_id, plant_part_no)` resolves to exactly one global `part_no`; one global `part_no` may carry many plant-local mappings. Inbound signals (demand, execution actuals) that arrive with plant-local or customer part numbers are resolved to the global `part_no` at ingestion; all internal references in this document use the global `part_no`.

**BOM component**

| Property | Type | Req | Notes |
|---|---|---|---|
| `parent_part_no` | reference → Part master | Y | |
| `component_part_no` | reference → Part master | Y | |
| `level` | integer | Y | Multi-level support. |
| `qty_per` | decimal | Y | Component base-UoM units per one parent base-UoM unit (D40). |
| `scrap_pct` | decimal | N | Component scrap factor. |
| `effective_from` / `effective_to` | datetime | Y | (D10) |

> `make` vs `buy` (Part master `make_buy`): a `make` component is scheduled as dependent demand with precedence to its parent (D37); a `buy` component is validated against the material-availability input only (D36).

**Unit-of-measure conversion** — per-part factor to normalize alternate units to the part's base UoM at ingestion (D40).

| Property | Type | Req | Notes |
|---|---|---|---|
| `part_no` | reference → Part master | Y | |
| `alternate_uom` | enum | Y | A unit the part may transact in externally. |
| `base_uom` | enum | Y | The part's canonical base UoM (Part master `uom`). |
| `factor` | decimal | Y | Multiply an alternate-UoM quantity by `factor` to get the base-UoM quantity. |

### 5.2 Process definition

**Routing** (D11)

| Property | Type | Req | Notes |
|---|---|---|---|
| `routing_id` | string | Y | |
| `part_no` | reference → Part master | Y | |
| `plant_id` | reference → Plant | Y | Plant-specific (D12). |
| `is_primary` | boolean | Y | |
| `preference_rank` | integer | C | Required for alternates; lower = preferred. |
| `effective_from` / `effective_to` | datetime | Y | (D10) |

**Operation**

| Property | Type | Req | Notes |
|---|---|---|---|
| `op_id` | string | Y | |
| `routing_id` | reference → Routing | Y | |
| `op_seq` | integer | Y | |
| `resource_group_id` | reference → Resource group | Y | Eligible resource group for this op. |
| `setup_time_std` | decimal | Y | Nominal **standalone** setup baseline (D7): used when the job is first on the resource, follows idle, or no changeover transition matches (D39). |
| `cycle_time_std` | decimal | Y | Nominal per-piece cycle baseline (D7). |
| `move_time` | decimal | N | |
| `queue_time` | decimal | N | |
| `is_secondary` | boolean | N | Secondary/post-processing operation. |
| `labor_constrained` | boolean | N | True where labor (not the machine) can bind this operation's run; default false = machine-paced (D29). Setup labor may still apply via the labor requirement even when this is false. |

### 5.3 Resource model

**Resource (machine / line / work centre)**

> **Platform note (D53/MD14):** the Resource and Resource group **definitions** are owned by the **Master Data module** (asset domain, `asset` contract) — scheduling and the capacity envelope (4.2) consume them. Live up/down and utilization are transactional state (MES / future maintenance), also consumed. The tables below are retained as a consuming view; the Master Data spec governs.

| Property | Type | Req | Notes |
|---|---|---|---|
| `resource_id` | string | Y | |
| `resource_group_id` | reference → Resource group | Y | Pooling/interchangeability. |
| `plant_id` | reference → Plant | Y | |
| `type` | enum | Y | e.g. press, molding, assembly. |
| `rate` | decimal | N | Throughput rate. |
| `rate_uom` | enum | N | |
| `calendar_id` | reference → Calendar | Y | Shared reference (D17). |

**Resource group**

| Property | Type | Req | Notes |
|---|---|---|---|
| `resource_group_id` | string | Y | |
| `plant_id` | reference → Plant | Y | |
| `member_resource_ids` | list of reference → Resource | Y | Interchangeable members. |

**Tool / die / mold / fixture** — first-class finite resource (D9)

> **Platform note (D52/MD10):** the tool/asset **definition** is owned by the **Master Data module** (asset domain, `asset` contract) — scheduling consumes it. Live `current_usage` and `status` are transactional state (sourced via MES / a future maintenance module, like inventory 4.8), also consumed, not owned here. The table below is retained as a consuming view; the Master Data spec governs.

| Property | Type | Req | Notes |
|---|---|---|---|
| `tool_id` | string | Y | |
| `tool_family` | string | Y | Used by changeover attribute model (D8). |
| `plant_id` | reference → Plant | Y | |
| `eligible_resource_ids` | list of reference → Resource | Y | Machines the tool can mount on. |
| `tool_life_units` | decimal | N | Life before maintenance (e.g. strokes/shots). |
| `tool_life_uom` | enum | N | |
| `current_usage` | decimal | N | Usage since last maintenance. |
| `status` | enum(`available`,`in_maintenance`,`retired`) | Y | |
| `single_location` | boolean | Y | Hard constraint: tool can occupy only one resource at a time (default true). |

**Tool–part mapping**

| Property | Type | Req | Notes |
|---|---|---|---|
| `tool_id` | reference → Tool | Y | |
| `part_no` | reference → Part master | Y | |

**Calendar** — shared reference, modelled once (D17)

| Property | Type | Req | Notes |
|---|---|---|---|
| `calendar_id` | string | Y | |
| `shift_patterns` | structured | Y | Shifts, breaks. |
| `holidays` | list of date | N | |
| `maintenance_windows` | list of {start, end, resource_id?} | N | Planned maintenance; consumed at aggregate grain by capacity, fine grain by scheduler (D17). |

**Skill** — a capability required by operations and provided by labor (D29).

| Property | Type | Req | Notes |
|---|---|---|---|
| `skill_id` | string | Y | |
| `name` | string | Y | e.g. press setter, weld operator, CMM inspector. |
| `description` | string | N | |

**Labor pool** — labor capacity by skill per shift (D29). Capacity-pool model, not individual operators; availability is sourced from the external workforce rostering / HR system (D43).

| Property | Type | Req | Notes |
|---|---|---|---|
| `pool_id` | string | Y | |
| `pool_type` | enum(`permanent`,`contractor_prequalified`) | Y | `permanent` = own workforce; `contractor_prequalified` = known contractors the company already has access to, usable on availability with no onboarding (D31). Default `permanent`. |
| `plant_id` | reference → Plant | C | Set for a plant-scoped pool. Exactly one of `plant_id` / `plant_group_id` is set. |
| `plant_group_id` | reference → Plant group | C | Set instead of `plant_id` for a **cluster-shared pool** (D49); requires the group's `allows_resource_sharing = true`. The pool is a shared finite constraint contended for by the per-plant schedulers in the group. |
| `skill_id` | reference → Skill | Y | Skill this pool provides. |
| `calendar_id` | reference → Calendar | Y | Shift pattern governing availability (D17); crews may differ from machine calendars. |
| `available_headcount` | decimal | Y | Headcount available per shift. |
| `resource_group_scope` | list of reference → Resource group | N | Groups this pool serves; null = plant-wide. |
| `effective_from` / `effective_to` | datetime | N | (D10) |

**Operation labor requirement** — what labor an operation needs, by phase (D29). Links to Operation (Section 5.2).

| Property | Type | Req | Notes |
|---|---|---|---|
| `op_id` | reference → Operation | Y | |
| `phase` | enum(`setup`,`run`) | Y | `setup` labor can apply even on machine-paced ops; `run` labor only where the op is `labor_constrained`. |
| `skill_id` | reference → Skill | Y | Skill required. |
| `headcount` | decimal | Y | Operators required. |
| `basis` | enum(`per_run`,`per_machine`,`per_unit_time`) | Y | `per_machine` captures operator-to-machine ratio (one setter, N machines); `per_unit_time` captures labor-paced throughput. |

> A machine-paced operation typically has only a `setup`-phase requirement (a setter) and no `run` requirement. A labor-paced operation has a `run` requirement (e.g. 3 operators `per_run`, or a `per_unit_time` rate) and `labor_constrained = true`.

### 5.4 Sequencing drivers (D8)

> **Platform note (D52/MD11):** the **physical part attributes** below (`colour`, `material`, `gauge`) are owned by the **Master Data module** (nested in the `part` contract) — scheduling consumes them. The **changeover matrix** and **sequencing rules** in this subsection are scheduling-owned: they *reference* Master Data attributes to compute transition cost and legality. The `tool_family` attribute links a part to its eligible Master Data asset family (MD10).

**Part attributes** — the changeover drivers (consumed from Master Data, MD11)

| Property | Type | Req | Notes |
|---|---|---|---|
| `part_no` | reference → Part master | Y | |
| `colour` | string | N | |
| `material` | string | N | |
| `gauge` | string | N | |
| `tool_family` | string | N | |
| `additional_attributes` | map | N | Extensible set of scheduling-relevant attributes. |

**Changeover matrix** — keyed on attribute transitions, not part pairs (D8)

| Property | Type | Req | Notes |
|---|---|---|---|
| `changeover_rule_id` | string | Y | |
| `attribute_type` | enum(`colour`,`material`,`gauge`,`tool_family`,`custom`) | Y | Which attribute the transition is on. |
| `from_value` | string | Y | |
| `to_value` | string | Y | |
| `setup_time` | decimal | Y | Nominal **full** sequence-dependent setup for this transition (D7 baseline); **replaces** the operation base when matched, never added (D39). |
| `applies_to_resource_group` | reference → Resource group | N | Scope; null = all. |

> The optimizer computes the actual changeover cost between two adjacent jobs from their parts' attributes against this matrix. The ML layer (D3) applies learned corrections to these baselines at run time.

**Sequencing rules (hard campaign constraints, D28)** — mandatory ordering the optimizer must obey, distinct from cost. Campaigning to *save* changeover is an optimizer tradeoff (soft, D28); these rules express what is *allowed or required* (legality). Attribute-keyed; configurable **per resource group and per tenant** (D24).

| Property | Type | Req | Notes |
|---|---|---|---|
| `rule_id` | string | Y | |
| `name` | string | Y | Human-readable. |
| `rule_type` | enum(`required_ordering`,`contiguity`,`forbidden_transition`,`max_consecutive`) | Y | One of the four hard-rule types (below). |
| `attribute_type` | enum(`colour`,`material`,`gauge`,`tool_family`,`custom`) | Y | Attribute the rule is keyed on. |
| `rule_parameters` | structured | Y | Type-specific (see table below). |
| `applies_to_resource_group` | reference → Resource group | C | Scope; null = all groups. |
| `active` | boolean | Y | |
| `effective_from` / `effective_to` | datetime | N | (D10) |

Parameters and meaning by `rule_type`:

| `rule_type` | Enforces | `rule_parameters` | Example |
|---|---|---|---|
| `required_ordering` | Within a contiguous group, attribute values must follow a fixed direction | ordered list of attribute values | paint colour light → dark |
| `contiguity` | Once started, all jobs of an attribute value run consecutively (no interleave) | the attribute value(s) that must not be split | run all of material A together |
| `forbidden_transition` | A transition is disallowed, or allowed only if a mandatory cleanout op is inserted | `from_value`, `to_value`, optional `required_cleanout` (op reference) | dark → light requires a purge cycle |
| `max_consecutive` | Cap how long a campaign runs before a forced clean/maintenance | attribute value, max count or duration, the clean/maintenance op to insert | max N runs before purge |

> `max_consecutive` can overlap the tool-life cap (D9) where the forced action is tooling maintenance — model them separately: tool life is physical wear, a campaign cap is process/quality policy.

### 5.5 Approval policy (configuration)

Per-tenant configuration (D24) consumed by the guardrail & validation capability. It operates **only on proposals that have already passed the hard gates** (feasibility, delivery-window, material). It defines which valid-but-risky proposals route to which approval tier, and where auto-commit is permitted (D25, D26).

**Approval tier** — the configurable approval levels.

| Property | Type | Req | Notes |
|---|---|---|---|
| `tier_id` | string | Y | |
| `name` | string | Y | e.g. planner, supervisor, plant manager. |
| `rank` | integer | Y | Authority ordering; higher = more authority. When multiple rules fire, the highest-ranked required tier wins. |
| `approver_assignment` | string / structured | N | Role or group holding this tier's authority. |

**Approval rule** — the configurable risk triggers.

| Property | Type | Req | Notes |
|---|---|---|---|
| `rule_id` | string | Y | |
| `name` | string | Y | Human-readable. |
| `trigger_type` | enum(`customer_delivery_risk`,`proposal_source`,`override_lever`,`ml_reliance`,`disruption_magnitude`,`custom`) | Y | Risk dimension the rule watches. |
| `trigger_parameters` | structured | C | Threshold(s) for the trigger, e.g. `jobs_resequenced > N`; `ml_confidence < Y` or `ml_deviation_pct > X`; `lever in {overtime, outsourcing}`. |
| `applies_to_proposal_source` | enum(`all`,`optimizer`,`llm_influenced`,`agent_orchestrated`) | Y | Lets rules target LLM-influenced or **agent-orchestrated** proposals specifically (D26; agentic graduated auto-commit → architecture A16). |
| `required_tier` | reference → Approval tier | Y | Tier the proposal routes to when this rule fires. |
| `auto_approve_allowed` | boolean | Y | Whether this rule may be configured to auto-commit instead of routing to a human. Default **false** for `llm_influenced` (D26). |
| `active` | boolean | Y | |
| `effective_from` / `effective_to` | datetime | N | |

> **Evaluation:** a proposal that passes the hard gates is evaluated against all active rules. Each fired rule contributes its `required_tier`; the proposal routes to the **highest-ranked** required tier. If no rule fires (or every fired rule permits auto-approve), the proposal may auto-commit. LLM-influenced proposals default to requiring approval unless a rule explicitly permits auto-approve for that source (D26). Which rules fired is recorded on the committed schedule (Section 4.4).

### 5.6 Lot-sizing policy (per part)

Per-part (per-plant, D12) policy that turns a net requirement into one or more production runs (D27). Structured as **one base method plus optional stackable modifiers**. The tool-life maximum (D9) always applies on top as a hard constraint and is *not* part of this policy. **EOQ is intentionally not supported** — it assumes stable, independent demand and an order-vs-carry tradeoff, which overbuilds under dependent JIT demand. Default for a new part: `lot_for_lot` with `round_to_pack` on.

**Lot-sizing policy**

| Property | Type | Req | Notes |
|---|---|---|---|
| `part_no` | reference → Part master | Y | Policy is per part. |
| `plant_id` | reference → Plant | C | Set where the policy is plant-specific. |
| `base_method` | enum(`lot_for_lot`,`fixed_period`) | Y | The single base rule. Default `lot_for_lot`. |
| `fixed_period_length` | duration | C | Required when `base_method = fixed_period`; the window whose demand is combined into one run. |
| `min_lot` | decimal | N | Modifier — floor; runs below it round up. |
| `lot_multiple` | decimal | N | Modifier — round up to a multiple of this. |
| `round_to_pack` | boolean | N | Modifier — round up to `standard_pack_qty` (Section 4.1). Default true for new parts. |
| `max_lot` | decimal | N | Modifier — policy cap; larger requirements are split. |
| `effective_from` / `effective_to` | datetime | N | (D10) |

> Modifiers stack: a policy may apply several at once (e.g. lot-for-lot, never below 50, always full pallets). When several apply, they resolve in order — base method → `min_lot` → `lot_multiple` / `round_to_pack` → `max_lot` — then the tool-life cap bounds the result.

**Base method — when and why to pick each**

| Base method | Pick when | Why |
|---|---|---|
| `lot_for_lot` | demand is steady, or changeover is cheap, or JIT/JIS dominance makes minimizing inventory the priority | produces exactly to need — lowest inventory, simplest to audit |
| `fixed_period` | pure lot-for-lot produces too many short runs, near-term demand is lumpy but groupable, or a predictable run cadence is wanted | groups a window's demand into one run, cutting changeovers at the cost of some build-ahead within the window |

**Modifiers — when and why to apply each**

| Modifier | Apply when | Why |
|---|---|---|
| `min_lot` | a part has high setup cost and small or sporadic demand | avoids uneconomically short runs |
| `lot_multiple` | a physical process unit dictates batch size (oven, rack, tray, heat-treat load) | aligns the run to the process so equipment isn't half-filled |
| `round_to_pack` | parts ship in standard containers (the common auto case) | whole-container production; no partial-pack handling |
| `max_lot` | WIP/inventory exposure or flow needs bounding independent of tooling | caps a single run for flow control — distinct from the tool-life hard cap |

> The **tool-life maximum** (D9) is always enforced regardless of policy and is not listed as an option; it silently caps any run.

### 5.7 Organizational & reference entities

Foundational reference data, tenant-scoped (D24).

**Plant**

| Property | Type | Req | Notes |
|---|---|---|---|
| `plant_id` | string | Y | |
| `name` | string | Y | |
| `timezone` | string | Y | Plant-local timezone (datetimes are plant-local with offset, Section 4 conventions). |
| `region` / `location` | string | N | |
| `status` | enum(`active`,`inactive`) | Y | |

**Plant group** — tenant-defined grouping of plants (D49). A plant may belong to multiple groups of different types. Reporting/scope groups (divisions, regions) drive roll-up and role scope; sharing-enabled groups (clusters) may scope shared pools (Section 5.3).

| Property | Type | Req | Notes |
|---|---|---|---|
| `plant_group_id` | string | Y | |
| `name` | string | Y | e.g. "Coahuila cluster", "Cosma division". |
| `group_type` | enum(`cluster`,`division`,`region`,`custom`) | Y | `cluster` = resource-sharing candidate; `division`/`region` = reporting/scope. |
| `member_plant_ids` | list of reference → Plant | Y | |
| `allows_resource_sharing` | boolean | Y | Only groups with `true` may scope shared pools (D49). Default `false`. |
| `effective_from` / `effective_to` | datetime | N | (D10) |

**Customer** — the OEM / customer.

| Property | Type | Req | Notes |
|---|---|---|---|
| `customer_id` | string | Y | |
| `name` | string | Y | |
| `firm_fence` | duration | N | Default firm/forecast fence for this customer (D23); a program-level fence overrides it. |

**Program** — a customer / vehicle program.

| Property | Type | Req | Notes |
|---|---|---|---|
| `program_id` | string | Y | |
| `customer_id` | reference → Customer | Y | |
| `name` | string | Y | |
| `firm_fence` | duration | N | Overrides the customer default fence (D23) when set. |

---

## 6. Capacity module boundary & constraint placement

### 6.1 Boundary statement (D15)

The capacity planning module owns the **envelope and leveling decisions** at the aggregate grain. It does **not** commit finite quantities-per-bucket. Its output is the contract in Section 4.2: an available-capacity profile, leveling guidance (respect-but-may-deviate), and a reconciliation verdict with an escalation path.

**Scope test for the build:** if a constraint requires knowing the *order of individual jobs* to evaluate, it does not belong in the capacity module.

### 6.2 Constraint placement

| Owned by **Capacity planning** (aggregate grain) | Owned by **Scheduler** (job/machine/minute grain) |
|---|---|
| Available capacity by resource group | Sequence-dependent changeover |
| Shift calendars & planned downtime (bucket grain) | Tool / die contention & tool life |
| Rough-cut finite check | Machine-level finite loading |
| Build-ahead & overtime leveling | JIS / dock delivery sequencing |
| Outsourcing decisions | Alternate routing selection |
| Demand–capacity reconciliation & escalation | Live WIP / inventory netting |
| Aggregate labor availability by skill | Fine-grain labor contention (skilled setter, labor-paced throughput) |

**Shared reference — modelled once, consumed at two grains (D17):** resource calendars, maintenance windows. Neither layer *decides* these; each reads them at its own grain.

### 6.3 The exception (degenerate case)

If scheduling is effectively degenerate — a dedicated line at fixed takt, single part family, no meaningful changeover or shared tooling — the capacity and scheduling grains converge and committing quantities is acceptable. This is **not** assumed to be the default for Magna stamping/molding operations.

---

## 7. Traceability & compliance (functional)

Under IATF 16949 the platform must be able to reconstruct **why** a production decision was made (D6). Functionally this requires:

- Schedules are **versioned, never edited in place**; every committed version has a decision/audit trace (Section 4.6).
- Each committed job records whether its setup/cycle times were the master-data baseline or an ML correction (`setup_source`, `cycle_source`).
- Master data is resolved by **effectivity date** and the as-of timestamp is recorded (`master_data_asof`).
- Any **LLM interaction that influenced a committed plan** is logged and referenced from the trace; LLM output that did not influence a committed plan need not gate, but is retained for explanation.
- The **approval-policy outcome** is recorded on each committed job: which rule(s) fired, the routed tier, and the approver (Sections 4.4, 5.5).
- Model versions are **pinned** per run; decision-influencing LLM calls run at low temperature for reproducibility. *(Mechanics → Architecture doc.)*
- Schedule versions and audit traces are **retained long-term** for recall traceability — default life of program + 15 years, never auto-purged without an explicit trigger, configurable to the longest applicable customer/regulatory requirement (D46). *(Storage mechanics → Architecture doc.)*

---

## 8. Functional capabilities (logical, non-architectural)

These describe *what* each capability does. Implementation → Architecture doc.

1. **Parameter prediction** — produce expected changeover, cycle, downtime, and yield values as inputs to scheduling; expose them with a `source` flag distinguishing baseline from correction and a confidence score (D3, D7, D41).
2. **Schedule generation** — produce a feasible, constraint-respecting sequence and resource assignment over the firm horizon (D2, D13), obeying hard sequencing/campaign rules (D28) and deciding soft campaigning as an optimization tradeoff. It explodes the BOM to schedule in-house `make` components as dependent demand with cross-level precedence (D37). The only producer of the job sequence.
3. **Reasoning & orchestration** — trigger schedule generation (including for what-if scenarios), triage disruptions in natural language, and explain/justify schedules and changes for planners (D2). Never emits the sequence itself. GenAI's bounded jobs (explain, triage, orchestrate) and the bounded-agentic and preference-learning layers are platform capabilities (architecture A15–A17): proposals only, human-approved by default (D26), with confidence-gated autonomy earned against outcomes — never generating the decision or skipping the hard gates.
4. **Guardrail & validation** — two separate jobs (D4). First, **hard gates**: deterministically check every proposal for feasibility, delivery-window compliance, and material availability — failing any one means the proposal is invalid. Second, on proposals that pass the hard gates, an **approval policy** of configurable rules routes valid-but-risky proposals to the appropriate approval tier; auto-commit only where explicitly permitted, and LLM-influenced proposals require approval by default (D25, D26). Which rule fired is logged (Sections 5.5, 7).
5. **Feedback & learning** — capture actuals, compare to predictions, and retrain (D5).
6. **Traceability** — record the audit trace for every committed schedule (D6, Section 7).
7. **Visibility & interaction** — present role-appropriate dashboards across web, tablet, and phone, and mediate parameter changes, approvals, overrides, and what-if through the guardrail and audit trail (Sections 9–13).

---

## 9. Users, roles & permissions

> **Platform note (D51/A9):** roles, permissions, and approval tiers are **kernel** capabilities; this section defines the scheduling module's seeded roles and its registered dashboards/actions within the platform RBAC framework. A tenant role spans all entitled modules.

Roles are configurable per tenant (D33), not hardcoded. A new tenant is seeded with the default role set below; each can be renamed, removed, or supplemented. A role maps to a permission set: which dashboards it can open, what it may do within each (view / edit / approve / etc.), its data scope, and its approval tier (D25). Roles and approval tiers together form the permission model; both are tenant-scoped (D24) and every action is audited (D6).

**Default role set (seeded on launch; all editable)**

| Default role | Primary need | Typical rights |
|---|---|---|
| Operator / line lead | What's running now and next; setup, tooling, qty, due time | View line/operator + maintenance views; status input |
| Scheduler / planner | Power user — review, what-if, adjust, exceptions with the AI assistant | View/edit schedule board; approve within tier |
| Supervisor | Mid-tier approvals; adherence; floor labor/shortfall | View most; approve mid tier |
| Plant manager | Plant KPIs; high-tier approvals (at-risk OEM delivery) | View all (plant); approve high tier |
| Materials / logistics | Material availability; JIS/dock sequencing; CUM | View delivery/material; flag |
| Multi-plant / exec | Cross-plant KPI and risk roll-up | View-only, cross-plant scope |
| Maintenance / tooling | Tool life, contention, upcoming maintenance | View/edit maintenance view; status input |
| Admin / configurator | Master data, rules, tiers, fences, dashboards | Configure (tenant scope) |

**Role** (configuration)

| Property | Type | Req | Notes |
|---|---|---|---|
| `role_id` | string | Y | |
| `name` | string | Y | Tenant's own label (e.g. "shift lead"). |
| `is_default_seed` | boolean | N | True for roles seeded at launch; informational. |
| `data_scope` | enum(`plant`,`plant_group`,`multi_plant`,`tenant`) | Y | Breadth of data the role can see/act on. `plant_group` scopes the role to one or more groups (e.g. a division, D49). |
| `scoped_plant_ids` | list of reference → Plant | C | When the role is limited to specific plants. |
| `scoped_plant_group_ids` | list of reference → Plant group | C | When `data_scope = plant_group`; the role sees all member plants of the listed groups (D49). |
| `approval_tier_id` | reference → Approval tier | N | Highest tier this role may approve at (D25); null = no approval authority. |

**Role permission** (mapping — one row per role × dashboard)

| Property | Type | Req | Notes |
|---|---|---|---|
| `role_id` | reference → Role | Y | |
| `dashboard_id` | reference → Dashboard | Y | Dashboard this rule governs (Section 10). |
| `can_view` | boolean | Y | Dashboard-level access. |
| `actions` | list of enum(`edit`,`approve`,`status_input`,`run_whatif`,`export_print`,`configure`) | N | Per-action rights within the dashboard (D33). Absent/empty = view-only. |

> The same dashboard is "view-only" or "editable" purely by whether `edit` is in `actions` — there is one schedule board, gated per role (D33).

---

## 10. Dashboards & views

Dashboards are the unit of access control (D33). Each is gated by role permissions (Section 9) and renders on the surfaces noted (Section 11).

| Dashboard | Primary roles | Shows | Key actions |
|---|---|---|---|
| Schedule board (Gantt / sequence) | Planner | Per resource/line, time-phased; changeovers, tool, predicted vs standard times, low-confidence predictions flagged, at-risk jobs | edit (drag-adjust), run_whatif, export_print |
| Line / operator view | Operator | Current + next job, setup, tooling, qty, due time | status_input |
| Maintenance / tooling view | Maintenance, planner | Tool life remaining vs scheduled load, tools nearing maintenance, contention/conflicts, die/mold availability & eligibility, upcoming maintenance windows | status_input, edit (maintenance scheduling) |
| Exception & approval queue | Planner, supervisor, manager | Proposals pending approval by tier; exceptions (machine down, shortfall, at-risk delivery); AI-proposed options with tradeoffs and ML reliance/confidence | approve |
| Performance / KPI | Manager, exec | Schedule adherence, OEE, on-time delivery, changeover time, WIP, throughput, scrap, prediction accuracy (model health) | export_print |
| Delivery & customer risk | Planner, manager | Firm orders & JIS pulls at risk; CUM status | export_print |
| Capacity & labor | Planner, supervisor | Load vs capacity by group; labor required vs available and shortfalls (D30) | export_print |
| Multi-plant overview | Exec, manager | Cross-plant KPI and at-risk roll-up | export_print |

**Dashboard** (configuration) — the catalog is configurable so tenants can enable/disable or add views.

| Property | Type | Req | Notes |
|---|---|---|---|
| `dashboard_id` | string | Y | |
| `name` | string | Y | |
| `enabled` | boolean | Y | Per-tenant on/off. |
| `supported_surfaces` | list of enum(`web`,`tablet`,`phone`,`print`) | Y | Where it can render (Section 11). |

---

## 11. Surfaces, devices & print

Capability follows the user's role, not the device (D34). The same role carries the same rights wherever it signs in; the surface only limits what is practical to render, and a role's per-action rights still apply on every surface.

| Surface | Role / use | Capability |
|---|---|---|
| Large screen (web) | Planner cockpit; read-only floor wallboards | Full — schedule board, what-if, config, analysis, multi-plant |
| Tablet | Floor users who may have only a tablet | **Full peer to web** including authoring and what-if, touch-optimized |
| Phone | On-the-go supervisors/managers | **Restricted** — alerts, approvals with context, exception triage, status, key KPIs; no full editing |
| Print / PDF | Dispatch & records | Shift dispatch list per line, changeover sheets, material/pick lists, daily KPI summary, approval/audit records |

> Authoring happens on large screen or tablet; consumption on wallboards/tablet; acting (approve, triage, alerts) from phone. The phone simply does not expose `edit` even where the role holds it.

---

## 12. Interaction flows

How users change things and approve, consistent with effectivity (D10), the guardrail (D4), approval policy (D25/D26), and audit (D6).

- **Parameter change** — a user with `configure`/`edit` rights changes a parameter (e.g. a lot-sizing policy, a fence, a rule). Changes are **effectivity-dated** (D10) and **audited** (D6). If the change affects an already-committed schedule it does **not** auto-apply — it generates a reschedule **proposal** that passes back through the guardrail (hard gates + approval policy) before commit.
- **Approval** — proposals needing sign-off appear in the exception & approval queue, routed to the role/tier the approval policy selected (D25). Approvers act within their `approval_tier`. LLM-influenced proposals require approval by default (D26).
- **Override** — an authorized approver may accept a flagged proposal; the result is recorded as `pass_with_override` with `approver_id`/`approved_at` (Section 4.4) and the triggering rule(s) logged.
- **What-if** — a planner describes or configures a scenario; the system parameterizes it, runs the optimizer, and shows the delta against the current schedule. Nothing commits until explicitly accepted through the guardrail.
- **Re-optimization** — when a trigger fires (disruption, parameter change, manual), re-optimization is **stability-biased** by default: it repairs locally, never moves in-progress jobs, and protects committed jobs inside the schedule stability window, surfacing only the necessary delta (D44). A planner can request full re-optimization explicitly.
- **Data-quality exception** — if a part lacks required, valid master data, its demand is held and a data-quality exception is surfaced rather than scheduled on guessed values (D45).
- **Alerts / notifications** — exceptions and at-risk events push to the phone surface for triage and approval; the alert carries enough context to act or escalate.

---

## 13. Integration & interfaces

Functional view of what flows to and from each external system. Integration **mechanics** (protocols, auth, EDI parsing, cadence) → Architecture doc. Each interface uses one of the **binding modes** (D35, extended by A8): configured **connector**, structured **file upload**, **native in-app maintenance** (platform as system of record), or — where the platform offers one — a subscribed **platform module** fulfilling the same contract (D51).

| External system | Platform receives | Platform sends | Typical mode(s) |
|---|---|---|---|
| Demand planning (via Net-requirements module) | Pre-netted net requirements (Section 4.1) | — | Connector / upload |
| Net-requirements module | Net requirements; consumes gross demand + inventory upstream (D20) | — | Connector / upload |
| Capacity planning | Capacity envelope, leveling guidance, reconciliation verdict (Section 4.2) | Deviation report (4.5); labor requirements feedback (4.7) | Connector / upload |
| Network material allocation module | Allocation result as inbound scheduled receipts (Section 4.8) | Material requirements feedback (4.10) | Connector / upload (D50) |
| MES / shop floor | Execution actuals (Section 4.3) | Committed schedule (4.4) | Connector (real-time preferred) |
| ERP (e.g. SAP) / PLM | Master data — parts, BOM, routings, resources, tooling, calendars (Section 5) | Committed schedule / status as required | Connector **or** upload **or** native (D35) |
| EDI / customer portal | Customer releases (830/862/866) feeding demand | Delivery / ASN signals as required | Connector (upstream of demand module) |
| Workforce rostering / HR | Labor-pool availability (headcount by skill per shift, Section 5.3) | Labor requirements feedback (4.7), optional, to inform rostering | Connector / upload (D43) |

**ERP / no-ERP handling (D35).** Where a source system exists, integrate via a **configured connector**. Where it does not — or for one-off/bootstrap loads — use **structured file upload** against defined templates. Where there is no ERP at all, the platform can operate in **native** mode as the **system of record** for master data, maintained in-app. The per-tenant choice of "system of record vs mirror an external source" is the key decision and is tracked as Q15; mechanics → Architecture doc.

---

## 14. Configuration catalog

> **Platform note (D51/A7):** the configuration framework itself (tenant scoping, effectivity, audit, guardrail routing) is a **kernel** capability; this catalog is the scheduling module's registered configuration set, alongside kernel-level items (tenant/topology, roles, plant groups) shown for completeness.

Everything a tenant configures, consolidated. Most is defined elsewhere and referenced here; KPI definitions/targets and alert/notification rules are defined below. All configuration is tenant-scoped (D24), gated by the `configure` permission (D33), effectivity-dated (D10) and audited (D6); a change that affects a committed schedule produces a reschedule proposal through the guardrail rather than auto-applying (Section 12, D42).

### 14.1 Catalog (what must be set up)

| Config area | Defined in | Scope | Typically configured by |
|---|---|---|---|
| Tenant & deployment topology | D24 | tenant | Provisioning / admin |
| Plant, customer, program (incl. firm fence) | 5.7, D23 | tenant / plant | Admin |
| Plant groups (clusters/divisions, sharing flag) | 5.7, D49 | tenant | Admin |
| Part master, BOM, UoM conversion | 5.1, D40 | part / plant | Master-data admin |
| Routing & operations (incl. labor flag/requirements) | 5.2–5.3, D29 | part / plant | Process engineering |
| Resources, resource groups, tools, calendars | 5.3 | plant | Admin |
| Skills & labor pools (incl. contractor pools) | 5.3, D31 | plant | Admin |
| Part attributes & changeover matrix | 5.4, D8 | part / resource group | Process engineering |
| Sequencing rules (hard campaign) | 5.4, D28 | resource group / tenant | Process engineering |
| Lot-sizing policy | 5.6, D27 | part / plant | Planner / admin |
| Approval tiers & rules | 5.5, D25–D26 | tenant | Admin |
| Roles & permissions | 9, D33 | tenant | Admin |
| Dashboards (enable/disable, surfaces) | 10–11, D34 | tenant | Admin |
| Integration mode per system | 13, D35 | tenant | Integration / admin |
| Capacity buckets & firm fence | D22–D23 | tenant / customer | Capacity-side admin |
| ML confidence thresholds | D41 | tenant | Admin |
| Schedule stability window | D44 | tenant / plant | Admin (default: current + next shift) |
| Scheduling horizon | D47 | plant | Admin (default: 4 weeks, ≥ firm fence) |
| Data retention period | D46 | tenant / customer | Admin (default: life of program + 15 yrs) |
| Master-data validation policy (block/warn) | D45 | tenant | Admin (default: block) |
| KPI definitions & targets | 14.2 | tenant / plant | Manager / admin |
| Alert & notification rules | 14.3 | tenant | Admin |

### 14.2 KPI definitions & targets

KPIs shown on dashboards (Section 10) are configurable, with targets/thresholds for status coloring and KPI-breach alerts.

> **AI performance KPIs (A17/4.11).** Beyond operational KPIs (adherence, OEE, on-time delivery), the same configurable KPI entity covers **AI suggestion-vs-actual** metrics computed from the proposal disposition record (4.11): **proposal approval rate**, **top-proposal-accepted rate** (`selected_vs_top = top`), **override/edit rate** (`edited_before_commit`), and — crucially — **proposal-vs-outcome** (did accepted AI proposals actually perform, via `outcome_ref`/4.3). These are trended per `proposal_source` and per approval rule, providing the concrete evidence of AI quality and the **measured track record** that gates graduated autonomy (A16) and preference-weight recommendations (A17). Approval rate is always read **alongside** outcome quality, never alone — high agreement from automation bias is not quality (A17).

| Property | Type | Req | Notes |
|---|---|---|---|
| `kpi_id` | string | Y | |
| `name` | string | Y | e.g. schedule adherence, OEE, on-time delivery. |
| `scope` | enum(`tenant`,`plant`,`resource_group`) | Y | Level measured/targeted. |
| `direction` | enum(`higher_is_better`,`lower_is_better`) | Y | For status/variance coloring. |
| `target_value` | decimal | N | Target. |
| `warning_threshold` | decimal | N | Amber threshold before breach. |
| `enabled` | boolean | Y | Per-tenant on/off. |

### 14.3 Alert & notification rules

Drives the alerts referenced in Section 12 (push to phone, exception triage). Recipients map to roles (Section 9); channels include the phone surface (Section 11).

| Property | Type | Req | Notes |
|---|---|---|---|
| `alert_id` | string | Y | |
| `name` | string | Y | |
| `trigger_event` | enum(`at_risk_delivery`,`machine_down`,`material_shortfall`,`labor_shortfall`,`master_data_gap`,`approval_pending`,`kpi_breach`,`low_confidence`,`schedule_published`,`custom`) | Y | What raises it. |
| `trigger_parameters` | structured | C | Thresholds (e.g. `kpi_id` for `kpi_breach`; confidence cutoff for `low_confidence`). |
| `recipient_roles` | list of reference → Role | Y | Roles notified (Section 9). |
| `channels` | list of enum(`in_app`,`phone_push`,`email`) | Y | Delivery channels (Section 11). |
| `severity` | enum(`info`,`warning`,`critical`) | Y | |
| `enabled` | boolean | Y | |

### 14.4 Shipped defaults (install-and-go)

The platform ships with a complete, safe default for every configurable item so a tenant can install or subscribe and operate with minimal setup, overriding only what differs (D48). Defaults bias to the safe choice. Notable defaults:

| Item | Default | Decision |
|---|---|---|
| Lot-sizing | `lot_for_lot` + `round_to_pack` | D27 |
| Labor pacing | Machine-paced (labor not constraining) | D29 |
| Campaigning | Optimizer-decided (soft); hard rules only where configured | D28 |
| Human-in-the-loop | LLM-influenced proposals require approval | D26 |
| Schedule stability window | Current + next shift | D44 |
| Scheduling horizon | 4 weeks (≥ firm fence) | D47 |
| Data retention | Life of program + 15 years | D46 |
| Master-data validation | Block on missing/invalid data | D45 |
| Roles | Seeded default role set, editable | D33 |
| Firm fence | Sited on Customer (program override) | D23/D38 |
| Plant groups | None defined; `allows_resource_sharing = false` until configured | D49 |

---

## 15. Open decisions

| ID | Open item | Needed for |
|---|---|---|
| D18 | Build vs configure the optimization engine; specific optimization technique. | Architecture doc. |
| O1 | Capacity bucket granularity and firm/forecast horizon boundary. **Resolved →** telescoping buckets (D22), per-customer/program fence (D23); client planning practice tracked as Q3. | Closed |
| O2 | Risk threshold for human-in-the-loop. **Resolved →** configurable rule-based triggers with tiered approval (D25); LLM-influenced proposals require human approval by default with per-rule/tier auto-approval config (D26). Client risk appetite, approval authority, and auto-approval appetite tracked as Q4–Q6. | Closed |
| O3 | Lot-sizing & batching rules. **Resolved →** lot-sizing = per-part base-method-plus-modifiers policy (D27, Section 5.6); campaigning = optimizer-decided by default plus four hard sequencing-rule types (D28, Section 5.4). Client practice tracked as Q7–Q9. | Closed |
| O4 | Labor/skill constraints. **Resolved →** optional, selectively-applied labor constraint; capacity-pool-by-skill model; setup vs run labor distinguished (D29, Section 5.3); scheduler feeds labor requirements by skill/shift back to capacity, which resolves shortfalls via leveling or accepts the constraint (D30, Section 4.7). Individual operator rostering deferred. Client labor profile tracked as Q10–Q11. | Closed |
| O5 | Single vs multi-plant for v1. **Resolved →** multi-plant from day one (D32); plant scoping and the D12 mapping active from the start; scheduling per plant; cross-plant allocation out of scope pending Q12. | Closed |
| O6 | Material/component availability input for the D4 material hard gate. **Resolved →** explicit inventory-position + inbound-receipts input; scheduler explodes the BOM and checks availability over time (D36, Section 4.8). Source tracked as Q16. | Closed |
| O7 | Multi-level scheduling (dependent demand for in-house made components). **Resolved →** multi-level with make/buy split; `make` components scheduled as dependent demand with precedence, `buy` checked only (D37). Client practice tracked as Q17–Q18. | Closed |
| O8 | Undefined referenced entities (Plant, Customer, Program, Schedule version, Optimizer run). **Resolved →** defined in Sections 5.7 (reference) and 4.9 (header records); firm fence sited on Customer/Program (D38). | Closed |
| O9 | Setup-time combination (operation base vs changeover matrix). **Resolved →** replace-with-fallback: matched matrix value, else operation base, never summed (D39). | Closed |
| O10 | Unit-of-measure consistency for BOM explosion and material checks. **Resolved →** single canonical base UoM per part; normalize at ingestion via per-part conversion table; no runtime conversion (D40, Section 5.1). Source of factors tracked as Q19. | Closed |
| O11 | No at-risk flag on the committed schedule. **Resolved →** `at_risk` + `at_risk_reason` added to the committed schedule (Section 4.4); drives the delivery/risk dashboard and the `customer_delivery_risk` approval trigger. | Closed |
| O12 | No ML confidence score (the `ml_reliance` trigger had nothing to evaluate; dashboards showed no confidence). **Resolved →** predictions carry a confidence score, persisted on the schedule, surfaced on dashboards, and feeding the `ml_reliance` trigger (D41). | Closed |
| O13 | Labor-pool availability source / workforce rostering boundary undocumented. **Resolved →** workforce rostering named as an external system (2.2, Section 13); labor-pool availability sourced from it; rostering stays external and, if built, a separate module (D43). | Closed |
| O14 | Rescheduling scope / schedule stability (nervousness control) unspecified. **Resolved →** stability-biased rescheduling: local repair, in-progress protected, committed jobs protected within a configurable stability window; full re-opt on demand (D44). | Closed |
| O15 | Behavior on missing/invalid master data unspecified. **Resolved →** validate completeness before scheduling; hold demand and surface a data-quality exception rather than guess (D45). | Closed |
| O16 | Data retention duration for schedule versions and audit traces unspecified. **Resolved →** long default (life of program + 15 yrs), configurable to longest applicable customer/regulatory requirement (D46). Client CSR requirements tracked as Q23. | Closed |
| O17 | Scheduling horizon length unspecified. **Resolved →** per-plant configurable, default 4 weeks, ≥ firm fence (D47). | Closed |
| O18 | Cross-plant shared resources & organizational grouping (dense clusters, division roll-up) had no model. **Resolved →** plant groups with separated reporting vs sharing uses; cluster-scoped labor pools (D49, Section 5.7). Client practice tracked as Q24. | Closed |
| O19 | Shared raw-material allocation across plants (e.g. steel across a body & chassis cluster) had no home. **Resolved →** external network material allocation module; allocation in via receipts (4.8), material requirements feedback out (D50, Section 4.10). Sourcing practice tracked as Q25. | Closed |

---

## 16. Running questions log

Live tracker of questions to resolve, distinct from the open *decisions* in Section 15. Append new questions here as they arise. **Audience** indicates who answers (Client = to raise with the client; Internal = our design call). **What we're looking for** gives a follow-up analyst the plain-language intent, how to explain the question if the client is unsure, and what a good answer contains.

| ID | Question | What we're looking for (analyst guidance) | Audience | Related | Status |
|---|---|---|---|---|---|
| **Q1** | Does the client's existing demand planning module already perform netting? If not, can it expose the gross inventory data (on-hand, WIP, in-transit) the net-requirements module needs, and what are the source systems and refresh frequency for that inventory data? | Confirm whether their demand system already subtracts existing stock and work-in-progress from customer orders, or just passes the raw customer quantities through. If you need to explain it: "If the OEM orders 1,000 but you already have 200 finished and 100 on the line, you only need to make 700 — does your system do that subtraction?" A good answer states yes/no; if no, it names the systems holding on-hand, WIP, and in-transit inventory (e.g. SAP, MES) and how often they refresh (real-time, hourly, nightly). Note: "we have forecasts" is *not* the same as netting — don't let the two be conflated. | Client | D14, D20 | Open |
| **Q2** | How are parts numbered across Magna plants — a single shared master part number, or independent per-plant numbering (and/or separate ERP instances)? This determines how the Plant part mapping is *populated*, not whether it exists. | Establish whether the same physical part shares one number across all plants, or each plant numbers it on its own. To explain: "If two plants make the same bracket, do they use the same part number, or different ones?" A good answer says single-shared vs per-plant, whether plants share one ERP or run separate instances, and whether any cross-reference list exists today. Reassure the client we build the mapping table either way — this only tells us how to fill it. Watch out: "we all use SAP" does not guarantee shared numbering; separate SAP instances often number differently. | Client | D12 | Open |
| **Q3** | How do Magna's planners plan — what horizons and review cadence (e.g. daily near-term, weekly mid, monthly long), and how are firm/frozen windows defined per customer/program in their OEM agreements? Confirms the telescoping bucket boundaries (D22) and the per-customer/program fence values (D23). | Capture two things: the planning cadence/resolution, and the frozen-window length per customer. To explain: "For the next couple of weeks do you plan day-by-day, then by week, then by month? And for each OEM, how many days ahead is the schedule locked and can't change?" A good answer gives the cadence (e.g. daily for 2 weeks, weekly to 3 months, monthly beyond) and a frozen-window length per major customer/program (e.g. customer A = 5 days firm). Tip: the frozen window usually lives in the OEM's supply agreement or EDI release calendar, not just in a planner's head — ask to see it if they're unsure. | Client | D22, D23 | Open |
| **Q4** | Which situations should require a human to approve a proposed schedule before it goes live (the risk appetite that defines the approval rules)? | We want the list of situations where a planner must review a schedule before it commits, so we can turn them into rules. To explain: "When the system proposes a schedule, in which situations would you *not* want it to go live automatically — e.g. a firm customer order might be late, it needs overtime, it reshuffles a lot of jobs?" A good answer is a concrete list of risky conditions with rough thresholds (e.g. "any risk to a firm OEM delivery", "more than ~20 jobs resequenced", "any overtime or outsourcing"). Tip: walk them through candidate dimensions — delivery impact, expensive levers (OT/outsourcing), large resequences, reliance on a shaky predicted time — so they react to a list rather than a blank page. | Client | D25 | Open |
| **Q5** | Who holds approval authority, and at what levels (the approval tiers)? | Who can sign off at each level, so we can build the tiers. To explain: "If a proposed schedule needs a human OK, who gives it — the planner, a supervisor, the plant manager? Does it depend on how serious it is?" A good answer names the roles/levels and what each can approve (e.g. planner = minor changes, supervisor = overtime, plant manager = anything risking an OEM line-stop). Note: tiers are configurable per tenant, so plants/clients can differ. Watch out: approval authority may vary by plant — confirm whether it's consistent across Magna. | Client | D25 | Open |
| **Q6** | Where is the client comfortable allowing automatic approval (no human), and what is their stance on auto-approving AI-influenced proposals? | Where they'll let the system commit without a human — now and over time — and specifically their position on AI-generated proposals. To explain: "Some low-risk proposals could go live automatically to save time — which kinds are you comfortable with? And separately, our AI assistant can propose changes during disruptions; would you want those always reviewed by a person, at least to start?" A good answer states which rules/tiers may auto-commit (likely few at launch) and an explicit position that AI-influenced proposals stay human-reviewed initially with a path to relax later. Default if unsure: conservative — most things reviewed, AI-influenced always reviewed at launch. | Client | D26 | Open |
| **Q7** | How does Magna currently size production runs, and what should the per-part defaults be? | We want their real lot-sizing practice so our defaults match it. To explain: "When you decide how many to make in one run, do you make exactly what's needed, or do you have minimum run sizes, round up to full containers/pallets, or batch a day's or week's worth together?" A good answer covers the base approach (make-to-exact-need vs batch-a-period), whether minimums apply, whether they round to container/pallet quantities, and whether this is set per part or per part family. Tip: ask whether there's a standard default today and where the exceptions are — that tells us the default plus which modifiers to expect. | Client | D27 | Open |
| **Q8** | Are there process-driven batch quantities that force a lot multiple, and is reliable standard pack/container data available per part? | Two practical checks for the modifiers. To explain: "Do any processes force a batch size — e.g. an oven, rack, or heat-treat load that must be full? And do you have accurate standard pack/container quantities for each part?" A good answer identifies any process-unit batch sizes (which become `lot_multiple`) and confirms whether per-part pack quantities exist and are trustworthy (`round_to_pack` depends on them). Watch out: if pack data is stale or missing, pack rounding can't be relied on as a default — flag it. | Client | D27 | Open |
| **Q9** | What mandatory sequencing or campaign rules must production obey — paint colour ordering, material campaigns, required cleanouts between certain transitions, and any limit on how long a campaign can run before a forced clean/maintenance? | Hard constraints we cannot guess; getting one wrong produces scrap. To explain: "Are there rules about the *order* things must run — e.g. paint must go light to dark, certain materials must run together, switching from X to Y needs a cleanout, or you can't run more than N before a clean?" A good answer lists each rule with the attribute it's keyed on (colour, material, etc.), whether it is a required order, a must-run-together (contiguity), a forbidden-or-cleanout transition, or a max-consecutive limit, and which lines/resource groups it applies to. Tip: paint and heat-treat areas are the usual sources — ask the process engineers, not just the planners. | Client | D28 | Open |
| **Q10** | Which operations are labor-paced vs machine-paced, what skills/certifications gate them, what are the operator-to-machine ratios, and does changeover need a dedicated skilled setter? | Tells us where labor actually binds so we model only those. To explain: "For each type of operation, does throughput depend on the machine or on how many people you have? How many machines does one operator run? Which jobs need a certified or skilled person (e.g. a setter for changeovers, an inspector)? And is there a separate crew/shift pattern for labor?" A good answer separates machine-paced areas (one operator runs several machines; labor rarely binds the run) from labor-paced areas (assembly, inspection — people set the pace), names the gating skills/certifications, and confirms whether changeovers need a dedicated setter. Tip: setup labor often binds even where run labor doesn't — ask specifically who performs changeovers. | Client | D29 | Open |
| **Q11** | When a skill is short for a shift, what are the options and rules for covering it — overtime, second shift, temporary/contract labor? For temps, do they keep a pool of pre-qualified contractors usable on availability (no onboarding) versus sourcing new temps with a lead time — and which skills, what availability, and what lead time apply to each? Who authorizes it, and at what point do they accept the constraint instead? | Defines how labor shortfalls get resolved so we model the right leveling levers, the two temp tiers (D31), and the fallback. To explain: "If you're short of skilled people for a shift, what do you do — overtime, add a shift, bring in temps? For temps, do you have known contractors you can call in right away if they're free, or do you have to source new people with notice? Which roles, and how much notice? Who signs off — and when do you just accept making less?" A good answer separates the pre-qualified contractor pool (available on availability, no lead time) from new sourcing (with a lead time per skill), names who approves each, and the threshold for accepting a constraint. Tip: a free pre-qualified contractor can cover a shortfall inside the frozen window; new temp labor that takes two weeks cannot. | Client | D30, D31 | Open |
| **Q12** | Does demand arrive already allocated to a specific plant, or does Magna expect the system to decide which plant makes a given demand (cross-plant sourcing/load-balancing)? | Confirms whether cross-plant allocation is in scope. To explain: "When demand comes in, is it already assigned to a specific plant, or would you want the system to choose between plants that can both make the part?" A good answer states whether allocation happens upstream (the common case for decentralized plants) or is expected of the scheduler. Note: our current design assumes demand arrives plant-allocated and schedules each plant independently; cross-plant sourcing would be a larger, separate capability. Watch out: occasional manual re-sourcing between plants is different from systematic load-balancing — clarify which they mean. | Client | D32 | Open |
| **Q13** | What is Magna's actual role structure on the plant floor — the role names, who does what, and how many distinct roles — so we can configure roles rather than impose defaults? | We seed defaults but want to match their real org. To explain: "What do you call the people who run the lines, plan the schedule, supervise, manage the plant, handle materials and tooling? Who is allowed to change a schedule, and who approves changes?" A good answer maps their role names to responsibilities and to who can view, edit, and approve. Note: roles are fully configurable, so this shapes the defaults and the permission mapping, not whether roles exist. Watch out: titles vary by plant — confirm whether the structure is consistent. | Client | D33 | Open |
| **Q14** | What devices are used on the floor (large screens/wallboards, tablets, phones), who uses which, and what do they print today? | Confirms the surface strategy and print artifacts. To explain: "On the floor, do people work from big screens, tablets, or phones? Do any teams have only tablets? What paper do you hand out today — dispatch lists, changeover sheets, pick lists?" A good answer maps roles to devices (especially any tablet-only users, since tablets get full capability) and lists the printed artifacts they rely on. Tip: ask whether wallboards or large displays exist on the floor for at-a-glance status. | Client | D34 | Open |
| **Q15** | Which source systems hold master data (e.g. SAP, PLM), can they be integrated via connector or only file export, and for any data with no source system — should the platform be the system of record (maintained in-app) or always mirror an external source? | Determines integration mode per data type and whether the platform is ever system of record (D35). To explain: "For parts, BOMs, routings, tooling, calendars — where does that data live today? Can we connect to it, or would you export files? And for anything with no system behind it, do you want our platform to be the master, or always copy from somewhere else?" A good answer states, per data type, the source system and whether connector/upload is feasible, plus a clear position on system-of-record. Watch out: "we have SAP" doesn't mean every data type is in it or accessible — check per data type. | Client | D35 | Open |
| **Q16** | Where does component/raw-material inventory and inbound supplier-delivery (scheduled receipt) data come from, at what granularity and refresh, and how reliable are the expected delivery dates? | The material hard gate needs current stock and what's arriving when. To explain: "For the parts and materials that go *into* what you make, where do you track stock on hand, and where do you see what's arriving from suppliers and when? How current is that, and how reliable are the promised delivery dates?" A good answer names the system(s) for on-hand inventory and for inbound/scheduled receipts, the refresh frequency, and whether supplier delivery dates are trustworthy or often slip. Watch out: confirmed vs merely expected receipts matter — the gate should lean on confirmed ones; ask how they distinguish them. | Client | D36 | Open |
| **Q17** | Does Magna produce and stock in-house sub-assemblies / made components as distinct part numbers consumed by other parts, or is in-plant flow generally one part moving through a multi-operation routing? | Determines how heavily multi-level scheduling is exercised. To explain: "When you make something in-house that goes into another of your products, is it its own part number you track and stock, or is it just a step in making the final part?" A good answer says whether made sub-assemblies are distinct, stocked, BOM-level components (multi-level) or just operations within one part's routing (single part, multi-step). Tip: ask for one example BOM with an in-house made component — that settles it quickly. | Client | D37 | Open |
| **Q18** | For in-house made components, are they produced to a specific parent order (pegged, make-to-order) or built to stock and drawn down by multiple parents (make-to-stock)? | Determines how dependent demand pegs and replenishes. To explain: "When you make a sub-component, do you make exactly what a specific bigger order needs, or do you build a batch to stock that several products pull from?" A good answer indicates, per made component, whether it is order-pegged or stock-replenished (these can differ by component). Note: this affects lot-sizing and whether the scheduler pegs 1:1 or schedules to a stock target. | Client | D37 | Open |
| **Q19** | Do parts transact in more than one unit of measure (e.g. ordered in eaches but stocked/consumed in kg or metres), and where do the conversion factors come from? | We normalize everything to one base unit per part; mixed units need conversion factors at ingestion. To explain: "For your parts and materials, is everything counted the same way everywhere, or do some get ordered in one unit and stored or used in another? If so, where are the conversion factors kept?" A good answer says whether mixed UoMs occur and names the source of conversion factors (often ERP). Watch out: raw materials (coil, resin) are the usual mixed-unit case — confirm those specifically. | Client | D40 | Open |
| **Q20** | Which KPIs does Magna track, at what level (plant, line), and what are the targets/thresholds? | Configures the KPI dashboards and KPI-breach alerts. To explain: "What numbers do you watch to know the plant is running well — on-time delivery, adherence, OEE, scrap — and what's a good vs bad value for each?" A good answer lists the KPIs that matter, the level they're tracked at, and target/warning values. Tip: ask which ones drive action today — those belong on the default dashboards and may warrant alerts. | Client | D42 | Open |
| **Q21** | What events should raise alerts, to whom, and on which channel (in-app, phone, email)? | Configures alert/notification rules. To explain: "When something needs attention — an at-risk delivery, a machine down, a shortage, something waiting for approval — who should be told, and how (app, phone, email)?" A good answer maps events to recipient roles and channels, with a severity. Watch out: over-alerting makes people ignore alerts — focus on the few events that truly need a person. | Client | D42 | Open |
| **Q22** | Does Magna have a workforce scheduling / HR system that can provide available headcount by skill per shift, and can it be integrated (connector/upload) or is that data maintained manually? | The labor pool (availability by skill/shift) has to come from somewhere. To explain: "Where do you keep who's working which shift and what skills they have — a workforce/HR/scheduling system, or spreadsheets? Can we pull headcount-by-skill-by-shift from it?" A good answer names the system (or confirms it's manual) and whether connector/upload is feasible. Note: individual rostering stays in their system; we only need the resulting available headcount by skill per shift. | Client | D43 | Open |
| **Q23** | Which OEM customer-specific requirements (CSRs) and regulations govern record retention for Magna's programs, and what is the longest required period? | Sets the retention configuration. We default to life of program + 15 years; we need to confirm no customer demands longer. To explain: "For each customer/program, how long are you contractually required to keep production and traceability records? Any at 20 years?" A good answer names the binding CSRs (GM, Ford, Stellantis, etc.) and the longest period, since retention must be set to the highest bar. Watch out: the IATF baseline (life + 1 year) is almost never the binding number — the customer manual is. | Client | D46 | Open |
| **Q24** | For dense plant clusters (e.g. the ~11 Coahuila plants around Ramos Arizpe/Saltillo/Arteaga), do plants actually share resources across plant boundaries today — skilled labor (setters, maintenance techs), tooling, or anything else — and if so, who arbitrates when two plants want the same resource? | Establish whether cluster-level sharing is real practice or just geographic proximity. To explain: "When one plant is short a setter or a maintenance tech and the plant next door has slack, do people actually move between plants? Who decides?" A good answer says what is shared (labor, tools, nothing), how often, whether it's formal or ad hoc, and who has the authority to move a resource between plants. Watch out: divisions matter — a Cosma plant and a Seating plant side by side may share nothing; sharing likely follows division + geography together. If nothing is shared today, ask whether they *want* the system to enable it — that changes it from modeling current practice to enabling new practice. | Client | D49 | Open |
| **Q25** | For shared raw materials (steel coil for body & chassis, resin for molding): how is supply contracted and allocated today — per plant, per division, or centrally — at what cadence is the allocation revisited, and who decides a reallocation when one plant runs short while another has excess? | Defines whether the network material allocation module (D50) models an existing process or creates one. To explain: "When you buy steel, does each plant order its own, or is there one contract whose volume gets split across plants? If plant A is about to run out and plant B has extra coil of the same spec, can it move — and who makes that call?" A good answer names the contracting level (plant/division/central), the allocation cadence (annual, monthly, weekly), whether physical inter-plant transfers happen, the lead time for a transfer, and the deciding role. Watch out: "same material" must mean same spec/grade — steel grades and resin types are not interchangeable; ask how they identify true commonality across plants. | Client | D50 | Open |
| **Q26** | Do EV programs follow a materially different demand/release pattern than ICE programs — e.g. less JIS sequencing, more platform-based or kanban-style pull, different firm-window behavior, or higher release volatility during ramp? | Confirms the existing demand model covers EV or surfaces what doesn't. To explain: "For your EV programs (e.g. the new Ramos Arizpe plant), do the customer releases look like your traditional programs — same EDI documents, same firm windows, same sequencing — or different? More volume swings during ramp-up?" A good answer compares an EV program to a comparable ICE program on: release document types (830/862/866), firm-window length, JIS vs batch pull, and volatility. Note: our current model handles this as a different mix of existing values (`demand_type`, fences); we're checking for a pattern that doesn't fit (e.g. a stock-target replenishment signal with no discrete releases). | Client | 2.3, D23, D37 | Open |

---

## Appendix A — Glossary

| Term | Meaning |
|---|---|
| APS | Advanced planning & scheduling (commercial scheduling engines). |
| ASN | Advance shipping notice. |
| BOM | Bill of materials. |
| Campaign | A grouped run of same-attribute jobs to reduce changeover. |
| Changeover | Setup/transition between two jobs on a resource; often sequence-dependent. |
| CRP | Capacity requirements planning. |
| CUM | Cumulative received quantity (customer reconciliation reference). |
| ECN / ECR | Engineering change notice / request. |
| EDI | Electronic data interchange. 830 = planning/forecast schedule; 862 = firm shipping schedule; 866 = sequenced JIT / production-sequence pull. |
| EOQ | Economic order quantity (a lot-sizing method; excluded — D27). |
| Firm / frozen window | The near-term horizon where demand is committed and not expected to change (per customer/program, D23). |
| IATF 16949 | Automotive quality-management-system standard requiring traceability. |
| JIS | Just-in-sequence delivery (parts delivered in the customer's build order). |
| JIT | Just-in-time delivery. |
| MES | Manufacturing execution system (shop-floor execution and status). |
| OEE | Overall equipment effectiveness. |
| OEM | Original equipment manufacturer (the customer, e.g. an automaker). |
| PLM | Product lifecycle management. |
| Plant group / cluster | A tenant-defined grouping of plants for reporting or, where enabled, shared-resource scoping (D49). |
| Rough-cut | Aggregate-grain capacity check (vs fine-grain scheduling). |
| SoR | System of record. |
| Telescoping buckets | Time buckets that widen with horizon — daily near-term, weekly mid, monthly far (D22). |
| Tenant | One client instance of the platform; all data is tenant-scoped (D24). |
| WIP | Work in progress. |

---

*End of document — Draft v0.10.*
