# SSoT

**English** · [简体中文](README.zh-CN.md)

## Installation

```sh
npx skills add mouriya-s-lab/SSoT --skill ssot ssot-judge ssot-requirement ssot-c4 ssot-vdm ssot-quint ssot-write-level ssot-write-deploy ssot-write-contract ssot-write-behavior ssot-verify-structure ssot-verify-contract ssot-verify-behavior ssot-migrate-read --global --agent codex claude-code --yes
```

After installing the skills, run `ssot setup` once (before `ssot` is on `PATH`, run `bun ~/.agents/skills/ssot/scripts/ssot.ts setup`; requires `bun` and a Java 21+ JDK). `setup` installs VDMJ, QuickCheck, LikeC4, Quint, elkjs, and a headless browser, and links `ssot` into `~/.local/bin/ssot`. See [`setup.md`](skills/ssot/references/setup.md) for environment requirements and directory layout.

---

Software engineering design routinely fails at two opposite extremes. At one end lies natural-language design prose: architectural topology, database columns, local retry policies, and interface promises coexist in the same document, unchecked by any compiler and porous to implementation detail, decaying into stale commentary the moment code evolves. At the other end lies upfront full-system formal modeling: specifying global behavior in a state-machine language and proving safety properties before writing code, which contradicts a basic engineering reality—formal verification presupposes a stable target, whereas during domain exploration and early design the model itself is the least stable hypothesis in the system.

Before a system survives runtime contact, domain boundaries shift and concurrency or failure modes remain partially unobserved. Forcing the entire system into a state-transition model at that stage builds formal deductions on fragile guesses; a single revision to domain understanding invalidates both the state space and its proofs. Conversely, abandoning formal constraints for natural language because early understanding is unstable strips system boundaries of any machine-checkable criterion.

Resolving this dilemma requires recognizing that **different layers of knowledge in a software system decay at different half-lives**, and separating modeling and verification across three carriers ordered by when that knowledge stabilizes:

1. **Macro topology and authority ownership stabilize first**—which runtime units compose the system, which unit is the single authoritative store for a class of facts, and where trust boundaries fall. These partitions host all formal contracts, stop strictly at the container or component level (never drilling down to code), and depend on ontological role assignment that must be judged through hierarchical hiding and visual density (**LikeC4**).
2. **Negative constraints on a single leaf boundary stabilize second**—which ports a module exposes and which data invariants it refuses to violate. This layer replaces traditional module design documents, provided the specification language natively supports *partial elision* alongside first-order logic predicates so unsettled internal structures and replaceable mechanisms remain opaque (**VDM-SL**).
3. **Cross-boundary serial and parallel composition stabilizes last**—races, out-of-order asynchronous messages, and crash recovery occur almost entirely at the seams between boxes. Only after each individual box's invariants stand firm does SSoT wire boxes with genuine interleaving risk into a dynamic model, using bounded simulation and cross-layer trace replay to verify that boundary contracts hold under concurrent composition (**Quint**).

SSoT (Single Source of Truth) organizes these three carriers into a one-way generation and verification chain. Every location in the system defaults to a single box or arrow on the architecture diagram (invisible by default). A location drills down one layer only when a concrete, falsifiable hazard exists, cannot be localized by structural boundaries and ordinary compiler checks alone, and will expose a faulty contract or interleaving once modeled; model precision is strictly bounded by the project stage declared by the user and by actual runtime observations, never outrunning evidence.

---

## 1. The Structure Layer (LikeC4): Why Architecture Diagrams Cannot Be Reviewed Like Code

Formal contracts cannot exist without a host. Before writing a precondition or invariant, a design must establish which architectural unit owns the contract. Deciding at the macro level what deserves to be a separate box is an ontological judgment that syntax rules cannot pre-formalize: is a given unit an independent operating-system process (`container`), a functional module encapsulated behind an interface inside a container (`component`), or the persistent authoritative source of a class of domain facts (`#datastore`)? When a system reads and writes core domain records through a managed external service, labeling that service `#external` from the surface appearance of network calls rather than `#datastore` distorts authority ownership, read/write direction, and fault boundaries across the entire design.

