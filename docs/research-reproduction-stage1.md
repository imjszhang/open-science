# Research reproduction: stage 1

This is the historical first-stage completion record. For the current shared execution capability
and its delivery evidence, see [Managed research execution](./managed-research-execution.md).

This stage establishes portable research materials and verifies bounded Node services in the
existing managed execution system. It does not introduce a new `.science` version, scientific
object model, automatic execution on import, public execution API, or research navigation UI.

Baseline: Open Science `e6965b9a17916afdba32d8cd89fdb5b0c7818e73`; example project
`https://github.com/imjszhang/tuanzi-gs` at
`b6d5810fef3baac1195c980fe728ce7a8a69408b` (v0.5.6).

## Intended result

An author can prepare a fixed, reviewed source snapshot and optional reproduction description as
ordinary research materials. The existing `.science` exporter and importer can carry those bytes
without a format change. A trusted engineering harness can restore the pinned example and prove
that an independent Node service runs within the existing Notebook execution and cleanup boundary.
This is the foundation for a later recipient workflow, not a released one-click reproduction UI.

The original research remains read-only. A recipient operation belongs to a writable Session
distinct from that source, with its own Run identity. This can be an existing ordinary Session or
an optional fork; a new Session is needed only if no suitable receiving Session exists. Replay
continues to display recorded history; successful replay is not evidence of a new execution.

## Acceptance ledger

The final evidence section distinguishes portable tests, native macOS checks and the optional local
tuanzi check. A stage-one result cannot substantiate an unexecuted scientific experiment.

| Requirement                    | Evidence required                                                                                                                                                                          |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fixed, independent materials   | Git-object snapshot, per-file paths/sizes/modes/SHA-256, source/archive identity, licenses; no source checkout secrets or transient output                                                 |
| Research preparation           | Explicitly unexecuted 3-versus-6 protocol, public parameter templates, environment/build instructions, driver and analysis contracts, disclosure scope                                     |
| Optional description           | Bounded pure parser, independent description version, material and relative-path validation, unsupported-version behavior, no implicit execution                                           |
| Portable material identity     | Current-research-scoped content lookup that survives native ID remapping, diagnoses missing/mismatched/withheld/external material                                                          |
| Existing package compatibility | Real v1 export/import round trips for ordinary artifact bytes and existing packages; no new root entry or required feature                                                                 |
| Publication boundary           | Synthetic positive, private-upstream negative, and clean-public-copy fixtures across records, conversation, Notebook and payloads                                                          |
| Explicit runtime               | Independent Node >=22 selected and recorded; no implicit Electron substitution, dependency installation or runtime download                                                                |
| Default isolation              | Optional main-owned capability; original policies unchanged without it; unsupported platforms fail closed                                                                                  |
| Real OS service isolation      | Exact Unix socket binding/access, source read-only, output writable, unrelated paths, TCP listeners and direct network destinations denied; existing Notebook gateway permissions retained |
| Endpoint lifetime              | Run-bound identity, relative routes only, revocation, conflicts and socket-path reuse covered                                                                                              |
| Real Notebook ownership        | Normal project/session/run identities, bounded lifetime, durable run history and owned process supervision                                                                                 |
| Termination                    | Normal completion, cancellation, timeout, Session shutdown, application/update shutdown and cold recovery preserve stop-before-cleanup ordering                                            |
| Tuanzi startup                 | Restored snapshot, minimal environment, status/capabilities only, zero provider calls, redacted receipt, all owned processes stopped                                                       |
| Regression                     | Targeted runtime/package tests, ownership/consumer registration, architecture guards, typechecks and formatting                                                                            |

## Execution boundaries

The generic test fixture and tuanzi startup check use isolated test directories and no model
credentials. Tuanzi reads `.env` beside its server script, so changing only the working directory
does not provide isolation: only the pinned, reviewed snapshot may be launched. Its status response
contains a local control token; only explicitly allowed status fields may enter receipts.

The first service route is native macOS with a main-owned, exact Unix socket capability. Real OS
tests found that a Seatbelt `localhost` TCP listen rule also permits wildcard binding on that port.
Consequently stage one adds no TCP listener permission. HTTP runs over the private socket while the
original Notebook gateway exception remains unchanged. Other platforms fail closed when asked for
this capability; their ordinary execution behavior is unchanged.

