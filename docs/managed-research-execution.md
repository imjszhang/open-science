# Managed research execution

Status: implemented locally and delivered to the independent Test client. This document records
the second stage, based on `014c6dfc5` and the user's revised product scope. The installed functional
revision is `32191a29038d`; later changes cover test reliability and this ledger. This is not an
upstream or public release. See the final delivery evidence and its validation limits below.

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

The evidence below records completed checks and their limits. Narrow unit tests do not prove
product-wide integration or native behavior; earlier failed attempts remain historical evidence.

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
- The next complete run reported 50,285 passing tests, 847 skips and one failure in the existing
  package-installer process-tree stop confirmation. The entire affected file then passed 108 tests
  with two skips, including real parent/child exit checks. That combination is not a fully green
  full-suite invocation; final validation must still exercise the complete current source.
- An installed-client SDK attempt exposed a new-Project import publication failure that the
  core harness's existing-Project imports did not cover. The package had committed its records,
  but the ordinary Session repository correctly hid it behind the pending-import visibility
  fence when the live coordinator tried to adopt it. Publication now verifies the native commit
  witness and retained receipt, then uses a short-lived Main-only capability bound to the exact
  Project, Session and import identity. Ordinary readers remain fenced. Five real persistence
  regressions cover new/existing Projects, callback failure and recovery, missing witness and
  mismatched receipt; the related nine-file suite passed 487 tests. The installed-client retry
  and recovery check are still separate requirements.
- A second reviewed fixture uses a small synthetic CSV and a Node arithmetic script, without
  Tuanzi code, a local HTTP service or an archive. The same real-material harness passed all three
  entry points, including result export/reimport and producer-identity checks. Each execution
  produced count 4, sum 20 and mean 5 with no model calls. A withheld synthetic input slot is
  included for a separate negative admission check; the successful arithmetic run does not prove
  that the withheld-input plan is executable or that any scientific finding was reproduced.
- Diagnosed unavailable materials now return HTTP 409 with fixed guidance distinguishing missing,
  withheld, external and metadata-mismatched inputs. The same domain error reaches internal tools.
  Arbitrary I/O errors and failures of actual byte-length/hash verification remain internal errors;
  the external adapter never forwards raw exception text or private paths as guidance. Real
  preparation-to-HTTP/SDK tests cover these boundaries. Installed-client verification is pending.
- The complete publication-fix run reported 50,290 passing tests, 847 skips and one failure in the
  unchanged Shell output-capacity test (`exitCode` was null instead of 7). Its entire file then
  passed 71 tests; the failing case took 35 ms. The original log does not distinguish timeout,
  signal or incomplete process-tree confirmation, so its cause is not claimed. The prior
  package-installer stop-confirmation case passed in this run. Final verification will use the
  repository's supported worker cap without changing test coverage, assertions or timeouts.
- The complete current-source run at `947173326` subsequently passed 50,306 tests, with 847
  skips (2,589 passing files and 59 skipped files). It used the supported four-worker setting and
  unchanged assertions and timeouts. This is evidence for that source revision, before the
  storage-alias and later recovery changes; skipped cases are not claimed as verified.
- The installed external SDK acceptance (`installed-acceptance-20261005-restart-01`) completed
  a fresh new-Project Tuanzi import, one bounded offline execution, publication of fourteen
  declared outputs plus the collection receipt, result export and reimport, and environment
  release. An independent read-only provenance audit verified source material identities,
  output bytes and mapped producer Runs. The earlier interrupted publication also recovered
  using its original Project and Session identities without creating a second source.
- A real installed Main Agent then discovered the tools in an ordinary Session and executed
  the offline driver, but output collection failed: the foreground Agent's Artifact storage
  Session is a legitimate alias, while the new turn adapter incorrectly required it to equal
  the application Session. Only a scope/failure report was published. This is a failed product
  acceptance, even though the driver reported its engineering assertions passed. Releasing
  that environment also exposed the need to retain uncollected output and retry collection
  without rerunning the experiment. Synthetic current-turn tests had used identical storage
  and application Session identities and therefore missed this integration boundary.
