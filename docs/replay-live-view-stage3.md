# Replay live viewing — stage three

Status: implementation in progress. This ledger preserves the complete agreed scope; an isolated
module test or a rendered mock-up does not establish delivery.

## Baseline and authorization

- Stage two: `6249da8b48fbbf745876ceabd2587b9d2f31f42b` on
  `codex/managed-research-execution`.
- Stage-three branch: `codex/replay-live-view`; upstream `bd9a61a80a` merged separately as
  `5285af282`. The Session-package test retains both the research-workspace wording and upstream
  mainline tag. The formal checkout remains on its existing main branch.
- Independent Test functional baseline: `0.35.0-test.32191a29038d.2`. Preserve its configuration,
  data, backups and maintenance procedure. Do not replace the formal client or recopy formal data.
- Tuanzi acceptance remains pinned to v0.5.6 (`b6d5810fef3baac1195c980fe728ce7a8a69408b`).
  New evidence belongs in a separate stage-three directory. Experimental provider calls and
  scientific trials remain zero. Existing stage-two evidence is historical and immutable.
- Implement and test locally. No push, upstream PR, formal release or scientific publication is
  part of this task.

## Product contract

One Replay viewer supports live following, inspecting earlier steps of the active execution and
historical playback. The same presentation appears in Open Science's right preview pane and an
ordinary browser pane that Codex can open. Reproduction remains an ordinary Agent task: Codex,
normal Main Sessions and optional existing working copies use the same Open Science-owned runtime.
Opening, refreshing or closing a viewer must not dispatch or repeat execution.

The viewer displays genuine Run state, bounded stdout/stderr, available results, selected evidence
and a general interactive project Web surface. Live observation belongs inside Replay; it is not
a new Session type, sidebar hierarchy or separate experiment dashboard. A live project page is a
required stage-three deliverable in both hosts, not a screenshot substitute or deferred enhancement.

Viewing controls and execution controls are separate. Pausing follow does not pause the experiment;
closing the viewer does not stop it. Explicit cancellation reports the confirmed terminal state.
Historical seeking never presents an interactive current page as a historical frame. Missing capture
is labelled. A finished Run's page cannot silently attach to a new service or keep the process alive.

## Incremental ownership boundaries

1. A read-only observation owner composes existing Notebook, operation and Artifact authorities.
   A trusted admission association identifies the actual operation/environment/invocation/Run while
   it is active. Do not guess the latest Run, parse result prose, expose shell environment snapshots,
   or turn the existing Task event stream into an unfiltered Notebook feed.
2. Replay consumes snapshots and bounded scoped updates through injected readers. Keep immutable
   history checks and existing defaults; separate stable viewer identity from changing revisions.
   The existing content-based playback duration is not elapsed execution time or percent complete.
3. An independent runtime-view owner manages exact service-generation access and HTTP assets,
   interaction requests, SSE and WebSockets. It borrows the existing Run/process lifecycle and
   sandbox. The old host-only GET lease, static HTML preview and literature source preview retain
   their original boundaries.
4. A selected-Run evidence reference freezes the clicked scope, revision/cursor and exact evidence.
   It can be used in the current conversation without creating a Session or self-discussion link.
   Existing cross-research discussion rules remain unchanged. Browser selection does not imply a
   capability to inject a message into Codex: provide selected-evidence retrieval and copyable
   references through the public client, and verify actual host behavior.

Only composition, narrow runtime admission hooks, preview registration and public adapters connect
these modules. Do not put process ownership in the viewer, duplicate the execution engine or add
project-specific branches to generic components. New UI follows all eight locales, ErrorNotice and
the shared action-menu integration.

## Transport, lifecycle and preservation

- Observation snapshots and updates have an epoch, cursor/watermark and exact scope. Handle
  subscribe/snapshot races, duplicate and out-of-order updates, bounded retention, truncation,
  reconnect/resync, source deletion and switching while requests are in flight.
- Browser grants are short-lived, revocable and scoped. Observation, project interaction and
  execution cancellation are distinct permissions. Never pass the full application token to the
  project page or export it. Filtering happens on the server, not only in the viewer.
- Project requests target only a Main-registered, verified service generation, not an arbitrary
  URL, port, socket or PID. Isolate project content from management APIs; remove management
  credentials before upstream forwarding. Constrain paths, methods, redirects, response budgets
  and stream lifetime. Reconnecting must not authorize socket-path replacement.