Early versions of SSoT attempted to review LikeC4 models the way engineers review code: feeding `.c4` source files, requirement lists, and tool-exported Markdown review bundles (`ssot view`) to a reviewer. Three empirical failures demonstrated that architecture diagrams cannot be gated by source or text review, forcing structural verification into pure visual blind review.

First, source and text review turn architecture diagrams into text dumps. When a reviewer reads `.c4` source like code, attention gravitates toward verbal completeness—asking whether a description states causal rationale, whether a child element lists every permission ownership rule, or whether an arrow justifies its direction. To pass review, authors stuffed `description` strings with citations, requirement IDs, and incident statistics: in observed runs, single-element descriptions exceeded 768 characters, a single `ledger` box in `checkout.c4` accumulated 22 requirement IDs, and one degenerate model skipped the container layer entirely to slice a pipeline into 84 components wired with 23 `callback` edges to bypass acyclicity checks. In `.c4` source and Markdown review bundles, these models looked thorough and compiled cleanly, earning passing verdicts from text reviewers; rendered in a headless browser, they produced canvases 6,887 px to 11,927 px wide filled with identical small-print rectangles that were unreadable as architecture diagrams.

Second, mechanical rules invented to patch text review actively induce bad architecture. In blind mutation experiments on text review bundles, layer-by-layer text inspection missed deleted edges (such as dropping `api -> fulfillment`) while generating `0.413` false positives per layer. When the toolchain added a mechanical rule (`view.unrealized`, requiring every parent edge to be realized by a same-direction child edge) to close that gap, modeling agents silenced the diagnostic by fabricating a bogus `fulfillment -> inventory.allocator` dependency that pierced the `Inventory` contract boundary—and both syntax checks and text rules let it pass.

Third, source inspection masks information loss in the rendered artifact. After abolishing text review bundles and switching to `RenderReview`—where the reviewer receives only the PNG images exported by `ssot render` and is forbidden from reading `.c4` source—the very first visual pass caught 7 defects invisible in source review: all 4 exported diagrams had lost their top title bars because LikeC4's `--description` rendering condition was unmet; component-level relationships in deployment views collapsed into unreadable `[...]` arrows; `global style` rules silently failed in deployment views so storage buckets degenerated into plain rectangles; and a `Cancellation -> Fulfillment` arrow labeled "wait for in-flight reserve to return" exposed cross-connection temporal sequencing mixed into static structure directly on the canvas.

SSoT therefore splits structural verification cleanly in two. The deterministic compiler (`ssot check`) enforces formal invariants: restricting models to the four C4 abstractions (`actor`, `system`, `container`, `component`, never drilling down to code), requiring a unique drill-down view for every non-leaf element (`struct.views`), and rejecting contract- or behavior-layer identifiers inside structural metadata (`vocab.slots`). Structural review (`ssot-verify-structure`), by contrast, is forbidden from inspecting anything other than rendered images. Judging from rendered diagrams alone is not an appeal to subjective aesthetics: LikeC4's hierarchical hiding (`view of`) turns **information hiding and cross-layer coupling conservation** into visible geometric constraints. Each view hides lower-level internals, every incoming or outgoing arrow on a parent box must visibly land on a direct child when drilling into the child view, and high-level views cannot leak low-level concepts. An independent reviewer agent (`ssot:reviewer`) inspects the rendered PNGs in sequence without access to `.c4` source, diagnostics, or requirement documents; anything illegible or visually unbalanced on the canvas fails as a structural defect.

---

## 2. The Box Layer (VDM-SL): Replacing Module Design Docs with First-Order Logic That Supports Partial Elision

When a leaf element on the structure diagram (a `container` or `component` with no child elements) passes the three drill-down questions and is tagged `#contract`, it replaces the traditional module design document. Yet natural-language prose, Domain-Driven Design (DDD) schema tools, relational or set-based languages such as Z and Alloy, and proof-centric verifiers each hit structural limits when deciding what belongs on a module boundary and how to feed a one-way generation and replay chain.

