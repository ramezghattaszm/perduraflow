# Manufacturing platform — architecture specification

| | |
|---|---|
| **Document** | Architecture specification |
| **Product** | Manufacturing operations platform (production scheduling = module #1) |
| **Status** | Draft v0.9 |
| **Date** | 2026-06-10 |
| **Companion docs** | Production scheduling module business & functional specification (Draft v0.10); Master Data module specification (Draft v0.3); Net-requirements module specification (Draft v0.3); Network material allocation module specification (Draft v0.2) |
| **Intended use** | Source-of-truth for technical architecture decisions; to be handed to Claude Code for implementation alongside the business/functional spec |

---

## 1. Purpose & how to read this document

This document records the **architecture decisions** for the platform: the platform/module structure, technology posture, portability strategy, and the cross-cutting technical frameworks every module consumes. It is the destination for every item the business specification flagged `→ Architecture doc`.

It deliberately does **not** restate business or functional rules. Where a decision here implements a business decision, it cites the D-series ID (e.g. "implements D24"). The business & functional specification (Draft v0.10) remains the source of truth for *what* the scheduling module does; this document governs *how the platform is built*.

Decisions are logged as an **A-series** (A1, A2, …) in Section 3, mirroring the D-series convention. Open architecture questions are tracked in an **AQ-series** log (Section 10), distinct from the business spec's client-facing Q-series.

**Scope note (A7):** the product is a **platform with subscribable domain modules**, of which production scheduling is the first. This document covers the platform kernel and the architecture rules all modules follow; module-specific internals (e.g. optimizer technique, D18) are decided here only where they affect platform structure, and otherwise deferred to module-level design.

---

## 2. Architecture overview

### 2.1 The shape of the system

- A **platform kernel** owns every cross-cutting concern: identity & access, tenancy & module entitlement, the shared organizational model, configuration & audit frameworks, notifications, the provider construct, and the UI shell.
- **Domain modules** (production scheduling first; candidates: demand planning, capacity planning, net-requirements, network material allocation, labor scheduling & optimization, maintenance, supply-chain logistics) own their domain data, domain logic, and domain configuration. Modules are independently versioned and deployable.
- Modules interact only through **platform-registered, versioned contracts** (A8). The business spec's Section 4 contracts are the founding entries of the contract registry.
- Per tenant and per contract, the counterpart behind a contract is a **binding choice**: another platform module, a connector to an external system, structured file upload, or native in-app maintenance — D35 extended by one mode.
- The whole system is **cloud-portable with an AWS-first deployment** (A1): dependencies are either protocol-standard (configuration only), behind the provider construct (A2), or deliberately avoided.

### 2.2 Deployment topologies (implements D24)

Two topologies, one codebase, no rework between them:

| Topology | Description | Provider binding |
|---|---|---|
| **Shared SaaS** | Multiple tenants on one instance/database with logical isolation | One provider set per instance (AWS-first) |
| **Isolated single-tenant** | One tenant, dedicated instance/database, possibly in the client's own cloud/account | The instance binds its own provider set (AWS, Azure, …) |

Provider binding is resolved **once per deployment instance** at the composition root (A2). Per-tenant provider binding *within* a shared instance is excluded (the LLM gateway is the one named future exception candidate, A2).

**Open:** who operates isolated single-tenant instances — the vendor in its own accounts, the vendor in the client's account, or the client itself — is a commercial/operational question with architectural consequences (residency, access, upgrade cadence). Tracked as AQ1.

---

## 3. Architecture decision log (A-series)

| ID | Decision | Rationale (summary) | Status |
|---|---|---|---|
| **A1** | **Cloud-portable core, AWS-first deployment.** The first deployments (Magna, the SaaS offering) run on AWS-managed services, but the codebase binds to nothing AWS-proprietary outside the provider construct. Dependencies fall into a **three-tier taxonomy**: (1) **protocol-standard — configuration only**: Postgres wire protocol, Redis/RESP, the S3 object API (de facto standard; Azure Blob via thin provider), OpenSearch REST API, OIDC/SAML, OpenTelemetry; (2) **proprietary API, genuinely needed — provider construct** (A2, catalog in Section 5); (3) **proprietary API, avoidable — not adopted**: no DynamoDB-class dependency without a measured need (A3). | Isolated single-tenant deployments (D24) plausibly land in client clouds (automotive skews Azure in Europe); AWS-native would violate D24's "without rework". Portability is bought where it's cheap (protocols), engineered where it's needed (providers), and refused where it's avoidable. | Agreed |
| **A2** | **The provider construct** is the standard pattern for tier-2 dependencies. A **concrete coordinator class** (e.g. `BlobStorage`) owns the domain logic — tenant scoping (D24), retention/tiering (D46), audit (D6), policy — and delegates only narrow primitives to a **provider** implementing a small semantic interface (e.g. `save`, `get`, `delete`, `list`, `getSignedUrl`). No conditional branching on provider type anywhere in the codebase; binding is resolved once at the composition root per deployment instance. **Every coordinator must have a local provider** (FileSystem, in-memory, local broker, stub) — a coordinator is not complete without one — so dev/CI run with zero cloud dependencies and the interface is forced to stay semantic rather than vendor-shaped. **Each provider interface carries a shared contract test suite** run against every provider, including the local one, enforcing behavioral equivalence (pagination, consistency, delivery semantics, signed-URL behavior). Per-tenant provider binding within a shared instance is out of scope; the LLM gateway is recorded as the only future exception candidate. | Adding a new cloud = adding one provider class per coordinator, never touching domain logic. The local-provider rule keeps interfaces honest and development self-contained; contract tests are what keep "swap the provider" true over time. | Agreed |
| **A3** | **Persistence**: PostgreSQL is the system database (protocol-standard, tier 1) — managed in production (RDS/Aurora on AWS; Azure Database for PostgreSQL; etc.), local container in dev. Discipline: **portable SQL** — no engine-exclusive features that break the protocol-portability claim. JSONB and table partitioning cover semi-structured and high-volume needs. The **long-horizon audit/actuals tail (D46, 15+ years)** is tiered out of Postgres to object storage via the BlobStorage coordinator (columnar files, e.g. Parquet), keeping the hot database bounded. Redis (RESP protocol) for cache/ephemeral state. **No NoSQL/DynamoDB-class store** is adopted unless a measured need appears (revisit trigger: a workload Postgres partitioning demonstrably cannot serve). | The workload — master data, schedules, actuals, audit, configuration for industrial tenants — is relational, consistency-sensitive (D6), and moderate-volume. One database engine keeps operations, backup, and the D24 dual topology simple; the 15-year archive is an object-storage problem, not a database problem. | Agreed |
| **A4** | **Eventing and work distribution are two coordinators, not one.** **EventBus** standardizes on the **Kafka protocol** — a retained, ordered, replayable log — making it effectively **tier-1 protocol-config** (managed as MSK on AWS; self-hosted as Apache Kafka (KRaft) or Redpanda on Azure/GCP/on-prem), not a per-cloud provider abstraction. It carries the publish/subscribe streams: demand deltas (D14), execution actuals (4.3), schedule-published, configuration changes. **WorkQueue** is a separate, lighter coordinator for job distribution (optimizer runs 4.9, report generation) with provider candidates SQS / Service Bus / RabbitMQ — work queues need no log. The EventBus coordinator still owns **envelope schema & versioning, idempotency keys, publish audit, and per-key partition/ordering policy** (e.g. partition by demand-line/plant key so D14 deltas apply in order); the contract test suite enforces at-least-once + idempotent-consumer semantics. The Kafka log doubles as the **replay source for ML retraining (D5)**, with retention configured — though Postgres/object storage remains the system of record (A3); the bus is durable transport, not the authoritative store. | One protocol across all clouds is *more* portable than per-cloud pub/sub APIs, and a retained ordered log natively serves D14 ordering and D5 replay rather than pushing ordering to a separate FIFO tier or reconstructing history from the database. Heavier to operate than serverless pub/sub, but the platform already runs Postgres/Redis/OpenSearch per deployment, so one more stateful protocol service is not a categorical change; on AWS it is simply MSK. | Agreed |
| **A5** | **Compute & orchestration**: containerized services on Kubernetes (EKS / AKS / GKE / on-prem) — no FaaS-native (Lambda/Step Functions) dependencies in the core. The **optimizer runs as batch jobs** (long-running, CPU-bound solves; container resources sized per run). The **optimizer-run lifecycle** (trigger → run → validate → approval routing → commit, per 4.9 and D4/D25) is orchestrated by a **portable workflow engine (Temporal-class)**, whose durable execution history complements the D6 audit posture. | Portability dies quietly at the compute layer; containers keep all D24 topologies (including client-cloud) open. The optimizer's workload shape wants batch containers, not functions. Step Functions is the AWS-native trap the taxonomy exists to avoid. | Agreed |
| **A6** | **UI**: a single **Tamagui** cross-platform codebase delivering web, tablet, and phone per the D34 surface rules (tablet = full peer, phone = restricted; capability follows role, not device). The platform owns the **UI shell** — navigation, auth/session, the dashboard framework, permission gating — and modules contribute registered dashboards into it (A7, Section 6). Two carve-outs: (1) the **schedule board** (Gantt, drag-adjust, thousands of jobs) is a custom virtualized canvas component — Tamagui provides the design system around it, not the board; budgeted as its own workstream; (2) **print/PDF artifacts** (D34: dispatch lists, changeover sheets, pick lists, audit records) are **server-rendered**, not client print views — a separate rendering pipeline producing deterministic, archivable documents (consistent with D6/D46). | One codebase for three surfaces matches D34 exactly and the team's prior Tamagui experience. The two carve-outs are where cross-platform UI kits genuinely don't reach. | Agreed |
| **A7** | **Platform/module architecture.** The product is a **platform kernel + subscribable domain modules**; production scheduling is module #1. The kernel owns: identity & access (A9), tenancy & **module entitlement**, the shared organizational model (A10), the configuration framework (D42 generalized), the audit framework (D6 generalized), the notification engine (14.3 generalized), the provider construct (A2), and the UI shell (A6). **Entitlement is per-tenant** (AQ3): a tenant subscribes to a module or it doesn't, tied to commercial packaging; entitlement gates contract bindings, dashboards, and navigation. **Per-plant phased rollout is a separate `activation` state, not entitlement** — a tenant entitled to scheduling lights it up plant-by-plant during deployment without re-papering entitlement; activation churns during rollout while entitlement stays stable. Modules own their domain data, domain logic, domain configuration, and dashboard content, and **register** with the kernel: contracts (A8), dashboards & actions (into the A9 permission model), approval-tier hooks (D25), configuration entries (D42), notification event types (14.3). Candidate future modules: Master Data (A13, next), demand planning, capacity planning, net-requirements, network material allocation, labor scheduling & optimization, maintenance, supply-chain logistics. | The business spec already modularized every boundary (D15, D20, D43, D50); promoting those externals to optional first-class modules creates the single-view platform without redesign. Entitlement (which modules a tenant subscribes to) is the one genuinely new kernel concern; separating it from per-plant activation keeps phased rollouts from touching commercial config. | Agreed |
| **A8** | **Contract-first module boundaries.** Inter-module contracts are **platform-registered and versioned**; the business spec's Section 4 contracts (4.1–4.10) are the founding registry entries. Any counterpart that fulfills a contract is valid: per tenant, per contract, the binding is one of **four modes** — (1) **platform module** (tenant subscribes to the platform's own module), (2) **connector** to an external system, (3) **structured file upload**, (4) **native in-app** (platform as system of record) — i.e. D35 plus the platform-module mode. Bindings are tenant configuration (D42-governed). Modules are independently versioned and deployable against **pinned contract versions**; evolution mechanics per A12 (Section 6.5). | "Scheduling consumes the net-requirements *contract*, not the net-requirements *module*" is what lets a tenant use the client's existing demand planning system today and switch to the platform's module later — a configuration change, not an integration project. | Agreed |
| **A9** | **Identity & access.** **AuthN**: per tenant, OIDC/OAuth2 (and SAML where required) against the tenant's corporate directory (Entra ID, Okta, …) **and/or form-based local accounts** — both may coexist in one tenant (SSO for office roles; local/badge-style accounts for shop-floor users on shared terminals). Protocol-standard, tier 1 — no identity provider lock-in. **AuthZ**: the Section 9 model (role → dashboards → per-action rights, data scope, approval tier, D33/D25) is generalized into the **platform RBAC framework**; modules contribute dashboards, actions, and approval hooks, so one tenant role (e.g. plant manager) spans entitled modules in a single permission model. Data scope binds to the shared organizational model (A10). Sessions, token handling, and shop-floor shared-terminal session policy at implementation (AQ5). | The business spec's permission model was already module-agnostic in shape; one identity and one permission model across modules is a core platform promise ("single view") and the largest integration cost saved per added module. | Agreed |
| **A10** | **Shared reference data lives in the kernel.** **Plant, Plant group (D49), Customer, Program, Calendar (D17), users, roles, approval tiers** are kernel-owned, tenant-scoped entities consumed by every module — the "company hierarchy shared across modules". D17's modelled-once/consumed-at-own-grain rule generalizes from two consumers to N. **Part master / BOM is owned by the Master Data module, not the kernel** (A13, resolving AQ2): parts/BOM are a foundational *domain* with their own logic and SoR choices, so they live in a foundational module exposing part/BOM contracts; the kernel holds only the organizational model. | Org structure is the spine of permissions (A9), scoping (D24/D32), and cross-module dashboards, and is load-bearing for kernel concerns; the part/material domain is consumed by many modules but is still a domain, so it is a module (A13), not kernel. | Agreed |
| **A11** | **Kernel extraction strategy — no standalone platform phase.** The kernel is built **as part of module #1's delivery**, scoped to what production scheduling needs anyway (auth, tenancy, roles, org model, configuration, audit, notifications, providers, UI shell), but designed with the A7 contribution seams rather than hardcoded into scheduling. The second module is the proof of the seams. Explicitly rejected: a platform-first build phase before the first module ships. | The failure mode of platform pivots is a year of kernel engineering with no shippable product. Scheduling pays for the kernel; module #2 validates it. | Agreed |
| **A12** | **Contract versioning & evolution.** (1) **`MAJOR.MINOR` per contract**; registry entries carry contract ID, version, schema, status (`active`/`deprecated`/`sunset`), effective dates (D10). (2) **Minor** = compatible: add optional property; add value to an **open enum**; required→optional (minor for consumers, major for producers); docs. **Major** = breaking: remove/rename/retype a property; add a required property; add a value to a **closed enum**; change grain, keys, or unit semantics. Every contract **must annotate each enum open or closed** at registration. (3) **Consumer obligations**: ignore unknown optional properties; tolerate unknown open-enum values with a defined per-field fallback — enforced by contract test suites that exercise every consumer against a synthetic "future minor" (injected unknown fields + unknown open-enum values). (4) **Directionality is recorded**: producers may use less of the schema's optionality; consumers must accept all of it; impact analysis of a change is mechanical from the registry. (5) **Major releases dual-publish**: producer serves `N` and `N+1` through a deprecation window — default **two release cycles or 12 months, whichever is longer**, per-tenant extendable (D42-governed); `sunset` requires zero active bindings on the old major. (6) **Bindings pin the major, float the minor**: minor upgrades apply automatically; major migration is an explicit per-tenant, per-binding act (module upgrade for `platform_module`; client-facing template/connector change for `upload`/`connector`); the registry doubles as the migration dashboard. (7) **Boundary validation, D45-style**: every inbound payload validated against the bound version at ingestion (envelope carries `contract_id + version`, A4); failures are rejected into a data-quality exception flow, never coerced or partially absorbed; upload templates are versioned artifacts of their contract. (8) **Additive-first discipline**: contracts are designed with open enums, optional extensions, and extensible-attribute escape hatches (cf. 5.4 `additional_attributes`) so major bumps are rare, registry-documented events with a written migration note. Schema expression language resolves to **Avro/Protobuf with a schema registry** (pairs with the Kafka-protocol EventBus, A4); the registry is the runtime enforcement point for the open/closed and compatibility rules above. | Independently-deployed modules and slow-moving client-side counterparts cannot big-bang upgrade; pin-major/float-minor with enforced consumer tolerance gives safe continuous evolution, and block-don't-coerce at the boundary extends D45's never-guess posture to inter-module data. | Agreed |
| **A13** | **Master Data is a foundational module, not kernel.** The part/material domain — **parts** (identity `part_no` global-within-tenant per D12, revision, canonical UoM + conversion per D40, make/buy, Plant part mapping, effectivity D10) and **BOM** (topology, `level`, `qty_per`, `scrap_pct`) — is a domain in its own right (effectivity resolution, revision control, UoM conversion, BOM/where-used validation), owned by a **Master Data module** that exposes a **part contract**, a **BOM contract**, and an **asset contract** (A8). All other modules consume those contracts; no module reads another module's part tables. **Per-tenant system-of-record binding (D35/Q15) attaches to the Master Data contracts** — SAP tenant → connector, no-ERP tenant → native (Master Data is itself the system of record, maintained in-app) — answered once, at this boundary, consistently for every consumer. Master Data also owns the **physical/descriptive part attributes** and the **asset domain** (tooling — tools/dies/molds/fixtures — and production resources — machines/lines/work-centres and resource groups; MD10/MD14), per the ownership principle that **potential cross-module use** — not actual current use — determines placement (Master Data spec MD12, sharpening A13). Master Data is **canonical-only**: all external-system field/code/effectivity mapping lives in a separate integration/mapping component within the connector binding (A8/D35), not in the domain module (MD13). **The kernel retains only true cross-cutting concerns plus the organizational model** (Plant, Plant group D49, Customer, Program, Calendar D17), which stays kernel because it is load-bearing for auth and data scoping (A9/A10) rather than a consumed domain. Modules **extend** the part with the domain logic that *acts on* shared data but is read by no one else (scheduling: routings, operations, the changeover matrix & sequencing rules, lot-sizing). Master Data is the **dependency root** for net-requirements and scheduling and is therefore the next module after #1. | Master data is a foundational domain, not kernel furniture; putting BOM/parts in the kernel would make the kernel hold one domain's model (the Option-A drift A7 forbids), and putting them in scheduling would couple later modules to scheduling's tables (what A8 forbids). A foundational module with contracts satisfies both, and lands the SoR choice exactly where it's made once. | Agreed |
| **A14** | **ML parameter prediction is a platform-level capability, not a scheduling feature.** The pattern established in the scheduling module — *deterministic optimization owns the decision; ML predicts the uncertain parameters that feed it; GenAI reasons around it but never generates the plan* (D1–D3) — is a **platform capability any module may consume**. ML produces parameter predictions with a confidence score (D41) that feed a module's deterministic optimizer/logic; predictions overlay shipped/static defaults rather than replacing the deterministic baseline (D7), and improve as execution/loop history accrues (closed loop, D5). **First non-scheduling consumers** (the network material allocation module, NMA): (a) **supply reliability** — predicted mill on-time likelihood, feeding more conservative, churn-reducing allocation (D3-class); (b) **convergence parameters** — the allocation loop's dampening, materiality, and cycle thresholds (NMA6), predicted per cluster/material instead of hand-set. In all cases the *decision* and the *convergence/stopping logic* stay **deterministic and auditable** (D6); ML tunes inputs and thresholds, never makes the allocation or replaces the stopping rules. **Cold-start:** a tenant with no history runs on shipped static defaults (D48); ML refines them as history accumulates — and a tenant override (D42) always sits between, so the layering is default → tenant override → ML refinement. | Promoting D1–D3 from a scheduling feature to a platform pattern is what makes the AI value reusable across modules (the A7 platform promise); allocation is the first proof it generalizes. Keeping ML to *parameters and thresholds* — never the decision or the convergence guarantee — preserves auditability (D6) and the provable-termination property of the deterministic loop. | Agreed |
| **A15** | **GenAI is a platform capability with three bounded jobs.** Like ML (A14), GenAI is a platform capability any module consumes via the **LLMGateway coordinator** (A2). Its jobs: (1) **explain/justify** — narrate *why* a schedule, allocation, or net result is what it is, for planners and approvers; (2) **triage** — interpret disruptions and exceptions in natural language, summarize and route them; (3) **orchestrate** — trigger deterministic runs (schedule generation, what-if, re-optimization, allocation cycles) on request. **Hard limits, non-negotiable:** GenAI **never generates the decision** (sequence / allocation / net result — D2); its output is **always a proposal** through the guardrail (D4); LLM-influenced proposals are **human-approved by default** (D26); every interaction influencing a committed plan is **logged with pinned model versions, low temperature** (D6, A2). GenAI proposals carry a **confidence/reliance signal** surfaced on dashboards and evaluated by the proposal-source / `ml_reliance` approval triggers (D25/D41). | ML got a platform decision (A14) but GenAI was only asserted inside scheduling (D2); promoting it gives every module the same explain/triage/orchestrate capability under one set of guardrails, replacing ad-hoc "may explain" mentions in the module specs. | Agreed |
| **A16** | **Bounded agentic orchestration, with graduated autonomy.** An **agent** may orchestrate the deterministic machinery — observe state, gather context, call module capabilities as **tools** (each module's contracts are agent-addressable via the registry, A8; MCP the likely mechanism), chain steps **across modules**, evaluate optimizer/what-if outputs — and **assemble a recommended proposal**, including across the allocation↔scheduler boundary (NMA6) and other cross-module flows (the single-pane-that-acts, A7). **Bounded like every other loop:** an agent run has a **max-steps backstop and a recorded stop-reason** (the NMA6 convergence discipline generalized — provable termination, no unbounded agent loops), runs **within one tenant** (never cross-tenant), and **never generates the decision itself** (the optimizer does, D2). **The guardrail is the wall (D4):** an agent's assembled proposal passes the **hard gates** — feasibility, delivery-window, material (D4 stage 1) — **always, without exception**, then the **approval policy** (D4 stage 2 / D25). **Graduated autonomy (the trust-earned commit path):** at launch, agent proposals are **human-approved** like any LLM-influenced proposal (D26, conservative posture). As a **measured track record** of proposal-quality-vs-outcome accrues (closed loop, D5), per-rule/per-tier configuration (D25/D26) may permit an agent to **auto-commit** a proposal when its **confidence score exceeds a configured threshold** — extending D26's existing "automate as trust grows" path from human-configured auto-approval to confidence-gated agent auto-commit. **Critically, auto-commit graduates only the human-approval stage — never the hard gates** (D4 stage 1 always runs); thresholds are per-rule/tier configuration (D42), default conservative (D48); and the **agent proposal confidence** is a defined, logged composite (optimizer solution quality + feeding ML confidences D41 + situational novelty), calibrated by outcomes (D5) so trust is **earned, not assumed**. **Build deferred:** this is a design-time commitment now; the build follows once the deterministic modules it orchestrates are solid (an agent is only as good as the tools it calls). | Agency that orchestrates deterministic tools and stops at the guardrail captures the cross-module value (A7) without surrendering auditability (D6) or the deterministic-decision invariant (D2). Confidence-gated graduated commit lets autonomy grow exactly as fast as measured trust justifies — the same trust-graduation D26 already established, with a hard floor (the deterministic gates never graduate). | Agreed |
| **A17** | **Preference learning from human proposal choices — recommend, never auto-apply.** The platform persists a **proposal disposition record** (scheduling spec 4.11): for every AI decision point, the full **ranked option set** the AI offered (with its confidence/ranking), which option the human selected, whether it was edited before commit, and an **optional reason code** (encouraged, never mandatory — approvals are never blocked on it; unreasoned selections are weighted lower as learning signal). From the *pattern* of choices across many decisions, the AI may learn **revealed preferences** — and use them only two ways: (a) **re-rank** the proposals it presents so its top suggestion better matches revealed preference, and (b) **recommend objective-weight or approval-policy changes** to a human (e.g. "humans override toward stability here 80% of the time — consider raising the changeover weight"). **Hard limits:** preference learning **never** alters the hard gates (D4 stage 1), **never** silently changes a constraint or weight — any weight/policy change goes through the normal config guardrail (D42: proposed, human-approved, audited) — and **never** narrows the option set to only past picks (it must keep offering genuine alternatives, so a fatigue-driven rubber-stamp habit can't encode itself). **Earned against outcomes, not agreement:** approval-rate and choice signals are always paired with **proposal-vs-outcome** data (did accepted proposals actually perform, from execution actuals D5/4.3), because agreement is cheap and outcomes are not — high approval driven by automation bias must not be mistaken for genuine quality (this matters doubly since the same track record gates A16 autonomy). **Build deferred** alongside A16 (both read the same disposition record). | "Will the AI learn from which proposal the human picks" is a real capability worth having — it improves the proposal ranking and surfaces objective-weight drift — but learned preference must inform *ranking and recommendations*, never *decisions or gates*, or revealed preference silently becomes unaudited policy and rubber-stamping becomes self-reinforcing. Recommend-don't-auto-apply (the D26 conservative posture) and outcome-pairing are what keep it honest. | Agreed |

---

## 4. Dependency taxonomy (A1)

The rule applied to every external dependency, in order:

1. **Is there a standard protocol?** → bind by configuration, no abstraction. *(Postgres, Redis/RESP, S3 API, OpenSearch REST, Kafka protocol, OIDC/SAML, OpenTelemetry.)*
2. **Is the dependency avoidable?** → avoid it. *(DynamoDB-class stores — A3; FaaS-native compute — A5.)*
3. **Otherwise** → provider construct (A2), entered into the coordinator catalog (Section 5).

| Tier | Dependency | Binding | Notes |
|---|---|---|---|
| 1 — protocol | PostgreSQL | connection config | Portable SQL discipline (A3) |
| 1 — protocol | Redis (RESP) | connection config | Cache / ephemeral only |
| 1 — protocol | Object storage (S3 API) | config + thin Azure Blob provider | Effectively tier 1; Blob is the one shim |
| 1 — protocol | OpenSearch (REST API) | connection config | The *product* is the standard; managed on AWS or self-hosted anywhere. Not abstracted over rival search engines. |
| 1 — protocol | Kafka protocol (EventBus) | connection config | MSK on AWS; Apache Kafka (KRaft) or Redpanda self-hosted (A4). EventBus coordinator retained for envelope/audit/ordering logic. |
| 1 — protocol | OIDC / SAML | per-tenant IdP config | A9 |
| 1 — protocol | OpenTelemetry | collector config | Instrument once; backend per deployment |
| 2 — provider | Blob, work-queue, secrets, LLM, notifications, (search if ever swapped) | coordinator + providers | Section 5 catalog. EventBus is now tier-1 protocol (Kafka, A4), not a per-cloud provider. |
| 3 — avoided | DynamoDB-class NoSQL | — | Revisit only on measured need (A3) |
| 3 — avoided | Lambda / Step Functions-native | — | A5 |

---

## 5. Coordinator catalog (A2)

One coordinator per cross-cutting capability. Conventions: the **coordinator** is concrete and owns tenancy, audit, retention, and policy; the **provider interface** lists only the primitives the coordinator delegates; every coordinator ships a **local provider**; every interface ships a **contract test suite** run against all providers.

| Coordinator | Domain logic owned by the coordinator | Provider interface (primitives) | Providers — AWS / alternates / local |
|---|---|---|---|
| **BlobStorage** | Tenant-scoped key prefixing (D24); retention & tiering policy (D46); access audit (D6); content-type and size policy | `save`, `get`, `delete`, `list`, `getSignedUrl` | S3 / Azure Blob, GCS / **FileSystem** (signed URLs emulated via app-served tokened URLs — contract-tested to be caller-indistinguishable) |
| **EventBus** *(Kafka protocol, tier-1; coordinator retained for the logic below)* | Envelope schema & versioning; idempotency keys; publish audit; delta semantics (D14); partition/ordering policy per key; replay-for-retraining (D5) | `publish`, `subscribe`, `ack` | Kafka protocol: **MSK** / Apache Kafka (KRaft) or **Redpanda** self-hosted / **local single-node Kafka/Redpanda** |
| **WorkQueue** | Job lifecycle for optimizer runs (4.9); retry & timeout policy; dead-letter handling; priority | `enqueue`, `dequeue`, `complete`, `fail` | SQS / Service Bus / **RabbitMQ or in-memory** |
| **SearchIndex** | Index schema management; mandatory tenant filter on every query; reindex orchestration | `index`, `search`, `delete` | OpenSearch managed / OpenSearch self-hosted (same API — arguably tier-1 config; coordinator retained for the tenant-filter guarantee) / **local container** |
| **SecretsVault** | Rotation policy; access audit; secret naming/scoping | `getSecret`, `putSecret` | Secrets Manager / Key Vault / **local encrypted file** |
| **LLMGateway** | Prompt & model-version pinning (D6); low-temperature enforcement for decision-influencing calls; full interaction logging (D6, D26); token/cost accounting per tenant | `complete`, `embed` | Bedrock / Anthropic API direct, Azure-hosted / **recorded-stub** (replayable canned responses for dev/CI). *Named future exception candidate for per-tenant binding within a shared instance (A2) — e.g. a tenant requiring LLM traffic confined to their cloud boundary.* |
| **NotificationDispatcher** | Alert rules → recipients/channels/severity resolution (14.3); delivery audit; per-channel formatting; throttling/digest policy | `sendPush`, `sendEmail` (in-app delivery is internal, not a provider concern) | SNS + SES / FCM + SendGrid-class / **console/log** |

> Adding a cloud = one provider class per affected coordinator + passing the contract suite. Adding a coordinator = demonstrating the dependency fails taxonomy steps 1 and 2 first.

---

## 6. Platform kernel & module model (A7–A11)

### 6.1 Kernel responsibilities

| Kernel area | Generalizes | Notes |
|---|---|---|
| Identity & access (AuthN/AuthZ) | Section 9, D33, D25 | A9; module-contributed dashboards/actions/approval hooks |
| Tenancy & module entitlement | D24 | Entitlement gates bindings, dashboards, navigation per tenant |
| Organizational model | Plant, Plant group (D49), Customer, Program, Calendar (D17) | A10; the shared company hierarchy. **Parts/BOM are NOT here** — they are the Master Data module (A13). |
| Configuration framework | D42 | Tenant-scoped, effectivity-dated (D10), audited (D6), guardrail-routed changes (Section 12 of business spec); modules register their config entries |
| Audit framework | D6 | One audit pipeline; modules emit domain events into it; retention via D46 policy & BlobStorage tiering |
| Notification engine | 14.3 | Modules register event types; kernel resolves rules → recipients → channels via NotificationDispatcher |
| Provider construct | A2 | Section 5 catalog; kernel-owned, module-consumed |
| Contract registry | A8 | Versioned contracts; per-tenant bindings (Section 6.3) |
| UI shell | D34, A6 | Navigation, session, dashboard framework, surface/permission gating; modules contribute dashboards |

### 6.2 Module responsibilities & contributions

A module owns its **domain data, domain logic, and domain configuration** (for scheduling: routings, tools, changeover matrices, sequencing rules, lot-sizing, the optimizer, schedule data). On installation/entitlement a module **registers** with the kernel:

- its **contracts** (provided and consumed) into the contract registry (A8)
- its **dashboards and per-dashboard actions** into the RBAC framework (A9; business-spec Section 10 becomes scheduling's registration set)
- its **approval-tier hooks** (D25) into the kernel approval framework
- its **configuration entries** into the configuration framework (business-spec Section 14 becomes scheduling's registration set)
- its **notification event types** (business-spec 14.3 trigger events become scheduling's registration set)

### 6.3 Contract binding model (A8)

Per tenant × contract, exactly one binding mode:

| Mode | Meaning | Example (contract 4.1, net requirements) |
|---|---|---|
| `platform_module` | Another entitled platform module fulfills the contract | Tenant subscribes to the platform's demand-planning + net-requirements modules |
| `connector` | Configured integration to the client's external system | Client's existing demand system, via connector |
| `upload` | Structured file upload against the contract's template | Bootstrap or low-volume tenants |
| `native` | Platform is system of record; data maintained in-app | No-ERP tenants (D35) |

Bindings are tenant configuration (D42-governed: effectivity-dated, audited, permission-gated) and record `contract + major version` (A12: minor floats, major is pinned). Switching a binding — e.g. external demand system → platform demand module — is a configuration change against the same contract, not an integration project.

### 6.4 Module roadmap mapping

| Candidate module | Slots in behind (existing contract/boundary) |
|---|---|
| **Master Data** (foundational, next after #1) | Owns the part, BOM & asset contracts (A13; assets per MD10); dependency root for net-requirements, scheduling, and most modules |
| Demand planning | Upstream of net requirements (D20, Q1) |
| Net-requirements | Contract 4.1 (D20) |
| Capacity planning | Contracts 4.2 / 4.5 / 4.7 (D15) |
| Network material allocation | Contracts 4.8 (in) / 4.10 (out) (D50) |
| Labor scheduling & optimization | Labor-pool availability (Section 5.3) + labor feedback 4.7 (D43: "if built, a separate module") |
| Maintenance | Calendar & maintenance windows (D17); tooling model (5.3) |
| Supply-chain logistics | Out of scheduling scope (2.2); consumes committed schedule 4.4 / ASN signals |

### 6.5 Contract lifecycle (A12)

The registry governs every contract through this lifecycle:

| Stage | Meaning | Gate |
|---|---|---|
| `active` | Bindable; producers serve it | Registration with full schema + per-enum open/closed annotations |
| `deprecated` | Still served (dual-publish), no new bindings encouraged | Successor major is `active`; deprecation window starts (default: 2 release cycles or 12 months, whichever longer; per-tenant extendable) |
| `sunset` | No longer served | **Zero active bindings** on this major — verified from the registry, since all bindings are registered (6.3) |

**Change classification at a glance:**

| Change | Class | Why |
|---|---|---|
| Add optional property | Minor | Consumers must-ignore unknowns |
| Add value to open enum | Minor | Consumers fall back per field policy |
| Add value to closed enum | **Major** | Consumers branch on every value (e.g. 4.1 `firmness`, `change_type`, `demand_type`) |
| Required → optional | Minor for consumers / **major for producers** | Directionality recorded in the registry |
| Add required property; remove/rename/retype; change grain/keys/units | **Major** | Breaking by definition |

**Enforcement points:** (a) registration-time — schema diff is auto-classified minor/major against these rules; (b) build-time — consumer contract tests run against a synthetic future-minor of every consumed contract; (c) runtime — ingestion validates payloads against the bound version (envelope `contract_id + version`) and rejects failures into the data-quality exception flow (D45 pattern), never coercing.

**Founding registry entries:** business-spec contracts 4.1–4.10 register as `1.0`, each with its enums annotated open/closed as part of registration (first concrete task of the registry build). The **part**, **BOM**, and **asset** contracts (A13 / Master Data spec) register alongside them as the Master Data module's provided contracts; UoM conversion and physical attributes are nested in `part`.

---

## 7. Persistence & data lifecycle (A3)

- **PostgreSQL** — system of record for all kernel and module data; tenant scoping per D24 (isolation mechanics: shared-instance logical isolation vs dedicated database, per topology); portable SQL only; JSONB for extensible attributes (e.g. 5.4 `additional_attributes`), partitioning for high-volume tables (actuals, audit).
- **Redis** — cache and ephemeral state only; nothing durable lives in Redis.
- **Object storage (BlobStorage coordinator)** — print/PDF artifacts (A6), exports, and the **D46 long tail**: schedule versions, actuals, and audit traces past their hot window are tiered to columnar files (e.g. Parquet) under the tenant's retention policy (life of program + 15 years default; never auto-purged without an explicit configured trigger). Tiered data remains queryable for recall reconstruction (mechanism at implementation; requirement is reconstructability per D6/Section 7 of the business spec, not hot-query speed).
- **SearchIndex** — derived, rebuildable projections only; never a system of record.

---

## 8. Compute, orchestration & environments (A5)

- **Kubernetes-based** services (EKS first; AKS/GKE/on-prem per topology); containers are the unit of deployment for kernel and modules alike.
- **Optimizer runs** execute as batch jobs with per-run resource sizing; run records per 4.9.
- **Workflow orchestration** (Temporal-class) drives the optimizer-run lifecycle (trigger → run → hard gates → approval routing → commit, per D4/D25) and other long-lived processes (e.g. binding switchovers, reindexing); durable execution history complements the D6 audit trail.
- **Environments**: local dev runs entirely on local providers (A2) + containers (Postgres, Redis, OpenSearch, local broker) — no cloud account required; CI runs the contract test suites against local providers always and cloud providers on a schedule/gate.

---

## 9. UI architecture (A6)

- **One Tamagui codebase**; surfaces per D34 (web full, tablet full peer, phone restricted) with capability following role.
- **Kernel-owned shell**: navigation, auth/session, dashboard framework, surface & permission gating, alert inbox.
- **Module-contributed dashboards**: business-spec Section 10 is the scheduling module's contribution set; cross-module composite dashboards (the "single view") are a kernel capability over registered dashboards — multi-plant overview generalizes to multi-module overview.
- **Schedule board**: custom virtualized canvas (Gantt, drag-adjust, large job counts); its own workstream; Tamagui supplies the surrounding design system.
- **Print/PDF**: server-rendered pipeline (deterministic, archivable via BlobStorage; D34 artifacts; audit records per D6/D46).

---

## 10. Open architecture questions (AQ-series)

| ID | Question | Why it matters / what resolves it | Related | Status |
|---|---|---|---|---|
| **AQ1** | Who operates isolated single-tenant instances — vendor-operated in vendor accounts, vendor-operated in the client's cloud account, or client-operated? (May differ per client.) | Determines residency/access posture, upgrade cadence, supported clouds per topology, and how far portability must be proven (Azure provider set needed at launch or on first demand?). Resolved by commercial/deployment strategy with the first isolated-deployment prospect. | A1, D24 | Open |
| **AQ2** | Part master / BOM ownership. **Resolved → A13**: a **Master Data module** (foundational, next after #1) owns parts and BOM and exposes part/BOM contracts (A8) consumed by all modules; per-tenant SoR binding (D35/Q15) attaches to those contracts; the kernel keeps only the organizational model. | A10, A13 | Closed |
| **AQ3** | Module entitlement granularity. **Resolved → A7**: entitlement is **per-tenant** (tied to commercial packaging); per-plant phased rollout is a separate **`activation`** state, not entitlement, so go-live churn never touches commercial config. | A7 | Closed |
| **AQ4** | EventBus provider family. **Resolved → A4**: standardize on the **Kafka protocol** (MSK on AWS; Apache Kafka/Redpanda self-hosted) — one protocol across clouds (tier-1), native ordered partitions for D14 deltas, retained log for D5 replay. WorkQueue stays a separate lighter coordinator (SQS/Service Bus/RabbitMQ). Resolves the A12 schema-language sub-question toward Avro/Protobuf + schema registry. | A4, A12 | Closed |
| **AQ5** | Shop-floor authentication & session policy: shared-terminal sessions, badge/RFID login, kiosk-mode timeout rules for operator roles? | Operator/line-lead roles (Section 9 of business spec) often work on shared devices; SSO assumptions break there. Resolved with client floor-IT input (relates to business Q14 device landscape). | A9 | Open |
| **AQ6** | D18 (carried from business spec): build vs configure the optimization engine; CP / MILP / metaheuristic / commercial APS? | Module-internal to scheduling but affects batch sizing, licensing, and provider posture (a commercial solver is a dependency to taxonomize). Resolve during scheduling-module detailed design with a benchmark on representative client constraint sets. | A5, D18 | Open |
| **AQ7** | Contract versioning & evolution mechanics. **Resolved → A12 / Section 6.5**: MAJOR.MINOR with open/closed enum annotations; must-ignore consumer obligations enforced by future-minor contract tests; dual-publish deprecation windows (2 cycles / 12 months, per-tenant extendable); bindings pin major, float minor; D45-style boundary validation. Schema language resolved with AQ4. | A8, A12 | Closed |
| **AQ8** | **Agent proposal-confidence model & graduated-autonomy calibration** (A16): how is agent proposal confidence composed (optimizer solution quality + feeding ML confidences D41 + situational novelty), what measured track-record justifies enabling auto-commit per rule/tier, and how is it monitored/recalibrated? | A16 commits to confidence-gated agent auto-commit but the confidence model and the trust threshold need definition before any auto-commit is enabled. Resolve during the (deferred) agentic build; conservative human-approved posture until measured (D26). | A16, D25, D41 | Open |

---

## Appendix A — Traceability: business-spec flags resolved here

| Business-spec flag (`→ Architecture doc`) | Resolved by |
|---|---|
| Tenancy / isolation / deployment mechanics (D21, D24) | Section 2.2, A1–A3, AQ1 |
| Optimization technique / build-vs-configure (D18) | Carried open as AQ6 |
| Integration mechanics (Section 13, D35) | A8 binding model (Section 6.3); per-connector mechanics at implementation |
| Datetime physical representation (Section 4 conventions) | Implementation detail under A3 (timestamptz; plant-local rendering via Plant `timezone`) |
| Campaigning objective weighting (D28) | Scheduling-module design under AQ6 |
| Nervousness-control mechanics (D44) | Scheduling-module design (optimizer warm-start/repair); platform-level: stability window is D42 configuration |
| Model pinning / low-temperature LLM mechanics (D6) | LLMGateway coordinator (Section 5) |
| D46 storage/tiering mechanics | Section 7 (BlobStorage tiering) |

---

*End of document — Draft v0.9.*