- Tuanzi requires assets, POST and cursor-based SSE, Host/Origin validation, and an explicit
  scoped embedding adaptation for its `frame-ancestors 'none'` policy. Record the adaptation;
  keep source materials and unrelated policies unchanged. An external-window fallback is not
  equivalent to passing the required embedded interaction acceptance.
- Project access exists only during a real active bounded Run. Preserve existing deadlines,
  shutdown, stop proof, output retention and publication fences. Stop project writes before
  archiving final output. Distinguish page disconnection from execution failure.
- Save available screenshots, project exports and capture coverage as ordinary Artifacts with
  actual producer/source attribution. User interactions that change experimental conditions are
  disclosed. Do not claim complete arbitrary DOM/input recording.
- Keep `.science` v1 and native recipes unchanged. Runtime grants/URLs/ports are local transient
  state. Portable evidence uses ordinary published Artifacts and verified content/native identity
  associations across import remapping. Old packages continue to work without new records.
- Preserve deterministic presentation and explicit missing-frame intervals for future MP4 output;
  a video encoder and arbitrary Web interaction reconstruction are outside this stage.

## Delivery sequence and acceptance ledger

| Gate | Required current-state evidence | Status |
| --- | --- | --- |
| Baseline | Separate branch, upstream merge, unaffected formal/stage-two checkouts and tests | Merge complete; formal and Tuanzi checkouts remain clean; final source commit pending |
| Feasibility | Actual sandboxed generic service and Tuanzi in both browser/Electron hosts; assets, POST and continuous updates | Passed for genuine ready-state Web interaction; engineering run journey remains pending |
| Observation | External, ordinary Main and fork active Runs observable before completion, scope-safe snapshot/delta/resync | Owner, adapters and native runtime tests passed; installed-client journey pending |
| Replay | Follow/inspect/history, stable position and focus, true state, explicit stop and missing content | Renderer and production Chromium checks passed; installed Test/current Codex pending |
| Interactive surface | HTTP/POST/SSE/WS; generation proof, revocation, isolation, bounded lifetime, no arbitrary proxy | Native and browser boundary checks passed; final installed-host parity pending |
| Questions | Current-session selected evidence, frozen cutoff, no accidental new Session; usable Codex reference retrieval | Draft acknowledgement, repeat selection and public retrieval tested; actual host journey pending |
| Archives | Saved captures/results readable after release; actual `.science` export/import preserves bytes and correct identities | Real PNG, SQLite, managed Shell and package round-trip passed after release/cache removal; installed-client journey pending |
| Generality | Tuanzi fixed offline scenario plus unrelated interactive Web fixture, no core project-specific logic | Pending |
| Host parity | Real interactions in independent Test and Codex browser, resizing, refresh, disconnect and recovery | Pending |
| Regressions | Existing Replay/discussion/Notebook/static previews, stage-two publication/recovery, i18n/owners/API/types/lint | Pending |
| Delivery | Independent Test build/installation/startup, complete evidence ledger, source clean with local commits | Pending |

Run targeted tests for changed behavior and the required repository guards; broaden based on
actual impact. Real native/browser acceptance must cover cancellation, timeout, application exit,
old-link revocation, service replacement, reconnect and historical non-interactivity. Skips and
incomplete graph/capture evidence are limitations, not passes. Preserve failed attempts and explain
corrections rather than overwrite evidence.

The stage is complete only when a person can observe an actual execution, operate its project Web
page, select a step and inspect saved evidence from the current Codex conversation, with the same
capabilities in Open Science. APIs returning success or screenshots alone do not satisfy this gate.


## Implementation refinement and current evidence

The current implementation stays on the isolated stage-three worktree. `main` and the installed
Test release remain unchanged. This section records partial evidence, not completion of the ledger.

- Recording is an explicit `recordObservation` execution option, independent of `projectView`.
  The default leaves ordinary executions unchanged. Run observation itself does not require a
  project page, and viewing never dispatches a command.
- Recording coordination and exact publication recovery move into a dedicated Main coordinator.
  Auxiliary inline writes retain normal Artifact provenance and durable write intents; their
  failure is reported separately and must not poison an otherwise successful Run or operation.
- A recorded viewer is bound to the receiving Project/Session/Artifact/Version. It uses the same
  short-lived grant and browser-host boundary but cannot read live state, open project services
  or cancel a Run. Original source IDs remain evidence. Each server-selected step has its own
  selection identity so asking about the same step again remains an explicit new action.