- The storage alias now travels explicitly from the Main-owned Artifact turn through Local RPC
  and the managed output writer. Public payloads cannot choose it, missing bindings are rejected,
  and mismatched aliases still fail the original ownership checks. A real Owner/HTTP/Artifact
  persistence regression verifies this boundary with a stubbed business execution; it is not
  evidence of a completed installed Agent journey. The readonly-source copy now also explains
  that ordinary conversations can use the materials and presents a working copy as optional.
- A separate `managed-tabular-downstream-v2` fixture passed the three-entry native harness with
  the explicit scope `downstream-only` (`acceptance-20261005-01`). Only public group summaries
  are shared; the original-input plan requires withheld rows. The actual downstream calculation
  produces group means 5 and 7 and difference 2 while reporting that the raw data, original
  aggregation and original conclusion are unverified. All declared outputs and producer identity
  round trips passed. This is arithmetic on synthetic CC0 materials, not evidence of an effect
  or proof that a real Agent can explain the compromise without further client validation.
- Test `0.35.0-test.50e8875ca682.2` completed the installed downstream-only SDK acceptance
  (`installed-acceptance-20261005-downstream-02`): unavailable original rows returned the typed
  refusal without creating a Run; the public analysis produced four byte-verified outputs and
  passed 25 assertions. A read-only audit checked the actual local Run/Version remapping after
  export and reimport. Both sets of immutable outputs remained readable after release. The first
  attempt stopped before execution because the verifier compared export timestamps as research
  content. Its failed evidence was retained; only the manifest creation time and root RO-Crate
  Dataset publication time are normalized in the corrected comparison.
- The installed generic SDK acceptance (`installed-acceptance-20261005-test-01`) also passed:
  arithmetic, explicit cancellation and actual process timeout, three terminal Notebook Runs,
  output export/reimport, source preservation and readable results after release. These are
  synthetic examples without experimental provider calls, not scientific conclusions.
- In a fresh ordinary Test Session, the Agent discovered the Tuanzi materials and performed one
  offline engineering run. The storage-alias fix saved thirteen declared files and the collection
  receipt. An immediate `host.artifactPath` read failed because the ordinary Project catalog only
  exposes finalized Versions. After that turn ended, the same fourteen Versions were verified,
  a correction report was saved and the environment was released without another engineering run.
  The current source now reuses the existing trusted producer-input scope for exact current-turn
  Version readback. Project listings remain restricted to published results. This readback change
  was subsequently verified in the installed ordinary and fork journeys recorded below.

## Retained output collection

An execution records a collection identity before dispatch. Once the Notebook owner proves that
the process has stopped, Main freezes declared output paths, observed bytes and any captured file
generations, and writes a durable publication intent before each Artifact save. Failed collection
leaves the environment's outputs available; another execution cannot overwrite them. Ordinary
release stops resources but retains these pending outputs. Saving all files leaves the collection
`awaiting-publication` until every exact output Version, including the collection receipt, is finalized
and visible. The existing Artifact publication notification and startup/query reconciliation verify
this authority before acknowledging collection. A release requested before publication is durable
and finishes automatically after acknowledgment. Explicit `discardOutputs` records the decision to
abandon retained outputs before allowing removal.

`getEnvironment` exposes `pendingCollection`. Codex can submit `collectOutputs` as a new ordinary
Session operation, or an Open Science Agent can call it in its current turn. This operation never
dispatches the original command. It retains the original producer Run and requires the actual
current branch and message ancestry. A saved and published Version is reused through its exact
write intent; it is not reassigned to the new turn. An old pending Version must finish its original
owner's publication before it can count as recovered. In particular, a crash before the original
finalization marker exists does not automatically manufacture publication authority: the retained
collection reports that its original turn must finish or recover. A native `.science` snapshot can
preserve pending records as unfinished evidence; that does not make them published results.
Missing captured generation evidence permits
the original ordinary save but blocks later automatic recovery instead of inventing evidence.

New saves constrain the bytes before the database write. Publication failure, byte changes,
ambiguous ownership or revoked authority keep the outputs retained. Collection receipts are ordinary
Artifacts and state whether collection occurred without execution. None of these local journals or
capabilities changes `.science` v1 or makes the optional research description executable authority.

