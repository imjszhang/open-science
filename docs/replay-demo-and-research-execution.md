# Replay demos and research execution

Implementation started 2026-10-07 from `cb4d16c76`. This ledger describes the accepted
product contract and records evidence as work completes. Product implementation is recorded at
`c078dc8b5`, with acceptance support in `9e2df696c` and viewer fixes in `9442595c9` and `2cf23e346`;
unchecked acceptance items remain unverified. A checked implementation item does not
establish scientific reproduction or installed-client acceptance.

## Product contract

Replay owns offline demonstrations. Its existing recordings remain historical evidence; starting
a demo creates a fresh, explicitly labelled demonstration. A demo does not require an Agent model,
credentials or external services. It never establishes scientific reproduction success.

Research reproduction remains an ordinary Agent task in external Codex, a writable Open Science
Session or an optional working copy. All use Open Science's managed environment, materials,
Notebook execution, observation and publication owners. No second execution engine is introduced.

Imported sources and old discussions are unchanged. `.science` v1 and the existing strict
reproduction description remain unchanged. Optional demo instructions are ordinary Artifacts,
are untrusted data, and confer no execution or network authority.

## Required delivery and evidence

- [x] Optional, bounded demo Artifact with pinned descriptor/plan/material entrypoint, structured
      arguments, outputs, runtime and lifetime requirements, disclosed substitutions and view.
- [x] Source-scoped inspect/start/status/history/stop using the existing managed executor without
      invoking a model. Exact run identity, retry safety, cancellation and recovery.
- [x] Replay-only demo entry, explicit states and history; existing discussion/working-copy
      navigation remains intact. Ordinary backing Session ownership is discoverable and managed.
- [x] Main-owned invocation confinement: demos cannot use external network, research credentials
      or unrelated global filesystem grants. Ordinary Notebook defaults remain unchanged.
- [x] Shared research preflight and local execution profiles with private credential storage,
      execution-bound leases, explicit service permissions, and no public raw environment DTO.
- [x] External SDK and internal Host expose the same research execution path in ordinary Sessions;
      missing conditions never silently fall back to a demo. Actual provider acceptance is separate.
- [x] Receipts distinguish execution purpose, conditions, execution outcome and recording coverage;
      viewers preserve the distinction from research interpretation after package export/import.
- [x] Tuanzi offline demo fixture and a non-Tuanzi fixture; real macOS execution, project view,
      cancellation and native package round trips; old packages remain readable without gaining
      an inferred executable command.
- [x] Tuanzi live runner, frozen small benchmark protocol, checker and bounded transport fixture
      prepared without provider inference requests.
- [ ] Authorized actual external requests: establish the new Tuanzi baseline, export/import it,
      then execute through external Codex, an ordinary Session and a working-copy Session under
      the single aggregate budget. Validate provider use and resulting evidence separately.
- [x] Targeted unit/integration/native checks, eight-locale guards, contracts/module impact,
      typechecks and lint for changed code. See verification boundaries below.
- [x] Independent Test build from the product commit and maintenance checks.
- [x] Installed Test-client verification, including visible Replay states, project interaction,
      public profile configuration and preserved ordinary-session navigation. Production installation
      and original input packages must remain unchanged. No upstream submission is included.
- [x] Installed private-field entry, OS-encrypted persistence, restart readback and exclusion from
      SDK responses/package export, using synthetic non-service values. Remote authentication and
      a newly locked-vault authorization prompt are not established by this check.

## Scope and remaining acceptance conditions

Initial native support is macOS with a compatible independent Node runtime and HTTP/API services.
Other runtimes/platforms must report prerequisites rather than weaken isolation. Demo records use
the existing observation timeline/media archive; MP4 rendering is not part of this implementation.

The older Tuanzi live-07 package contains offline engineering evidence only. Its draft live
protocol is not a completed reference experiment. A separate v0.5.6 live-materials set now freezes
one small author baseline and three recipient executions. The live runner and checker are prepared;
no live baseline or recipient outcome is claimed. These four executions validate the product path,
not the proposed 20-pair scientific study or a statistically supported treatment effect.