Most code inside a module exists solely to maintain an externally observable invariant. When two modules hand off tasks across a buffered channel, the implementation may guard concurrent access with a writer mutex, a reader mutex, or a lock-free atomic queue. Synchronization primitives themselves do not belong in the design specification: as long as the input/output relation observed at the channel ports holds, locking strategy and placement can be swapped without changing the interface. Modeling a mutex in the design and proving mutual exclusion both re-verifies a standard paradigm and hard-codes an implementation choice as implementation bias. The design should lock down only the result relation and data invariants promised at the ports.

| Carrier Type | Limitations as a Module-Boundary Specification |
|---|---|
| Natural-language design docs | No syntactic boundary; routinely mixes in locks, retries, caches, and scratch fields; cannot be type-checked or evaluated against counterexamples; silently rots as code evolves |
| DDD tools / Schema DSLs | Essentially structured field inventories that force early commitment to Entity and Value Object storage layouts while lacking first-order quantifiers and set/map algebra to state invariants |
| Proof-centric verifiers (Dafny / Lean / Event-B) | Elision is syntactically possible (Dafny `{:axiom}` and bodyless methods, Lean `sorry`, Event-B post-state predicates `x :\| P(x, x')` and discharged proof obligations), but treated as an audited warning on a workflow whose endpoint is a completed proof; early specifications with heavy elision surface as a queue of unresolved warnings that pressure modelers into discharging proofs and writing synchronization mechanisms and algorithmic steps back into the spec |
| Z (executed via ProB / ProZ) | First-order logic and implicit schemas express boxes well, but executable evaluation requires a pipeline from LaTeX extraction through Fuzz type-checking and translation into B, imposes fixed structural conventions (such as a mandatory `Init` schema), and lacks generic definitions, making it awkward as an evaluation backend for one-way code generation and trace replay |
| Alloy | Relational logic and bounded analysis excel at counterexample search, but lack implicit operations with read/write frame declarations (`ext rd`/`wr`) and `is not yet specified` elision; records and tagged union types must be encoded as signatures (`sig`) and atoms that do not map 1-to-1 to Quint's static type system |
| **VDM-SL (SSoT Box Carrier)** | **Combines full first-order logic predicates ($\forall, \exists$) and set/sequence/map algebra with native elision (`token`, `is not yet specified`, implicit operations) and counterexample search (VDMJ + QuickCheck, where `MAYBE` is non-fatal) as the default workflow** |

SSoT chooses VDM-SL for this balance between mathematical precision and default elision. Each VDM-SL module corresponds to one leaf box on the structure diagram: exported functions and operations are the box's **ports**, parameter and return types are the **wires** attached to those ports, and the module's `state` is the box's own **feedback wire**—carrying authoritative facts left by one port invocation into the next (for example, `checkout_inventory` records a `released` set on its feedback wire solely because the `reserve` port's postcondition promises to reject stock lock requests after release, not to track which stage of the order lifecycle has been reached).

Early in a project or at locations without runtime observations, identities and payloads that do not yet matter are declared as opaque `token` types, unconstrained ports are written `is not yet specified`, and no state fields are pre-allocated. As runtime observations accumulate, confirmed boundaries are tightened into implicit operations with `ext rd`/`ext wr` frames, `pre`/`post` predicates, and state `inv` invariants, while `ssot check` rejects procedural implementation bodies containing local variables (`dcl`), assignments (`:=`), or loops (`contract.body`).

To keep elision from degenerating into vacuous shells, SSoT does not demand discharging every proof obligation (unresolved `MAYBE` obligations remain review hints; only concrete counterexamples found by QuickCheck raise `contract.po` errors), but enforces two strict criteria:

- **Adequacy**: the specification constraints together with external Domain Properties must entail the attached requirement ($\text{Spec} \land \text{Domain} \Rightarrow \text{Req}$), and every `pre`, `post`, and `inv` must reject a concrete violating instance when evaluated directly against the unmodified specification via `ssot eval`.
- **Zero implementation bias**: every state distinction on the feedback wire must be observable through a sequence of exported port calls; phase enums, counters, or progress flags that cannot be distinguished through external ports are rejected as implementation bias.