Targeted source tests cover real process/Notebook/SQLite collection across turns, uncertain save
acknowledgements, exact Version reuse, cancellation, native macOS containment, missing evidence,
cross-branch refusal and immutable output readability after release. The installed journeys and
repository validation below complement these source tests; neither substitutes for the other.

## Real-material acceptance

`src/main/notebook/managed-research-acceptance.macos.integration.test.ts` is an opt-in, project-neutral
harness. Supply a reviewed materials directory and a new evidence output directory:

```sh
OPEN_SCIENCE_MANAGED_RESEARCH_MATERIALS=/absolute/reviewed-materials \
OPEN_SCIENCE_MANAGED_RESEARCH_OUTPUT=/absolute/new-evidence-directory \
npm test -- src/main/notebook/managed-research-acceptance.macos.integration.test.ts
```

The local preparation index and `acceptance.json` are inputs to this execution harness, not
`.science` protocol entries. The harness verifies the material hashes and publishes selected
material copies through a real copying Run. It exports the source package through the public SDK,
imports it into fresh storage, uses the production material authority and native sandbox, and
executes the same engineering plan through external, ordinary-turn and actual fork entry points.
SDK calls cross the actual authenticated loopback HTTP server and shared external adapter. It
compares declared output checks, reimports the result archives, checks remapped producer Run IDs
and verifies that environment release leaves the immutable outputs readable.

An acceptance configuration can declare `planScope` to check the selected description's actual
scope (`end-to-end`, `downstream-only`, `alternative-conditions`, or `engineering-check`). Historical
fixtures without this field keep their engineering-only expectation. The harness must not relabel
a downstream analysis as an engineering plan merely to pass admission. This expectation remains
local test configuration and does not add a `.science` field.

Project-specific drivers, analysis and fixed source snapshots remain outside Open Science core.
They must declare their actual scope and keep private values out of outputs. A failed experiment
can still provide useful complete evidence; neither an exit code nor a successful package import
establishes a scientific conclusion. Package export retains its existing sensitive-content and
dependency-closure checks.

## Final local delivery evidence

The independent Test client is `0.35.0-test.32191a29038d.2`, built from
`32191a29038dca7fecebfa8b4f93ed2a8963bcb4`. The installed archive SHA-256 is
`205e08ddd35b33000cccfc19f9ee563c80cfd3f03e91a3ea9db2253058f83e61`; its actual bytes match the
maintenance manifest. Build, signing, startup, type and lint checks passed. Test configuration,
data and updater settings remain independent of the formal client. The main checkout and pinned
Tuanzi source checkout remain clean. Only local feature-branch commits were created.

Installed acceptance records, dated 2026-10-05 UTC, are versioned separately:

| Entry                        | Test functional revision | Evidence directory                                      | Observed result                                                                                                  |
| ---------------------------- | ------------------------ | ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| External Tuanzi SDK          | `50e8875ca682`           | `installed-acceptance-20261005-restart-01`              | Native import, one offline execution, output publication, export/import, producer mapping and release            |
| Ordinary Main Agent          | `154f65b3281d`           | `installed-acceptance-20261005-publication-ordinary-01` | One offline execution, exact current-turn reads, publication-aware release, 16 output/report Versions preserved  |
| Working-copy Main Agent      | `32191a29038d`           | `installed-acceptance-20261005-publication-fork-02`     | One offline execution, exact current-turn reads, publication-aware release, 34 historical/new Versions preserved |
| Generic external SDK         | `154f65b3281d`           | `installed-acceptance-20261005-publication-01`          | Arithmetic, unavailable-input refusal, cancellation, timeout, package round trip and release                     |
| Downstream-only external SDK | `50e8875ca682`           | `installed-acceptance-20261005-downstream-02`           | Explicit withheld-input refusal and a separate public-summary calculation with truthful scope                    |

The ordinary journey passed ten pre-export checks and twenty round-trip checks. Thirteen generated
outputs plus the application receipt were readable by exact Version in the producing turn while
still pending. All sixteen published output/report contents survived native export/import; the
thirteen generated files retained their remapped producer Run. Its source Session comparison began
during the active turn, rather than before the prompt; the original package checksum was unchanged.