The user authorized the existing Tuanzi `.env` configuration and then replaced the monetary limit
with an aggregate **1,000,000,000-token** ceiling. The earlier 100 CNY/pricing-verification gate no
longer applies. Secrets remain local. Acceptance still uses four small trials; the authorized ceiling
is not a target consumption. Token admission reserves a conservative allowance before dispatch,
records provider-reported usage separately, and retains reservations when usage is missing or a
request's outcome is uncertain. Updating the acceptance budget does not introduce a product-wide
billing or provider quota feature.

## Implementation evidence

The source-scoped demo owner validates exact imported Versions, starts an ordinary backing Session
operation and delegates to the existing managed executor. It retains invocation identity across
retries and recovery, joins cancellation and teardown, and does not call an Agent model. The
inspection, owner, IPC and native tests are in `src/main/research-demos/`.

The managed shell policy now carries a Main-owned execution purpose. Offline demos deny all
external hosts before default package domains, prior Session/global approvals or one-time grants
can authorize them; they do not prompt for external access. Research profiles add an exact-host
ceiling to the existing network permission owner. Neither confined path inherits unrelated global
filesystem grants. `src/main/notebook/managed-confinement.macos.integration.test.ts` verifies real
macOS sandboxed processes, blocked direct connections and Node fetch through the existing proxy
using a controlled fixture, with no provider inference request.

Research profiles bind to the exact source, descriptor Version/hash and plan. Credentials enter
only through trusted local desktop configuration, remain encrypted in local storage and are leased
to the admitted process in memory. They are excluded from public execution fingerprints and
receipts. Streaming logs redact configured values across chunk boundaries; selected output files
are checked before publication. Credential identity inventory and recovery barriers include the
new profile document and refuse reads, edits, deletion or temp-file promotion while access is
blocked. Tests cover storage/lease revocation, IPC rejection, native process injection and redaction,
output rejection, and recovery during durable writes.

Purpose and disclosed condition changes travel in an ordinary managed collection receipt. The
recorded reader verifies immutable receipt bytes, receiving Session, native Artifact Run, recording
and execution identities before exposing a bounded public `executionContext`. Both SDK and desktop
observation/Ask DTOs receive that context. `.science` v1 and strict observation archive v1 remain
unchanged. Missing, corrupt, conflicting or unrelated receipts produce `unknown`; a completed run
never becomes scientific success by inference. Native package tests preserve purpose and selected
materials, and recorded-reader tests cover import, working-copy export and a second import.

## Using the two paths

In an imported research Session, open Replay and select **Offline demo**. An available demo
shows its stated substitutions before **Start demo**. Starting it restores the pinned materials,
launches one bounded process, and opens the existing observation view in the right pane. The source
record remains read-only. **Stop demo** stops that process; saved observations remain in the demo
history. **View execution record** opens the ordinary backing Session so existing export, archive
and deletion actions remain available. The backing Session is grouped under its source instead of
appearing as an unrelated conversation in the default lists.

Old packages without an explicit demo Artifact remain readable and discussable. They do not gain
an inferred executable command. A newly started demonstration is labelled as such; it is never
presented as a recording of the original experiment.

For real research, ask Codex or an ordinary Open Science Session to inspect the selected research,
identify the intended plan and compare its prerequisites with the receiving machine. A working copy
is optional. Both entry points use the same managed-execution service. The receiving Session must
be writable; it may belong to the existing project and does not need a special reproduction type.

The external SDK provides `execution.inspectMaterials`, `execution.preflight`,
`execution.requestConfiguration`, `execution.getConfiguration`, `execution.prepare` and
`execution.execute`. Internal Notebook code uses the corresponding `host.managedExecution`
methods. Configuration requests open a trusted local desktop dialog and return a request identity.
The caller polls that identity and receives a profile ID after configuration. It does not receive
credential values, and saving configuration does not start a run. Preflight must be checked again
before execution. A ready result means local prerequisites are present; it does not attest remote
service availability, credential validity or scientific success.