---

## 3. The Wiring Layer (Quint + String Diagrams): Verifying Cross-Boundary Composition with Typed Feedback Wiring

Once single-box invariants are established in VDM-SL, the most elusive failures emerge **at the seams between multiple boxes**: a daemon crashes and restarts mid-flight, an in-flight asynchronous request arrives after a close signal, or concurrent processes mutate the same persistent fact.

A common habit in concurrency modeling is to define a phase enum for each entity and write a transition table across phase labels ($S_1 \to S_2 \to S_3$). TLA+ and Quint define system state as a valuation of all variables and do not require phase enums; the defect lies in **encoding progress as phase labels**, which breaks down under cross-component composition. For local branching after a single port returns a union type (such as `HoldId | Rejected`), ordinary conditional branching suffices without a state machine. For genuine cross-process coordination, phase-label modeling assigns each node an enum tag (`Pending | Reserving | Reserved | Cancelling | Settled`) and writes transition rules around label jumps. Yet a control-flow label is an empty **type identifier**—it neither explains what entitled the system to reach that point nor carries the data credentials and invariants established along the way. Worse, state in distributed and concurrent systems lives across channels with distinct lifecycles (volatile process memory lost on crash, in-flight network messages surviving process restarts, and persistent authoritative stores). Enumerating a global transition table over the Cartesian product of phase labels causes a combinatorial explosion the moment an orthogonal dimension (such as restart `epoch` or asynchronous cancellation) is added.

Stripping away artificial phase labels reveals that the true type behind any stage is **the value currently held on a specific lifecycle channel (a credential handed out by an upstream port) together with its contract invariants**. Grounded in the feedback algebra of open transition systems (Di Lavore et al., *Span(Graph): a Canonical Feedback Algebra of Open Transition Systems*, arXiv:2010.10069—"Theory of Processes + Feedback = Theory of Stateful Processes"), SSoT's third layer replaces phase-label transition tables with **String Diagrams** expressed in **Quint** (chosen over untyped TLA+ for its static type system and modern syntax).

In a Quint wiring diagram, every `var` is a delay wire with an explicit type and lifecycle: a contract box's feedback wire uses the state type generated from VDM in `.gen/contract.qnt` and initializes to `<alias>::initial`; intra-process handoff wires between sequential steps (such as `toReserve: Set[ItemId]` or `awaiting: Set[(ItemId, HoldId)]`) and crash-surviving in-flight wires (`inflight`) each carry their respective domain credential types. Sequential processing is written as a chain of step boxes (`action`) whose enabling condition reads no phase field—a step fires if and only if its input wire holds a value placed there by the preceding step (until `writeItem` produces an `ItemId`, the input argument to the next step does not exist). `ssot render` renders the module directly as a `wire -> step -> wire -> step` composition diagram where any pseudo-state-machine progress variable read and written by many steps stands out immediately as an abnormal hub. Introducing a process crash or cancellation takeover requires only adding an environment box that clears volatile intra-process wires while preserving persistent contract feedback wires and in-flight network wires.

Placing Quint at the third layer and enabling it strictly on demand reflects the order in which engineering knowledge stabilizes: before single-box VDM invariants settle, cross-box concurrency models have no stable boundaries to compose. Once leaf-box `pre`/`post`/`inv` contracts are in place, SSoT wires only the boxes involved in a specific concurrency or crash hazard into a String Diagram. Because VDM-SL's implicit `post` is a mathematical relation between pre- and post-states whereas Quint simulation requires executable state transitions (`commit`), `ssot check` runs Quint bounded simulation (checking `safety` invariants on observable wires and verifying `witness*` coverage targets to prove the model actually reaches critical interleavings rather than satisfying safety vacuously) and then **automatically replays every contract call in the generated ITF trace against the unmodified VDM specification in VDMJ**, verifying `pre`, `post`, `inv`, and `ext rd`/`wr` frame conditions (`replay.*`) step by step.

