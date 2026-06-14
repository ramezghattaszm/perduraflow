# Platform completion log

| | |
|---|---|
| **Document** | Platform completion log (demo → full-platform gap tracker) |
| **Product** | Manufacturing operations platform (production scheduling = module #1) |
| **Home** | Build repo, `docs/PLATFORM-COMPLETION-LOG.md` (lives with the code, not the specs) |
| **Status** | Seeded v0.2 (modular contract-bound, deployment shape B) |
| **Date** | 2026-06-13 |
| **Source of truth** | The four specs in the project (scheduling business/functional, platform architecture, Master Data, Net-requirements, Network material allocation). This log never overrides them; it records where the demo build *diverges* from them and how the divergence is closed. |

---

## How this log works

The demo deliberately scopes down, stubs, or skips parts of the four specs. **Every such divergence is an entry here.** The governing rule: *nothing reaches the full platform build without first appearing in this log and being moved to `Done`.* This is what keeps the demo from quietly becoming the product.

**Columns (consistent across every entry):**

- **ID** — stable identifier (`SKIP-NN`); gaps in numbering are intentional room to insert.
- **Area** — subsystem.
- **Demo does** — what the demo build actually ships.
- **Full-platform target (spec ref)** — the spec'd end state and the D/A/MD/NR decision it traces to.
- **Unblocked by** — the dependency, ruling, or time/priority gate that lets completion start.
- **Status** — `Deferred` → `Pending ruling` → `In progress` → `Done`.

**Sequencing for completion:** work the log by the **Unblocked by** column, not top to bottom — pick up entries whose gate has cleared. The five core stubs (Bucket A) become firm `Deferred` the moment the matching decision-point stub is accepted, and drop off the log entirely if you choose to build the real thing now instead.

---

## Bucket A — Core scoped down / stubbed

The minimum to make the vertical slice run. Each is a deliberate placeholder, not a design gap. Note the **foundational, built-now** pieces here are *not* deferrals — the EventBus coordinator + local provider (SKIP-05), the binding indirection + contract `id/version` (SKIP-21), and active tenancy (SKIP-01); only the heavier provider/machinery behind each is deferred. They appear here so the split between "built now" and "hardened later" is explicit.

| ID | Area | Demo does | Full-platform target (spec ref) | Unblocked by | Status |
|---|---|---|---|---|---|
| **SKIP-01** | Tenancy & isolation | **Tenancy active from day one** — scope column on every table, every query tenant-scoped, per-tenant bindings live. Demo runs one tenant; cross-tenant logical-isolation *enforcement* not yet hardened | Hardened per-tenant logical isolation; both topologies (shared SaaS + isolated single-tenant) without rework | D24 / A1 · isolated-deployment prospect (AQ1) | Deferred (hardening only) |
| **SKIP-02** | Master Data | Parts, resources (lines/machines + resource groups), routings/operations, calendars — in-module, behind part/asset-contract-shaped service boundaries | Full Master Data module: BOM topology, physical/descriptive part attributes, tooling/asset domain, effectivity resolution, UoM conversion, per-tenant SoR binding | A13 / MD1–MD14 · module #2 build | Pending ruling (decision pt 3) |
| **SKIP-03** | Optimizer / sequencer | Transparent deterministic heuristic (earliest-due-date, changeover-aware); satisfies the deterministic-decision invariant and the hard gates | Real optimization engine selected by benchmark on representative constraint sets (CP / MILP / metaheuristic / commercial APS) | D18 / AQ6 · engine selection + benchmark | Pending ruling (decision pt 2) |
| **SKIP-04** | ML parameter prediction | Stubbed predictor emitting confidences; `setup_source`/`cycle_source` + `*_confidence` fields wired through schedule records and dashboards (default `standard`) | Trained models for changeover, cycle, downtime, scrap; closed retraining loop; confidence-driven `ml_reliance` trigger; overlay on the deterministic baseline | D3 / D5 / D7 / D41 / A14 · actuals history accrues | Pending ruling (decision pt 5) |
| **SKIP-05** | EventBus | **EventBus coordinator + local in-memory provider — foundational, built from day one** (all cross-module events flow through it; no raw `EventEmitter2` across boundaries). Only the **Kafka-protocol provider** is deferred | Kafka-protocol provider (MSK / Apache Kafka KRaft / Redpanda); envelope versioning, idempotency, ordered partitions, replay-for-retraining — added behind the same coordinator | A4 · scale / retraining need | Deferred (Kafka provider only) |
| **SKIP-06** | Cross-module write consistency | Cross-module writes run as local transactions in the single deployable | Outbox/saga pattern per cross-module write once modules split into separate processes (deployment B → A) | A4 / A5 · first module promoted to its own service | Deferred (flag each write site as it appears) |

---

## Bucket B — Whole modules not built

Each slots in behind a contract this slice already shapes; building it is a configuration change against the contract, not a rebuild.

| ID | Area | Demo does | Full-platform target (spec ref) | Unblocked by | Status |
|---|---|---|---|---|---|
| **SKIP-10** | Net-requirements module | Scheduler consumes a pre-netted demand input seeded/uploaded directly; no netting performed | Full module: net finished-good/independent demand from gross demand + gross inventory, CUM-aware, firmness-preserving, delta-first | D20 / NR1–NR10 · contract 4.1 | Deferred |
| **SKIP-11** | Capacity planning module | No capacity envelope, or a static seeded envelope; no leveling guidance, no reconciliation verdict, deviation report not emitted | Full module producing the capacity envelope, leveling guidance, reconciliation; consumes deviation + labor feedback | D15 / D16 · contracts 4.2 / 4.5 / 4.7 | Deferred |
| **SKIP-12** | Demand planning module | Demand seeded directly upstream of the net-requirements boundary | Full module producing gross demand from digested OEM releases | Q1 / D20 · upstream of SKIP-10 | Deferred |
| **SKIP-13** | Network material allocation module | Not present; inbound material receipts seeded directly as 4.8 | Full module: split shared raw-material supply across a plant sharing group; consumes material-requirements feedback to rebalance | D50 / NMA-series · contracts 4.8 (in) / 4.10 (out) | Deferred |
| **SKIP-14** | Labor scheduling & optimization | Machine-paced default (labor not binding); labor pools seeded only where an op is labor-constrained | If ever built: a fully separate module; individual operator rostering stays external | D29 / D43 · separate module decision | Deferred |
| **SKIP-15** | Maintenance module | Maintenance windows seeded in the calendar; tool status static | Full module owning maintenance scheduling, tool-life-driven windows, live resource up/down | D17 · calendar + tooling model | Deferred |
| **SKIP-16** | Supply-chain logistics | None; committed schedule + ASN signals available as outputs only | External logistics consuming committed schedule / ASN; no transport decision made in-platform | Scheduling scope §2.2 · downstream consumer | Deferred |

---

## Bucket C — Kernel concerns scoped down

Built underneath module #1 (A11), but minimal in the demo. Each needs hardening before the platform is multi-module / multi-tenant in production.

| ID | Area | Demo does | Full-platform target (spec ref) | Unblocked by | Status |
|---|---|---|---|---|---|
| **SKIP-20** | Provider construct | Local providers only (FileSystem, in-memory, console/log); no cloud providers | Full coordinator catalog with cloud + local providers per concern; shared contract test suites enforcing equivalence | A2 / §5 catalog · cloud deployment | Deferred |
| **SKIP-21** | Contract registry & versioning | **Foundational (built now):** contracts in `packages/contracts` carry `id + version`; the per-consumer **binding** indirection ({platform_module \| connector \| upload \| native}) is present so a module is replaceable without consumer change. **Deferred:** the full A12 machinery — a runtime registry, MAJOR.MINOR negotiation across the wire, open/closed enum annotations, dual-publish deprecation windows, Avro/Protobuf + schema registry | Full registry + schema registry + cross-wire version negotiation and deprecation windows | A8 / A12 · module #2 / external bindings / scale | Deferred (A12 machinery only) |
| **SKIP-22** | Audit framework | Minimal append-only logging | One audit pipeline; modules emit domain events; retention + BlobStorage tiering | D6 · compliance / first regulated tenant | Deferred |
| **SKIP-23** | Notification engine | In-app / console only | NotificationDispatcher: rules → recipients → channels → severity; delivery audit; throttle/digest | 14.3 · multi-channel need | Deferred |
| **SKIP-24** | Config framework guardrail | Config edits apply directly | Tenant-scoped, effectivity-dated, audited; a change affecting a committed schedule routes a reschedule proposal through the guardrail | D42 / D10 / §12 · approval policy live (SKIP-46) | Deferred |
| **SKIP-25** | Identity & access | Local accounts + basic role gating | Per-tenant OIDC/SAML and/or local; shop-floor shared-terminal session policy | A9 / AQ5 · client floor-IT input | Deferred |
| **SKIP-26** | Persistence lifecycle | Hot Postgres only | BlobStorage tiering of the long audit/actuals tail to columnar object storage; life-of-program + 15-yr retention | A3 / D46 · retention requirement / volume | Deferred |
| **SKIP-27** | Workflow orchestration | Optimizer-run lifecycle handled inline | Portable durable workflow engine (Temporal-class) driving trigger → run → gates → approval → commit | A5 · long-lived process volume | Deferred |
| **SKIP-28** | Compute / deployment | **Shape B:** one deployable, contract-bound modules with swappable transport (in-process behind the contract). Local / single-node | Per-module extraction to its own service on demand (B → A: add an HTTP/Kafka transport adapter + change the binding, no consumer change); containerized on Kubernetes; optimizer as sized batch jobs | A5 / A7 · independent release cadence or third-party module in production | Deferred |

---

## Bucket D — Deferred by design (already tracked in the specs)

Not demo shortcuts — these are open/deferred in the specs themselves. Carried here so the completion view is complete; the **spec logs remain authoritative**.

| Ref | Item | Resolves with | Status (per spec) |
|---|---|---|---|
| **A16** | Bounded agentic orchestration (graduated autonomy / auto-commit) | Build follows once the deterministic modules it orchestrates are solid | Deferred by design |
| **A17** | Preference learning from human proposal choices | Reads the same disposition record as A16; built alongside it | Deferred by design |
| **AQ1** | Who operates isolated single-tenant instances | Commercial/deployment strategy with first prospect | Open |
| **AQ5** | Shop-floor authentication & shared-terminal session policy | Client floor-IT input | Open |
| **AQ6** | Optimizer engine selection (see SKIP-03) | Benchmark on representative constraint sets | Open |
| **AQ8** | Agent proposal-confidence model & autonomy calibration | The deferred agentic build | Open |
| **NRQ1–5** | Net-requirements client questions (safety-stock source, pre-netting, CUM-shipped source, supply definition, staleness tolerance) | Client discovery | Open |
| **Q-series** | Scheduling client-facing questions (Q1–Q26) | Client discovery | Open per spec |

---

## Bucket E — Cross-cutting scheduling capabilities not in the demo

Scheduling-module features the demo simplifies. These complete the module itself (vs. Bucket B, which adds *other* modules).

| ID | Area | Demo does | Full-platform target (spec ref) | Unblocked by | Status |
|---|---|---|---|---|---|
| **SKIP-40** | Schedule board | Read-first Gantt; no drag-adjust authoring | Custom virtualized authoring canvas — drag-adjust, thousands of jobs, low-confidence + at-risk flagging | A6 / D34 · own UI workstream | Pending ruling (decision pt 1) |
| **SKIP-41** | What-if | None | Parameterize a scenario, run optimizer, show delta vs current; commit only through the guardrail | §12 · optimizer + guardrail live | Deferred |
| **SKIP-42** | Print/PDF artifacts | Browser print, if any | Server-rendered, deterministic, archivable: dispatch lists, changeover sheets, pick lists, KPI summaries, audit records | A6 / D34 · rendering pipeline | Deferred |
| **SKIP-43** | RBAC depth | Simplified roles | Full model: role → dashboards → per-action rights, data scope (plant/multi-plant/tenant), approval tier; seeded + editable | D33 / §9 · multi-role tenants | Deferred |
| **SKIP-44** | Effectivity dating | Current-version resolution only | Resolve master data effective at the *scheduled* date, end to end | D10 · engineering-change scenarios | Deferred |
| **SKIP-45** | Multi-level / dependent demand | Single-level; BOM minimal or absent | BOM explosion, make/buy split, dependent demand with hard precedence, component-level netting | D36 / D37 · BOM in Master Data (SKIP-02) | Deferred |
| **SKIP-46** | Approval policy & guardrail stage 2 | Hard gates only, or auto-pass with flagging | Configurable rule-based triggers → tiered approval; LLM-influenced proposals human-approved by default | D4 / D25 / D26 · config framework (SKIP-24) | Deferred |
| **SKIP-47** | Lot-sizing | Lot-for-lot + pack rounding default only | Per-part base method + stackable modifiers; tool-life cap as hard constraint | D27 / §5.6 · part policy config | Deferred |
| **SKIP-48** | Changeover & sequencing | Minimal / single-attribute | Attribute-keyed changeover matrix; four hard sequencing-rule types; optimizer-decided campaigning | D8 / D28 / §5.4 · optimizer (SKIP-03) | Deferred |
| **SKIP-49** | Rescheduling / nervousness control | Full re-run only | Stability-biased: local repair, in-progress protected, committed jobs protected within a configurable stability window | D44 · optimizer warm-start/repair | Deferred |
| **SKIP-50** | Master-data completeness validation | Basic presence checks | Block-or-warn policy; hold demand + raise data-quality exception rather than guess | D45 · config policy | Deferred |
| **SKIP-51** | Integration / actuals source | Built-in actuals simulator (demo fixture) emitting 4.3 events + manual entry | Real connectors per the three D35 binding modes; MES real-time actuals feed | D35 / §13 · connector build | Pending ruling (decision pt 4) |
| **SKIP-52** | Calendar config UI fidelity | Basic JSON-backed editors for `shift_patterns` / `holidays` / `maintenance_windows`; `maintenance_windows` plant-level (no `resource_id`) | Structured shift-pattern / holiday / maintenance-window builders; maintenance windows referencing resources once Master Data assets exist | D17 / 5.7 · phase 1 resources (SKIP-02) | Deferred |

---

*End of seed — v0.1. Update `Status` as entries move; add `SKIP-NN` rows into the gaps as new divergences appear during the build.*