The capability matches an existing Notebook Run ID, an owner-writable private directory and the
exact `service.sock` path. A ready service keeps its owning execution active. Existing Notebook/Shell
ownership, cancellation and recovery remain authoritative. Failure to establish termination or
endpoint identity is a failure of admission/cleanup, not permission to relax the sandbox or delete
uncertain resources.

The real cold-recovery test kills a separate owner process after its identity receipt is durable,
then starts a new runtime against the same isolated data root. It verifies stopped descendants,
revoked socket access, terminal Notebook history and a second idempotent restart. This does not
weaken existing recovery fences: an interrupted identity write or a leaderless POSIX group can
remain blocked when immutable ownership cannot be established.

The opt-in `bounded` Shell adapter uses the existing one-shot process owner and receipts and waits
for the whole owned tree to stop before completing. The default remains the existing persistent
Shell interpreter. Scope shutdown must also await bounded commands still preparing, running, or
retaining a failed cleanup, and preserve the existing cleanup retry capability.

`LocalServiceLease` is a host-only GET capability tested against a synthetic service. A proof from
the private startup channel establishes one server generation; requests use one connection and
cannot reconnect after cancellation, connection loss or path reuse. Tuanzi does not implement that
proof endpoint. Its stage-one probe runs inside the bounded driver and is not evidence that the
generic lease already supports a browser preview or Tuanzi's interactive control APIs.

The Node preload adapter changes only the declared HTTP `listen` transport; the source snapshot is
unchanged. It supports one explicit loopback/logical-port listen shape and fails on unsupported
forms. It is not a security boundary: the OS profile enforces socket and network restrictions.
The adapter hash and the independent Node version/hash enter the local startup receipt.

Tuanzi's existing response policy forbids iframe embedding. A successful HTTP probe is not evidence
that the future preview UI works. No embedding policy is changed in this stage.

The materials description is an ordinary artifact payload. Imported local IDs, paths, process IDs,
ports and credentials are not portable material identities. Declared plans are not execution
permission or sealed reproducibility recipes.

## Work organization

1. **Freeze materials and the scientific question.** Read only fixed Git objects, produce a
   deterministic source archive and per-file manifest, and keep the original checkout untouched.
   Prepare a visibly disabled study protocol, public parameter templates, build/environment notes,
   driver/analysis contracts and disclosure boundaries in the separate research directory.
2. **Define an optional description.** Add a bounded, pure parser and research-scoped content
   resolver. Validate paths and archive inventories without unpacking or executing them. Unknown
   versions remain ordinary importable Artifact content. Match included materials by checksum and
   size, not the author's local IDs or paths.
3. **Verify ordinary package transport.** Exercise the real `.science` v1 exporter/importer with
   finalized artifacts, messages, Notebook runs and dependency edges. Verify changed import IDs,
   repeat export/import, absent or unsupported descriptions and unchanged ordinary payload bytes.
4. **Prove service containment.** Add only a trusted optional Unix socket grant and bounded Shell
   lifetime. Check default-deny behavior, foreign-platform rejection, independent Node selection,
   source/output boundaries, ownership, cancellation, timeout, scoped shutdown and cold recovery
   with real macOS processes. Synthetic probes precede the pinned tuanzi startup.
5. **Run engineering acceptance.** Start the restored tuanzi snapshot without credentials; request
   status, capabilities and the Lab page, archive only permitted receipt fields, then verify every
   owned child stopped. Do not start a Lab experiment or provider request.
6. **Review the final change.** Register added files and actual consumers without weakening CI
   routing. Run affected behavior/architecture checks, process typechecks, lint and the repository's
   required fallback. Record native-platform evidence separately from portable CI evidence.

These changes can be reviewed in three dependent slices: materials/description, isolated-service
foundation, and package/runtime acceptance. The latter must land with the foundations before any
user-facing service creation is enabled. No partial slice changes import into an execution command.

The full tuanzi snapshot and eventual scientific outputs live in the separate research directory,
not in Open Science core. The product repository contains generic code, synthetic test fixtures and
the public contracts needed to reproduce the checks. Ordinary Notebook, discussion and replay
behavior remains on existing paths. Actual live-model trials belong to a later stage.