On-demand activation also means Quint is typically introduced after code is running and runtime observations exist: environment boxes in the wiring diagram (crashes, reordering, re-entrancy) model only hazards actually observed in operation. `ssot check` verifies the model itself—that the wiring respects VDM contracts and satisfies properties on observable wires—rather than checking implementation code against the model. Alignment between code and model rests on runtime observations supplied by the user: when runtime behavior diverges from the model, the divergence is fed back to `ssot-judge` as a new observation to determine whether the model omitted a case or the implementation violated the model.

---

## 4. Contamination Firewalls and Composable Skill Boxes

When large language models participate in formal design, the primary failure mode is not syntax error but **context contamination**. Once a model's context window ingests legacy design docs or production code, it inevitably copies database column names, validation steps, and retry parameters from old docs—or temporary workarounds, locking schemes, and historical bugs from existing code—straight into the specification, reducing the single source of truth to a paraphrase of implementation details.

SSoT enforces three information firewalls across its agent workflow:

1. **Delegated reading of legacy docs (`ssot:reader`)**: During migration, the main session is forbidden from reading legacy documents directly. Isolated `ssot:reader` subagents read legacy material section by section and emit only a domain-concept memo stripped of mechanisms and data formats (`concepts.md`) together with verbatim requirement extracts (`requirements.md`), trading controlled information loss for an uncontaminated design source.
2. **Implementation code isolation**: Every modeling and review step reads only the `design/` directory, verbatim user requirements, and runtime observations—never production code, tests, or configuration files—severing the path by which buggy implementations reverse-contaminate specifications.
3. **Context-free blind review (`ssot:reviewer`)**: After each slice is written, a fresh `ssot:reviewer` subagent runs the corresponding `ssot-verify-*` skill without access to the author's reasoning trace or drafts, inspecting the diagrams exported by `ssot render` (C4 views, VDM box diagrams, Quint composition diagrams) alongside scoped diagnostics to deliver an independent verdict.

Because different project stages require only subsets of the toolkit, SSoT decomposes the workflow into **core judgment criteria + carrier rules + independent operation boxes**. Every judgment and operation skill declares a strict six-part interface at its header (**Input, Readable, Writable, Runnable, Output, Escalation**) and validates write boundaries before delivery via `ssot check <design> --scope <view> --base <start-rev>`. Any edit outside the slice's writable scope is reverted; any upstream structural gap or missing contract port discovered during lower-layer modeling is never patched in place, but **escalated** as a concrete fact back to the upstream slice.

This orthogonal box architecture lets SSoT serve not only for progressive greenfield modeling and legacy document migration, but also as an **isolated laboratory for intractable bugs in existing systems**. When a production module repeatedly suffers concurrency desynchronization or state corruption, engineers do not need to read or accommodate the legacy codebase: they can extract just that local boundary and hazard into SSoT, work out the invariants and feedback wiring in the model, and rewrite or refactor the module against the verified structure. Whether the rewritten module honors the model is again decided by runtime observations—any recurring failure returns to `ssot-judge` as a new observation.

---

## 5. One-Way Verification Chain and Repository Overview

### Three Carriers and the One-Way Generation Chain

| Layer | Carrier | Files | Question Answered |
|---|---|---|---|
| Structure | LikeC4 | `design/structure/*.c4` | C4 zoom-in architecture views: actors, systems, containers, components, call direction, deployment, and trust boundaries |
| Box | VDM-SL | `design/contract/<element-fqn>.vdmsl` | Leaf elements tagged `#contract`: exported ports, wire types, feedback wire (`state`), and port `pre`/`post`/`inv` constraints |
| Wiring | Quint | `design/behavior/<module>.qnt` | String Diagram wiring around a specific hazard: delay wires, cross-box ordering and convergence, `safety` properties on observable wires, and `witness*` coverage targets |

Lower layers exist only when justified by the three drill-down questions, and are verified strictly one-way against upper layers:

```text
LikeC4 ──gen──▶ .gen/structure.json (element tree, views, #contract leaves and module names)
VDM Box ──gen──▶ .gen/contract.qnt (types, Call variants, state types, initial state)
Quint Wiring ──replay──▶ Every contract call in simulated traces evaluated in VDMJ against unmodified VDM pre / post / inv and frame conditions
```