The earlier installed fork attempt on `154f65b3281d` remains a failed, zero-execution attempt in
`installed-acceptance-20261005-publication-fork-01`. A control capability first issued after turn
activation retained the Notebook aggregate's placeholder root instead of the restored fork's active
root. The correction binds only that default Main capability to the matching active turn; explicit
foreign, delegated and retired contexts remain rejected. Real runtime/HTTP and current-turn Artifact
regressions passed after reproducing the failure before the fix.

The subsequent installed fork journey used its own seventeen copied materials, performed exactly
one new engineering Run and passed all twenty-four project checks. It read thirteen generated
outputs and the collection receipt in the same turn, then saved a scope report. Observation captured
the retained collection with `releaseRequested` before publication, followed by automatic release
only after all exact Versions were published. Six execution/publication audit checks, nineteen
output-provenance round-trip checks and thirty-eight history/source checks passed. All thirty-four
Artifact contents matched: seventeen copied materials, two preserved prior-failure reports and
fifteen new outputs/reports. Historical material-staging Runs were not counted as new experiments.

The fork export's HTTP observation timed out after thirty seconds. The original operation later
produced the complete archive; no second export was submitted. Native v1 inventory validation
checked all 565 entries before one new-Project import, which completed with `cleanupPending=false`.
The lost export response means its response-time cleanup field is unknown. SDK readback and local
native Notebook/database audits independently verified output bytes and remapped producer identities.
The native Run reports an observer conflict, so this proves the exact output associations, not
completeness of the entire file-observation graph. The initial audit incorrectly treated a parent
REPL's observation of the same generation as another producer; that failed audit and its correction
remain recorded. Actual `createdByRunId` and Artifact producer evidence identify the real command.

The generic SDK ledger SHA-256 is
`b1578ad1021cd0efc15c964802d2021bab002f8feda8bcf3a76443e1cf417ea6`. It verified arithmetic
count 4, sum 20 and mean 5, three genuine terminal Runs and preserved bytes/producers after package
transfer and release. A failed preparation returned the expected refusal without a Notebook Run;
the public SDK cannot separately enumerate a hidden environment from that failed request. The
earlier downstream-only case verified four outputs and twenty-five assertions, with public group
means 5 and 7 and difference 2. It does not verify the withheld rows or original research conclusion.
Prior-revision evidence is not represented as a fresh run on the final Test revision.

## Final repository validation

The complete functional-source run at `32191a29038d` reported 50,528 passing tests, 855 skips and
two failures (2,594 passing files, 60 skipped files and one failed file). Both failures were in the
existing network-enforcement integration fixture. A standalone run reproduced them. Process/DNS
tracing showed `example.com` resolving and completing while the system `example.org` lookup did
not return before the unchanged fifteen-second timeout. The following raw-socket test then failed
at initialization because the previous test had not released its owner; it did not attempt a socket.

The test's parent proxy provides both HTTP responses, so public DNS availability is irrelevant to
its command-ownership assertion. A causal control with only these two lookups fixed passed the
unchanged file. Test-only commit `fc33bd87f` pins those exact names and restores the resolver in
`finally`; other names still use the real resolver. Real curl processes, OS isolation, concurrency,
ownership assertions and timeouts remain unchanged. The final uninstrumented whole-file run passed
eight tests with one platform skip; sandbox types, lint, formatting and diff checks also passed.
No production change or client rebuild was needed. The full suite was not rerun after this isolated
fixture correction: this is full-run evidence plus a passing, causally justified focused correction,
not a claim that one complete invocation was entirely green. Skipped cases remain unverified.

## Remaining scope and usability limits

This stage supports native macOS with an existing independent Node 22 or newer. It does not install
arbitrary runtimes or dependencies, establish Windows/Linux parity, capture the full Codex chat,
or implement project-specific live previews. Cross-device execution remains deferred. All Tuanzi
acceptance here is bounded offline engineering with zero experimental provider calls and zero
scientific trials; the disabled 3-versus-6 study has not run.

The shared Host help can state method-specific required fields more clearly: the installed Agent
initially omitted `sourceSessionId`, received a schema error, then selected the explicit source and
continued. Source selection remains required; current reading focus is never an implicit authority.
This is a help-copy follow-up, not permission to guess a source or relax admission.

No upstream publication, formal client replacement, live-model scientific trial or public research
release is included in this implementation authorization.