## Tuanzi study prepared for later execution

The proposed question compares `maxRevisions=3` and `maxRevisions=6` under otherwise fixed v0.5.6
conditions and the same request budget. The unit is a complete new run in an exclusive fresh server
process, not an individual model response. Candidate pilot and formal batches are three and twenty
randomized pairs respectively, kept separate. These are draft sample sizes, not a power claim or
authorization for 46 live trials.

The primary endpoint is paired terminal delivery fraction. The protocol must retain failed,
interrupted and missing outcomes, distinguish host/referee termination from inner-engine status,
freeze the analysis before formal outcomes, and report uncertainty and treatment engagement.
A zero or negative treatment effect is scientifically valid. It does not fail product acceptance.

Before a live batch, freeze the model identities, effective parameters, allocation table, money,
time and request budgets, missingness rules and publication scope. A provider request limit is not
a currency limit. The current materials leave these unresolved fields explicit and live templates
disabled. Startup acceptance has zero provider calls and zero experiments.

## Disclosure and compromise modes

The optional description can state original-input rerun, downstream reanalysis, alternative
conditions, or engineering-only checks. These are declarations of scope, not equivalent scientific
outcomes. Missing materials or changed models must remain visible in a later execution report.

`withheld` describes an omission; it does not remove private records, inputs, scripts or messages
from the existing export dependency closure. A public release needs reviewed public copies whose
actual dependency closure is shareable, followed by inspection of the exported package. The
negative fixture intentionally proves that a private upstream remains exported if still referenced.
Do not edit provenance to pretend an upstream was public or claim an automatic redaction feature.

## Explicit later-stage work

- A product owner that discovers descriptions, acquires verified materials and allocates/reclaims
  service directories in managed storage, including crash-safe removal receipts.
- Environment assessment, supported-platform runtime acquisition, budgeted build/install and
  recipient-local credential injection. No runtime is downloaded by this foundation.
- Shared application commands exposed through the existing UI and agent/CLI interfaces, with
  idempotent execution and cancellation. The description parser is not such an interface.
- Recipient plan selection, explicit scope/deviation reporting, live scientific trials and result
  comparison. Reanalysis inputs do not yet exist because the new study has not run.
- A browser-safe service bridge and preview navigation. Tuanzi's CSP forbids iframe embedding;
  that requires an explicit later product decision and separate validation.
- Publication UI and an end-to-end real tuanzi `.science` release. The current real package tests
  use synthetic research; they do not assert that the prepared tuanzi materials have already been
  published or reproduced on another device.

## Evidence

Local checks use macOS arm64 and an independently selected Node v24.18.1. No installed desktop
client, user configuration or original tuanzi checkout is used as the test data root.

Prepared source: 427 regular files, 5,865,365 uncompressed bytes; archive SHA-256
`d5f267593b8a184e2aaccd6dfd803d8394e27b605889cd5236dd044b86aa25c2`.
All eleven included materials were checked against actual bytes, the material index and the
description. The final description SHA-256 is
`59569b52cd9b7632b660bc07f44c41678d5845016224c886443e21a73aa32753`.
The pinned source has historical research documentation; those results remain attributed to their
original studies and are not new observations from this work. No explicit source license file was
found in the selected commit; publication terms remain part of the later release review.

The optional real-tuanzi receipt records `providerCalls: 0`, `experimentsStarted: 0`, absent provider
credentials, unchanged v0.5.6 source identity, HTTP-over-Unix transport, adapter/runtime hashes and
verified service termination. It is a local engineering receipt; its process and Notebook Run IDs
are diagnostic local identities, not portable identity fields in the reproduction description.

The final impact set covers:

| Behavior                                                                        | Project-owned evidence                                                                               |
| ------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Content/path/description validation                                             | `src/shared/research-reproduction.test.ts`                                                           |
| Fixed Git objects, portable paths, exclusions and no lazy fetch                 | `scripts/research/prepare-git-snapshot.test.ts`                                                      |
| Real package transport, ID remapping and private dependency closure             | `src/main/session-package/research-reproduction.integration.test.ts`                                 |
| Default policy, precise Unix grant and refusal on unsupported targets           | `packages/notebook-network-sandbox` tests and `local-service.macos.integration.test.ts`              |
| Service generation and revocation                                               | `local-service-lease.test.ts`                                                                        |
| Declared Node HTTP transport adapter                                            | `node-local-service-preload.test.ts`                                                                 |
| Bounded cleanup, ownership write failures and retry                             | `shell-process.test.ts`, `shell-process-ownership.test.ts`, `shell-cell-session.integration.test.ts` |
| Durable Notebook history and real normal/cancel/timeout/shutdown/crash handling | `research-service.macos.integration.test.ts` plus existing runtime/sandbox-owner suites              |
| Existing owner boundaries                                                       | Runtime/artifact architecture guards and module ownership/consumer guards                            |
| Cross-process contracts and source quality                                      | `npm run typecheck`, `npm run lint`, changed-file Prettier and `git diff --check`                    |

The change classifier retains the full fallback for the additive module registration and newly
owned research scripts. No CI workflow, classifier, fallback rule or existing coverage was weakened.
The source-risk inventory adds the new shared description, and sandbox changes now also select
their actual Notebook consumers. These additions touch the protected `change-impact.json` and CI
tests; a future upstream PR requires the normal CI-owner review. They are not all covered by the
module-JSON registration exemption. Strict architecture inventories retain every prior entry.
There is no renderer change, so a new UI/Electron journey or translation catalog is not introduced.
Native Windows/Linux service execution is not claimed; requesting the new capability there fails
closed. Final repository-wide test results and post-review checks are recorded below.

The initial complete run exposed two existing local test-environment problems in addition to the
new registration omissions: the system Python launcher selected Python 3.9, and the shared ACP
0.70.0 installation carried only part of the repository's current patch. The worktree alone now
has an ACP copy restored from the local npm cache, verified against the lockfile SHA-512, with the
full repository patch applied. Main-checkout package hashes and inodes are unchanged; no package
download or source workaround was needed. The three affected Claude suites pass all 167 tests.

Python checks use the existing `PYTHON` and `OPEN_SCIENCE_TEST_PY_ENV` overrides with independently
installed Python 3.13.14. The latter must be the canonical interpreter path: the native fixture
grants its real prefix, so executing through a different, ungranted symlink directory is denied.
Using the same interpreter's canonical path resolves that environment problem without changing
the sandbox, test assertions or application settings.

Final local verification on 2026-10-05:

- The complete `npm test -- --reporter=dot` run reports 49,929 passed, 7 failed and 845 skipped
  tests across 2,626 files. All seven failures were the native Python fixture path issue above.
- After correcting only `OPEN_SCIENCE_TEST_PY_ENV`, the entire
  `runtime-service.macos-isolation.integration.test.ts` file passes 15/15 tests, including all
  seven previously failing cases in the real macOS sandbox. This is combined full-run and focused
  rerun evidence, not a claim of one entirely green full-suite invocation. Skipped tests remain
  unverified by that full run.
- With `OPEN_SCIENCE_STAGE1_TUANZI_MATERIALS` set to the independently prepared materials,
  the real research-service suite passes 10 tests, including pinned Tuanzi startup. Its one
  parent-process skip is the private crash-owner fixture exercised in a separate worker by the
  cold-recovery test. The optional startup case also passed after the last runtime source edit.
- Full `npm run typecheck` and `npm run lint`, changed-file Prettier, and `git diff --check` pass.
  The focused CI/architecture regression set passes 196 tests; registration/integrity/routing
  checks pass 122 tests, and the ownership audit covers all 6,281 tracked source/package files.

For repeat verification, select an existing supported interpreter before running the native Python
suite; this stage does not provision one. Run targeted tests through the repository's `npm test`
entry point, since existing Shell tests depend on its npm runtime context. The optional Tuanzi
materials variable must point to the reviewed snapshot directory, never the original checkout.

These checks establish the engineering foundation only. There were zero live-model requests and
zero new scientific trials. The prepared materials have not been exported as a real Tuanzi
`.science` release, and no installed desktop client or upstream repository was updated.
