# Managed research execution

Status: implementation in progress. This document is the acceptance ledger for the second stage,
based on `014c6dfc5` and the user's revised product scope. It does not describe a shipped feature.

## Product contract

Codex, an ordinary Open Science Session, and an existing fork use the same Open Science-owned
material preparation and sandbox execution capabilities. Codex is a control client; it does not
extract the research into its own terminal and run it outside Open Science. Creating a fork is
optional. Reproduction is a task for an Agent, not a new Session type, sidebar role or dedicated UI.

The imported source remains read-only. Source research/material identity, receiving Session,
prepared environment and each Notebook Run have separate identities. Reading focus, research
membership and Replay playhead are not execution authority. The caller selects an unambiguous
source; preparation freezes verified input versions independently of subsequent navigation.

An external caller can use an existing writable ordinary Session. If it has none, the application
may create ordinary Session storage without attaching an Agent or requesting another model. Main
owns durable operation admission, execution claims and output publication. Only actual external
requests/results are recorded; these records do not claim to contain the complete Codex chat.

The existing `.science` v1 format, native recipes, ordinary discussion, generic fork and Replay
semantics remain unchanged. The optional description is ordinary Artifact content, never executable
authority. Old packages without it remain readable and usable through explicit material selection.

## Implementation slices

1. Establish ordinary no-model Session creation and main-owned external operation admission.
   Exercise a real Notebook Run, legitimate Artifact publication and package round trip before
   claiming the public execution path works.
2. Discover descriptions in an authoritative, source-scoped Artifact catalog. Reuse immutable
   managed versions and validate actual archive members before restoration into an exclusive
   staging directory. Do not relabel all Project files as one research's materials.
3. Prepare an opaque, Session-bound environment handle with fixed input versions, independent
   Node identity and a durable resource journal. Retain one Notebook execution owner; select the
   bounded policy per invocation while ordinary Shell stays persistent. Stop before cleanup.
4. Expose the same narrow capabilities to internal Notebook/Host tools and authenticated SDK/CLI
   adapters. Preserve existing desktop-only channels; package transfer adapters reuse shared
   import/export ownership, staging, confirmation identity, progress and recovery.
5. Publish a real Tuanzi engineering `.science` fixture and verify all three entry points in clean
   test storage. Run startup checks and a short rule/local offline case with zero experimental
   model calls. Also use a small non-Tuanzi example to catch project-specific coupling.

First native execution target: macOS with an existing compatible independent Node. Missing runtime
and unsupported native-service targets report prerequisites without silently downloading software
or weakening isolation. Broad runtime provisioning, live-model study trials, automatic capture of
the complete external Codex conversation and interactive Tuanzi iframe preview are later work.

The Agent explains the selected execution scope before running and saves its actual parameters,
known omissions, substitutions, adaptations and comparison limits as an ordinary output Artifact.
The application collection receipt establishes material, runtime and Run identity; it does not
infer scientific equivalence. Neither report introduces a required `.science` entry or recipe field.
Runtime discovery returns optional fixed diagnostic codes and guidance without candidate paths or
raw probe errors; finding Node and supporting a native local service are separate facts.

## Acceptance ledger

All entries are pending until an evidence reference is recorded below. Narrow unit tests do not
prove product-wide integration or native behavior.

| Requirement                            | Required evidence                                                                                                                                        |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ordinary Session without another model | Real persisted Session/workspace, normal catalog visibility, no provider initialization, rollback/uncertain-publication preservation                     |
| Real operation and output provenance   | Actual request/result admission, Notebook Run and Artifact in the same legitimate context; export/import preserves ordinary records                      |
| Source selection                       | Explicit/versioned selection, ambiguity diagnostics, source-scoped catalog, no playhead or latest-file guessing                                          |
| Material preparation                   | Hash/length verification, bounded archive enumeration, no traversal/links/special files/collisions, atomic publication, cancelled/failed staging cleanup |
| Managed environment                    | Opaque scope-bound handle, immutable receipt, independent Node identity, separate input/work/output, duplicate-request conflict checks                   |
| Execution                              | Same Notebook owner/admission, per-call bounded policy, persistent Shell unaffected, actual cwd and limits recorded                                      |
| Resource lifecycle                     | Durable creation intent, exact ownership, completion/cancel/timeout/delete/quit/restart, interrupted cleanup retry, no unowned deletion                  |
| Internal tools                         | Ordinary and fork Sessions can inspect/prepare/execute/query/cancel/save without mandatory fork or new UI                                                |
| External controls                      | Authenticated SDK/CLI entry, no raw internal credentials or caller-forged Frame claims, stable progress/reconnect/cancel, no additional model            |
| Package transfer                       | Real external import/export adapter retains existing validation and operation ownership; no arbitrary remote host paths                                  |
| Tuanzi engineering                     | Fixed v0.5.6 material identities, real package import, startup and short offline run, providerCalls=0, actual outputs and verified stop                  |
| Generality                             | A separate small project uses the same material/environment/execution contracts                                                                          |
| Three-entry parity                     | Codex-facing client, ordinary Session and existing fork produce equivalent identity/state semantics in isolated test storage                             |
| Compatibility                          | Old/unknown descriptions, multiple imports, source unchanged, current discussion/fork/Replay/ordinary Notebook regressions                               |
| Publication                            | Final archive inspection, dependency-closure boundary, no private fixture/token/env leaks, new results exported from receiving Session                   |
| Delivery                               | Required ownership/consumer/API/i18n guards, typechecks/lint/test impact, real client checks and independent Test build; baseline repositories preserved |