- Recorded media resolution uses verified bytes and receiving Session authority, including
  historical published Versions. Retained import mappings are optional disambiguation hints;
  repeated export/import must work by content identity without treating original IDs as local IDs.
- The live owner/HTTP host/public adapter tests passed 31 checks before the extra recorded public
  adapter case; the subsequently expanded host/adapter/renderer-inventory set passed 36 checks.
  The SDK/CLI/type-contract/inventory set passed 30 checks. These are targeted checks, not the
  complete regression suite or installed-client acceptance.
- The strict Main archive reader passed eight real SQLite/filesystem checks including actual
  `.science` export/import into separate storage with remapped IDs and preserved bytes. Later
  historical-Version and repeated-import coverage is still being added.
- Real Tuanzi Web feasibility evidence is retained at
  `/Users/jszhang/github/projects/tuanzi-gs-research/tuanzi-v056-replay-live-stage3/2026-10-05T18-52-30.790Z`.
  Both Chromium and Electron loaded the production viewer and actual sandboxed Tuanzi source,
  created offline ready state and read continuous updates. Owned services stopped and old links
  became unavailable. No scientific trial, provider call or engineering experiment was started.
  This does not establish the actual Codex/Test import-to-view journey.

Still required: final auxiliary-publication integration, bounded segmented long-run retention,
actual available-media capture/intake, complete desktop/browser entry and repeated-step questions,
production package/build ownership registration, native execution and package round-trip acceptance,
installed Test and current Codex interaction, regression/type/lint/i18n gates, and local commits.
Historical gaps must remain explicit throughout. No upstream push or formal-client replacement.

## Integration checks, 2026-10-06

The preceding list was the earlier checkpoint. Auxiliary publication, segmented retention,
media capture/intake, entry wiring and source ownership registration are now implemented. Their
tests do not replace the outstanding installed-host acceptance.

- Auxiliary images use a Main-only, canonical Base64 input decoded into ordinary Artifact bytes.
  The collector binds a real Run, operation, invocation and environment generation. It accepts
  either a verified foreground Electron project frame or a declared project image export; public
  callers cannot choose a path, port, frame or historical step. Read and write permissions remain
  separate. A pure command-line run without `projectView` records execution evidence but does not
  currently register an image-export capture capability.
- The private durable recorder segments long histories instead of retaining only the live ring
  tail. Capacity stops and missing frame intervals are explicit. Per-image, per-run and overall
  budgets remain bounded, and ending or cancelling a Run drains capture before archive freeze.
- `capture-package.integration.test.ts` executed a real managed Shell and stored an actual PNG
  through the collector, auxiliary Artifact writer, recorder and SQLite authorities. After runtime
  release and deletion of local observation caches, actual `.science` export/import preserved PNG
  bytes/checksum, capture timing, step association and correct receiver identities. Auxiliary
  screenshots do not impersonate the original Run's produced outputs.
- `recordingStatus` exposes a saved archive only after its exact immutable Version is verified as
  finalized and published. Its response preserves the validated caller selector, while private
  recorder lookup uses the canonical admission identity. Notebook Run and browser selectors are
  covered for operation-only, invocation-only, Run-only and full identities.
- An exact, newly-created capture callback associates a frame with a viewer observation. Retrying
  an earlier capture from another viewer cannot manufacture a new association from timestamps.
  Confirmed pre-write capture failures can retry with the same key and release unused image budget;
  uncertain results after a write started retain their idempotency claim.
- Public `observations.captures` and `captureContent` allow an agent to retrieve current image
  metadata and bytes in at most 1 MiB chunks, with caller validation before and after the read.
  The SDK example verifies the complete image checksum. Selected steps still freeze the real
  observation; no automatic Codex message injection or screenshot attachment is claimed.
- Electron capture geometry passed a real 125% zoom/Retina calibration and occlusion checks. This
  is **not** a production foreground screenshot pass: the Mac is locked. Real foreground capture
  must report `productionForegroundVerified: true` after manual unlock.
- The production desktop/viewer build and Node/Sandbox/Web type checks passed. CI ownership
  accounted for all 6434 files and its seven guards passed 150 checks; the later ownership and
  consumer recheck passed another 51 checks. The independent Test installation remains stage two.