The requirement list `design/requirements.md` sits outside the three carriers: each entry records the user's verbatim text under `REQ-<id>`. A requirement may be answered directly by the structure diagram, fulfilled by a VDM box or Quint wiring module, or left to implementation code; requirement IDs are attached only above the VDM definitions or Quint declarations that actually fulfill them. See [`skills/ssot/references/example/`](skills/ssot/references/example/README.md) for a complete worked example and [`sources.md`](skills/ssot/references/sources.md) for methodological and academic sources.

### Skill Tree

| Layer | Skill | Role |
|---|---|---|
| Core | [`ssot`](skills/ssot/SKILL.md) | Core charter: three-layer positioning, invisible-by-default rule, depth and precision axes, skill composition protocol, CLI commands, and diagnostic rules |
| Core | [`ssot-judge`](skills/ssot-judge/SKILL.md) | Applies the three drill-down questions to a location or runtime observation to decide whether to stop, write a box, or write wiring, and sets precision |
| Core | [`ssot-requirement`](skills/ssot-requirement/SKILL.md) | Records a verbatim requirement with an ID, writes the domain-property adequacy argument, and performs the drill-down judgment in the same call |
| Carrier | [`ssot-c4`](skills/ssot-c4/SKILL.md), [`ssot-vdm`](skills/ssot-vdm/SKILL.md), [`ssot-quint`](skills/ssot-quint/SKILL.md) | Syntax, idioms, tool-enforced rejections, and review criteria for each of the three carriers |
| Write | [`ssot-write-level`](skills/ssot-write-level/SKILL.md), [`ssot-write-deploy`](skills/ssot-write-deploy/SKILL.md), [`ssot-write-contract`](skills/ssot-write-contract/SKILL.md), [`ssot-write-behavior`](skills/ssot-write-behavior/SKILL.md) | Writes a single structure level, deployment view, VDM box, or Quint wiring slice |
| Verify | [`ssot-verify-structure`](skills/ssot-verify-structure/SKILL.md), [`ssot-verify-contract`](skills/ssot-verify-contract/SKILL.md), [`ssot-verify-behavior`](skills/ssot-verify-behavior/SKILL.md) | Runs blind review on a single slice (executed by [`ssot:reviewer`](skills/ssot/agents/ssot-reviewer.md)) |
| Migrate | [`ssot-migrate-read`](skills/ssot-migrate-read/SKILL.md) | Dispatches [`ssot:reader`](skills/ssot/agents/ssot-reader.md) to read a section of legacy documentation, stripping implementation details and extracting domain concepts and requirements |

### Commands

| Command | Purpose |
|---|---|
| `ssot setup` | Installs verification and rendering dependencies and links `ssot` into `PATH` |
| `ssot gen <design>` | Regenerates `.gen/structure.json` and `.gen/contract.qnt` from structure and contract sources |
| `ssot check <design>` | Full check: compiles all three carriers, verifies `.gen/` freshness, cross-carrier rules, bounded simulation, coverage targets, trace replay, and proof obligations |
| `ssot check <design> --scope <view-id>` | Compiles the full design but runs simulation, trace replay, and QuickCheck only within the slice closure of `<view-id>`, reporting only diagnostics owned by that slice |
| `ssot check <design> --scope <view-id> --base <rev>` | Additionally lists out-of-scope file or element modifications since `<rev>` |
| `ssot render <design> [--out <dir>]` | Exports PNG diagrams from macro to micro: C4 views, box diagrams for each contract module (`box:<module>`), and composition diagrams for each Quint module (`composition:<module>`) |
| `ssot eval <design> <module> '<expr>' [--bind …]` | Evaluates a VDM expression against the unmodified specification to verify that concrete violating instances are rejected |
| `ssot status <design> [--deadline <sec>]` | Reports the first confirmed error in written artifacts or any `#contract` leaf still missing a VDM module; prints `没有前沿` (no frontier) when none remain |

`ssot check` exit codes: `0` pass; `1` confirmed error; `3` no errors but `resource.deadline` was exceeded (verification did not finish within the time budget, which does not reject the design).