## Evidence

- Ordinary creation uses the existing managed workspace and Session persistence workflow. The
  caller's `requestId` owns a durable creation receipt, so a lost response does not create another
  Session. No provider is attached. The application publishes its normal `session:created` event.
- The real shared-core and entry-point tests publish actual Notebook Shell output as Artifact
  Versions, then export/import it through `.science` v1 and verify remapped Run/Version references.
  Internal execution borrows the current foreground Artifact turn; external execution acquires a
  root Session operation lease. Neither creates a synthetic producer Run.
- Native macOS checks use an independent Node process, a real Unix socket and the production OS
  sandbox. Normal, cancelled and timed-out executions retain their actual Run state and generated
  files. The tests include a real symlink alias for the data root: physical containment is checked
  before recording the output under the Notebook's original logical path.
- Environment tests preserve replaced resource directories instead of deleting foreign files,
  reject redirected Notebook ancestors, and exercise stop-before-cleanup and ownership recovery.
  Released working/output directories do not remove published immutable Artifact content.
- Host capability/help and the bundled self-awareness guidance explain source selection, the
  current Session, available runtimes, immutable inputs, declared output paths, cancellation and
  the distinction between engineering success and scientific outcomes.
- The first-stage engineering receipt is retained as historical evidence. It does not substitute
  for the real second-stage package or three-entry acceptance.
- The real-material macOS acceptance passed on 2026-10-05 (`acceptance-20261005-06`). The external
  SDK, ordinary current-turn port, and an actual `SessionPackageService.fork` each imported the
  same Tuanzi v0.5.6 source package, ran the bounded offline case, exported its receiving Session,
  reimported the results, and checked output bytes and mapped producer Run identities. Each entry
  passed 24 project-specific engineering checks, recorded one engineering run, zero experimental
  provider calls and zero scientific trials, and verified service termination. Each published 13
  declared files plus the application collection receipt; the fork also retained 17 input Artifacts.
  All three stable engineering-metric fingerprints matched. The actual task reached its bounded
  action/step stop with delivery fraction zero; passing this engineering check makes no claim of
  scientific success or treatment effect.
- The reviewed stage-two description SHA-256 is
  `3121f3197c3c59a3e209ce86257088aee5396eee5a898924ebcf41ceac9e07be`. The original stage-one
  materials remain unchanged. The public capabilities output is an explicitly identified field
  projection, with its omissions recorded; it is not represented as the complete HTTP response.
  Source and all three result archives retain `open-science-session` schema version 1 and the
  existing root entries. Export content validation remains enabled.
- These are real application-core, HTTP and native sandbox checks with model dispatch forbidden.
  They do not prove that an installed provider Agent discovers and invokes the tools correctly;
  that remains a separate client delivery gate.
- The first second-stage full-suite run found 18 failures: 11 wiring, inventory and platform
  registration failures, and seven crash-recovery subprocesses blocked by an eager ESM-only
  dependency import. The complete literal inventories and platform coverage were updated without
  relaxing their guards; the test helper now follows the existing test-support naming convention.
  The service adapter loads only when its managed local-service capability is used. All seven real
  crash-recovery scenarios and the affected native service checks then passed. The corrected
  repository-wide run and installed-client delivery remain separate gates below.

## Real-material acceptance

`src/main/notebook/managed-research-acceptance.macos.integration.test.ts` is an opt-in, project-neutral
harness. Supply a reviewed materials directory and a new evidence output directory:

```sh
OPEN_SCIENCE_MANAGED_RESEARCH_MATERIALS=/absolute/reviewed-materials \
OPEN_SCIENCE_MANAGED_RESEARCH_OUTPUT=/absolute/new-evidence-directory \
npm test -- src/main/notebook/managed-research-acceptance.macos.integration.test.ts
```

The local preparation index and `acceptance.json` are inputs to this engineering harness, not
`.science` protocol entries. The harness verifies the material hashes and publishes selected
material copies through a real copying Run. It exports the source package through the public SDK,
imports it into fresh storage, uses the production material authority and native sandbox, and
executes the same engineering plan through external, ordinary-turn and actual fork entry points.
SDK calls cross the actual authenticated loopback HTTP server and shared external adapter. It
compares declared output checks, reimports the result archives, checks remapped producer Run IDs
and verifies that environment release leaves the immutable outputs readable.

Project-specific drivers, analysis and fixed source snapshots remain outside Open Science core.
They must declare their actual scope and keep private values out of outputs. A failed experiment
can still provide useful complete evidence; neither an exit code nor a successful package import
establishes a scientific conclusion. Package export retains its existing sensitive-content and
dependency-closure checks.

Remaining release gates: final repository-wide required checks, installed-client Agent journeys
and the independent Test build. Focused test results are evidence
for their covered boundaries, not substitutes for these gates.

No upstream publication, formal client replacement, live-model scientific trial or public research
release is included in this implementation authorization.