- The complete repository sweep passed 2620 suites and 50840 checks, exposing 14 failing suites.
  The wrong interpreter-directory value used for `OPEN_SCIENCE_TEST_PY_ENV` caused 78 of its 111
  failures; rerunning with the actual Python executable passed all 155 enabled checks in those
  two suites. The other failures identified explicit consumer/build/preload inventories and a
  real startup defect: observation IPC contracts had incorrectly opted into the separate unified
  command router. These contracts now stay on their original lease-checked independent IPC owner.
  Inventory, composition, adapter, and architecture reruns passed. The consolidated rerun of all
  14 originally failing suites passed 669 checks with 36 platform/opt-in skips and no errors.
  These are rerun results, not a claim that the initial sweep was wholly green.
- A fresh Tuanzi materials-only package is prepared at
  `/Users/jszhang/github/projects/tuanzi-gs-research/tuanzi-v056-replay-live-stage3/materials-package-20261005T202924Z/research.science`,
  SHA-256 `34d404be0924f933586c00f928724f57920fc5ce4993438f23564ba289447328`.
  The dedicated publication-only fixture records a real copying command, with zero engineering
  runs and zero scientific trials. The derived driver preserves all 427 source files, checker and
  offline parameters; it adds disclosed bounded viewing windows and uses Main's generation-proving
  service adapter. The actual installed-client acceptance helper is prepared but has not run.

Remaining delivery gates are exact-commit Test package/installation,
the current Codex and Test import/run/view/question/capture/export/reimport journey using an actual
bounded offline Tuanzi engineering run, production foreground capture after unlock, and a clean
locally committed delivery checkout. Preserve existing evidence, Test data and the formal app.

## First installed acceptance, 2026-10-06

The independent Test client was built and installed from
`c93b4a48813ecc3cd7f935e966189e34a8e80911` as `0.35.0-test.c93b4a48813e.2`.
Its application checksum and packaged viewer resources were verified; the existing Test state
was backed up before installation. The formal application and its data were not changed.

The strict Electron foreground fixture now passes with `productionForegroundVerified: true`.
It verifies actual 125% zoom/Retina pixels and rejects obscured or hidden frames. Its fixture
waits for the renderer to paint after removing the test overlay; the production constraints and
pixel assertions are unchanged. This fixture is not a Tuanzi screenshot or experiment artifact.

Actual installed attempt `20261006-live-01` imported the prepared source package into a fresh
project and normal Session #65, then ran one bounded offline engineering case. Current Codex
displayed the real Tuanzi interface before and after its four actions with zero external requests.
Selecting/copying a frozen observation, returning to live, and explicit missing historical images
were verified through the actual browser UI. The Run completed, but full acceptance did not:

- The Test Notebook hid its Observe button because it depended on private `submissionIdentity`,
  which the real public Run projection removes. The narrow correction uses the existing public
  managed `executionInvocationId`; Main still authorizes the exact Run. Regression coverage now
  crosses the real public DTO and full Notebook renderer instead of relying on private fixtures.
- Persistence classified the provider-free Codex operation as a restarted Session while its Main
  operation lease was still active. The correction makes that exact project/session lease visible
  to persistence without inventing a provider session or weakening real crash recovery.
- The ordinary Artifact publisher finalized the Replay file, but its observation coordinator had
  attempted finalized-Version verification before the turn was published. It retained an original
  write attempt without a save reference and reported `saving` after the file existed. The
  correction retains the exact Main save receipt and reconciles already published original writes
  without executing the experiment or initiating another Artifact write.

The helper stopped at the archive status assertion before result export/import. Its existing
Run, output Versions, retained environment and evidence directory remain available:
`/Users/jszhang/github/projects/tuanzi-gs-research/tuanzi-v056-replay-live-stage3/installed-20261006-live-01`.
No actual Tuanzi product screenshot was captured. The acceptance helper now distinguishes genuine
image captures from ordinary output-file references in archive media; the latter do not satisfy
the screenshot requirement. A separate recovery-only helper will verify the existing result after
the fixed Test upgrade. Final delivery still requires an explicitly identified acceptance attempt
that passes the real Test capture/draft flow and the recorded package round trip.

The narrow fixes passed 84 Notebook/public-projection/action tests, 236 operation-liveness tests,
64 observation/service tests, 32 publication/contract checks and 74 consumer/architecture checks.
The real publication tests cover both an ordinary pending save receipt and a lost response followed
by service/recorder restart. Status reconciliation recovers the same published Version without
calling the mutable write-replay path or increasing the Artifact count. Relevant Node/Sandbox/Web
type checks and changed-file lint passed; no new renderer strings or package-format changes were
introduced by these corrections.