Use the returned compatible runtime, exact source identity, descriptor Version and selected plan
materials for preparation. Pass the local `profileId` to execution when the plan needs services.
Set `recordObservation: true` and an explicit project view when the project provides an HTTP page.
Keep a stable request ID across uncertain replies: query `getOperation` before deciding whether to
retry. The existing observation APIs expose live state, logs, project view and selected evidence to
Codex as well as the desktop. Review produced evidence and disclosed condition changes separately
from the process completion status.

## Preparing a portable offline demo

Publish `research-demo.json` as an ordinary Artifact alongside the existing
`research-reproduction.json` and its materials. The demo pins the descriptor SHA-256, a plan key and
one of that plan's declared material entrypoints. It supplies structured arguments, bounded lifetime,
selected outputs and, optionally, a local service port plus project view. It contains no arbitrary
shell command, credential value, network grant or author-side absolute executable path.

The reproduction descriptor and `.science` format are unchanged. The demo is not placed inside the
descriptor's hashed material list, which would create a checksum cycle. The Main owner validates it
against the same imported source closure and registers its exact Version as a supplemental execution
input, preserving it through subsequent export/import.

Required fields for a minimal demo are:

```json
{
  "format": "open-science-replay-demo",
  "version": 1,
  "title": "Offline example",
  "description": "A fresh local demonstration using synthetic inputs.",
  "descriptorSha256": "<64 lowercase hexadecimal characters>",
  "planKey": "example",
  "substitutions": ["Synthetic inputs replace the original external model responses."],
  "entrypoint": { "materialKey": "example-driver" },
  "arguments": [],
  "timeoutMs": 60000,
  "outputs": [
    { "path": "result.json", "filename": "result.json", "contentType": "application/json" }
  ]
}
```

The example checksum is a placeholder and must be replaced with the hash of the actual descriptor
bytes. The parser rejects unsupported versions, oversized or ambiguous JSON, undeclared entrypoints
and unavailable material Versions. A plan requiring credentials cannot be admitted as an offline
demo. Native confinement denies external network access even when the surrounding Session has
broader Notebook grants. A project-local UI service is routed only through its managed owner.

A desktop project view must explicitly declare `projectView.adaptFrameAncestors: true` and disclose
that framing adaptation. The owner otherwise refuses embedding under Electron's `file:` parent.
This changes only the managed view response; it does not rewrite the packaged source. The generic
browser fixture initially omitted this desktop declaration. Its original package and native evidence
were retained; a separate `generic-materials-desktop` package adds the declaration and disclosure,
with unchanged descriptor and counter code.

## Current local verification evidence

The Tuanzi offline fixture retains the original v0.5.6 source, engineering driver, checker and
reproduction descriptor bytes, and adds a separately published demo Artifact describing the local
rule generator and viewing-window adaptations. A separate interactive counter fixture verifies a
project-independent path. Both were exported through the native `.science` exporter, then exercised
by `src/main/research-demos/owner.macos.integration.test.ts` with explicit package/evidence opt-ins.

Local acceptance receipts under
`tuanzi-gs-research/tuanzi-v056-demo-and-research-20261007/` record:

| Receipt                                                  | Verified result                                                                                                                                                                                                                                  |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tuanzi-native-acceptance-03/native-demo-results.json`   | Passed: real native project page, completed run and saved terminal observation, cancellation, export/import, 15 selected materials preserved, original Session unchanged, `offline-demo` retained, archive v1 unchanged; zero model invocations. |
| `generic-native-acceptance-03/native-demo-results.json`  | Passed: interactive counter request changes state, completion and cancellation, export/import, three selected materials preserved, original Session unchanged, purpose retained; zero model invocations.                                         |
| `generic-cancel-native-03/native-demo-cancellation.json` | Admission-time cancellation reaches a cancelled operation/Notebook Run, saves the observation and confirms environment release; zero model invocations.                                                                                          |

Targeted verification also passed:

- Streaming redaction, sandbox policy and shell regressions; real macOS confinement tests with a
  controlled network fixture. These verify permission behavior, not availability of a real provider.
- Credential inventory/identity and profile persistence: 12 suites / 202 tests; the subsequent
  recovery-barrier and related persistence checks: six suites / 49 tests.
- Profiles/service/environment/SDK/help: 11 suites / 207 tests. Native process checks exercise
  leased credentials, streamed redaction, normal output publication and rejection of secret-bearing
  output. Execution receipt and recorded-reader checks also cover selected evidence context and
  two-hop native package import/export; missing-purpose and corrupt-receipt cases stay unknown.
- Renderer verification: 14 suites / 912 tests, including 777 locale guards; a subsequent 14-test
  selected-observation regression passed. Web and Node typechecks and changed-file ESLint passed.
- Eight strict architecture-consumer suites: 337 tests. Seven subprocess Artifact crash-recovery
  cases passed after the fixture bundled the local ESM sandbox package, as the production build does.
- Contract/module/renderer regression rerun: nine suites / 620 tests. The initial repository-wide
  run exposed failures; these were repaired and rerun in their affected suites.
- A final repository-wide run passed 51,505 tests, with seven failures and 868 conditional skips.
  All seven failures belonged to the same macOS Python isolation suite: the test interpreter path
  contained two symlinks outside its declared sandbox root. Running that entire 15-case suite with
  the same interpreter's complete `realpath` passed, without changing code or sandbox policy.
  The original all-tests report is retained; it was not a single green run.
- Subsequent viewer fixes passed 873 UI/locale checks, 23 transport checks and two real Chromium
  integration cases. They cover fresh carrier ownership before notifications, one-click project
  activation, iframe persistence, live purpose deltas and recorded-step selection over real HTTP.
  Browser validation keeps strict schemas and rejects a selected purpose inconsistent with its
  verified recording payload. Web types, lint and consumer coverage passed.
- The long-log control fix passed three real Chromium scenarios and 801 UI/locale checks. A
  240-line log with eight streamed updates keeps the view controls visible; repeated mode switches
  retain one project-view request and one iframe load. Actual wheel scrolling still enters inspection,
  which cannot open a new live project view. Web and Node typechecks and changed-file lint passed.
- Test maintenance: 48 checks. Build `20261006T185734Z-2cf23e346a47` passed 777 locale guard checks
  and Node/sandbox typechecks and produced the independent macOS arm64 Test application,
  version `0.35.1-test.2cf23e346a47.2`.

Native owner tests use production execution and package owners with test caller/composition
fixtures. They are not installed Electron UI tests. An available build, passing mocked orchestration
or a native project HTTP request does not complete the installed-client acceptance item above.

## Installed Test-client evidence

The independent Test application was installed without changing its existing data or the production
installation. Native accessibility/screenshot interaction and authenticated public SDK readback
are recorded under `installed-ui-01/` in the same local acceptance directory. The production
application and the original `installed-20261006-live-07/observable-results.science` retained their
previous SHA-256 hashes after installation.

- The original imported source remains read-only; its existing discussion remains writable and
  nested under the source. The old package has an explained empty demo state. Replay owns the demo
  entry; the former parallel Run action is absent.
- The Tuanzi demo started from Replay, opened an interactive project page, supported preview width
  adjustment, saved a screenshot and completed naturally. Its managed environment was released.
  The explicit execution-record action opens its backing Session for ordinary management/export.
- Exporting that installed demo and importing it into a new project preserved the observation
  archive bytes and verified `offline-demo` purpose. Its historical screenshot is viewable.
  Selected live and saved-record evidence both populate a source discussion draft; the drafts were
  cleared without sending a model request. The saved-record Ask check used build `9442595c9`.
- The corrected generic desktop package opened a continuously updating counter page. Clicking
  **Add one** produced `clicks: 1` in the verified output. Natural completion saved the observation
  and released the environment. The earlier browser-only package remains intact; its attempted
  desktop view was refused, and cancellation saved its observation and released its environment.
- Starting a demo on build `9442595c9` no longer produces the unrelated external-Session creation
  notice. The backing Session remains discoverable through its explicit management action.
- An external configuration request opened the local desktop form. Saving public configuration
  returned a ready profile ID without starting an experiment. A subsequent synthetic private-field
  acceptance, described below, exercised the installed encrypted store without a provider request.

The long-log defect was reproduced on build `9442595c9`: auto-follow scrolled the view controls out
of the visible region, and revealing them could enter inspection before a click. Build `2cf23e346`
keeps that control row visible. Installed-client verification with a new generic run confirmed
single-click project activation during overflowing logs, retained click state across repeated view
switches, manual upward scrolling entering inspection, and **Back to live** restoring the existing
project page. A project screenshot was captured for subsequent historical viewing.

No installed-client check made a paid provider request. The final application source is `2cf23e346`;
later lease-count assertions and this ledger change only tests/documentation. Real provider
acceptance remains unchecked.

The private-field acceptance is recorded under
`tuanzi-v056-live-reproduction-20261007/private-fields-ui-01/`. It imported the pending live
materials into an explicitly labelled configuration-only project and created an empty ordinary
Session. It did not read the user's `.env`, prepare an environment or request execution.

- The trusted desktop form rejected missing required fields and URL-shaped service hostnames.
  Both private inputs stayed masked. Two explicitly synthetic, invalid service values were saved;
  service host authorization remained empty.
- Both stored references use the `enc:` OS-encryption path. Neither placeholder appeared in the
  profile document as plaintext. After a normal application quit/relaunch, preflight decrypted the
  configured slots successfully and returned `ready` with `remoteServicesVerified: false`.
- Reopening the form showed empty private inputs with **Already configured** placeholders.
  Saving without replacing those inputs retained the same profile and configured slots. The SDK
  exposed no private values or encrypted references. The ordinary Session remained empty and had
  zero output Artifacts.
- Export through the installed native owner produced `configured-source.science` (SHA-256
  `fa94d30768e99fd68a121aa1282e0d8f2f902286a4cdd7fd14d29a48ed4039f2`). Checking its 53 uncompressed
  archive files found neither the synthetic private values nor their encrypted references.

The existing Test vault was already unlocked and no new system authorization prompt appeared.
This proves installed encrypted persistence/readback on that machine; it does not prove a remote
credential is valid or replace the separate blocked-vault recovery tests.

## Remaining verification boundaries

The receiving user still configures credentials in the local desktop dialog. There is no product
`.env` importer or external secret-setting API. A separately authorized acceptance harness may read
only declared slots into a local profile in memory; that verifies the execution path, not a shipped
file-import workflow or the operating-system credential dialog.

Preflight verifies materials, local runtime and locally accessible credentials. Its explicit
`remoteServicesVerified: false` means it does not test remote model availability, credential validity,
service permissions in practice or provider charges. The exact-host profile is a ceiling; existing
Notebook network authorization is still required. Successful real-provider execution and observed
G/S usage must be recorded before claiming the complete Tuanzi live path was exercised.

The live protocol's declared token limits and durable reservations must be admitted before paid
dispatch. Failed or uncertain requests retain their reservation; new retries must not create
unaccounted trials. Provider-reported input and output usage are counted once; reasoning and cache
details already included in those totals are not added again. Missing usage remains unknown rather
than zero. Baseline and recipient runs use separate identities and preserve public conditions,
usage coverage and output hashes. This ledger belongs to the authorized acceptance harness; it is
not a general product billing limit or a guarantee about an arbitrary provider's charges.

A receipt that cannot be associated with the same verified native Artifact Run remains unknown,
including recovery records published under a different turn. Observation coverage is sampled and
reported explicitly; it is not a promise of a full recording, MP4 export or identical stochastic
model output. These limits do not require changing the `.science` format.
