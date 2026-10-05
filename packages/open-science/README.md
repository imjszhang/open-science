# @aipoch/open-science

Node.js SDK and command-line client for an Open-Science daemon running on the local machine.

## Documentation

- [CLI guide](./CLI.md) - installation, daemon lifecycle, task automation, artifacts, and exit codes

## SDK quick start

```js
import { connectToOpenScience } from '@aipoch/open-science'

const client = await connectToOpenScience()
const run = await client.startRun({
  project: 'systematic-review',
  prompt: 'Summarize the evidence.',
  cwd: '/absolute/path/to/research',
  permissionProfile: 'auto',
  permissionPrompts: 'none' // Deny requests that would require a human; keep existing permission rules.
})
const result = await client.waitForRun(run.id)
console.log(result.output)
```

Session, Project-default, and global Agent-routing configuration use the same authenticated local
API:

```js
const configuration = await client.getSessionConfiguration(run.sessionId)
await client.updateSessionConfiguration(run.sessionId, {
  expectedRevision: configuration.revision,
  memoryEnabled: false
})

const defaults = await client.getProjectSessionDefaults('systematic-review')
await client.updateProjectSessionDefaults('systematic-review', {
  expectedUpdatedAt: defaults.updatedAt,
  patch: { permissionProfile: 'auto' }
})

await client.updateAgentRouting({
  framework: 'codex',
  reviewer: { mode: 'inherit' },
  subagent: { mode: 'inherit' }
})

const runtimes = await client.listRuntimes()
```

Session updates use `revision`; Project-default updates use `updatedAt`. Both reject stale writes.
Project defaults are copied only when a Session is created, with precedence `startRun` request,
Project defaults, application settings, then provider default. Agent-routing updates are atomic and
never return provider credentials.

Agent runtime listings expose only framework, readiness, version, and managed/external source. They
do not expose executable paths.

SDK requests have a 30-second default deadline that remains active while the response body is being
consumed. Override the client default with `requestTimeoutMs`, or pass `{ signal, timeoutMs }` as the
final options argument to an individual request method. `downloadArtifact` keeps the deadline active
while its returned `Response` body is streaming. `waitForRun` applies its overall `timeoutMs` and
caller signal to every in-flight polling request as well as the delay between polls. Each poll is
bounded by the smaller of the client's `requestTimeoutMs` and the remaining total wait budget.
A request timeout fails the wait immediately; it does not silently retry. Without a total
`timeoutMs`, waiting has no overall deadline. `pollIntervalMs` defaults to 250 and must be a finite
positive number.

Aborting or timing out a wait stops only the local observation. The Run may continue on the host;
call `getRun(run.id)` to check it, or explicitly call `cancelRun(run.id)` to stop it. With
`returnOnAttention: true`, a returned Run may still have `status: 'running'` and need a Plan decision before it can finish. Ordinary permissions do not populate Run attention.

```js
const waitController = new AbortController()
const result = await client.waitForRun(run.id, {
  timeoutMs: 120_000, // Total wait budget; each poll still has the client request deadline.
  pollIntervalMs: 500,
  returnOnAttention: true,
  signal: waitController.signal // Aborts observation; does not call cancelRun.
})
console.log(result.status, result.attention)
```

For retry-safe project creation and Run starts, pass the same `idempotencyKey` in the final options
argument on every attempt. The daemon replays the first response for up to 24 hours while it remains
running; reusing a key with a different request body fails with `idempotency_conflict`. If the
bounded replay registry is full, a new unique key fails with `idempotency_unavailable` rather than
evicting an existing guarantee. A lost response after submission does not prove that the Run was
not started. Retry with the original key and identical request while that daemon is still running,
or query the known Run ID. The replay registry is process-local: a daemon restart loses it, so
reusing a key after restart is not a durable exactly-once guarantee.

The `project` request field and the `listSessions(projectId)` argument both require a Project ID.
Project display names are not accepted as routing identifiers.

SDK and HTTP callers must supply an absolute `cwd`. Open-Science canonicalizes and validates it,
persists it as the Session working directory, and returns the effective path on every Run. Supplying
`cwd` with `sessionId` is allowed only when both paths resolve to the same directory. Omit `cwd` to
use a managed workspace. External working directories remain caller-owned and are never removed by
Open-Science.

For live automation feedback, subscribe before starting the Run. `run.progress` reports ordered
provider-neutral phases and emits a progress heartbeat every ten seconds until the first visible
provider output. This progress heartbeat describes Run activity; it is separate from the filtered
connection heartbeat that keeps an otherwise-idle WebSocket alive. The timer starts after Task has
prepared the Session and registered its Run; Session creation or resume time before registration is
outside this event stream:

```js
const abortController = new AbortController()
const events = client.events({ signal: abortController.signal })
await events.ready

const progress = (async () => {
  for await (const event of events) {
    if (event.type === 'run.progress') {
      console.log(event.data.phase, event.data.elapsedMs, event.data.heartbeat)
    }
  }
})()

const observedRun = await client.startRun({
  project: 'systematic-review',
  prompt: 'Summarize the evidence.',
  permissionProfile: 'auto'
})
const observedResult = await client.waitForRun(observedRun.id)
abortController.abort()
await progress
console.log(observedResult.output)
```

`events.ready` rejects if the socket fails, closes, or receives no liveness frame before opening.
After opening, the iterator fails with `timeout` when no event or connection heartbeat arrives for
30 seconds. Pass `idleTimeoutMs` to change that connection-liveness window; it does not limit model,
Notebook, permission-approval, or other Run duration. Connection heartbeats are control frames and
are not yielded to consumers. Malformed frames and a consumer backlog above 1024 events terminate
the iterator with `event_stream_invalid_message` or `event_stream_overflow` instead of throwing
outside the iterator or growing memory without a bound.

Every Run event includes top-level `sequence`, `runId`, `sessionId`, and `projectId` fields in
addition to its existing `type` and `data`. After an established socket closes unexpectedly, the SDK
reconnects with its last sequence and the daemon replays the retained suffix. Replay is bounded and
process-local. If the daemon restarted or the suffix was evicted, the iterator yields
`stream.resync-required` with reason `stream-changed` or `cursor-expired`; read the Run or Session
through the HTTP API to restore authoritative state.

Plan First runs can opt into actionable waiting with returnOnAttention. When the returned Run has
attention.kind equal to plan-approval, use getSessionPlan and respondSessionPlan. Calling waitForRun
without returnOnAttention keeps the original terminal-only behavior.

Automatic review and Specialist binding reuse existing Session JSON fields. Delegation adds
delegationPolicy with values allow or deny; an omitted historical value restores as allow.

To stop a still-running task instead of waiting for it, cancel it explicitly. Cancellation waits for
provider work and application finalization to drain before returning the terminal Run:

```js
const cancelled = await client.cancelRun(run.id)
console.log(cancelled.status) // cancelled
```

The client discovers the local daemon and reads its authentication token from the Open-Science config
directory. Tokens are sent in request headers and are never included in normal command output.

### Automation new-session defaults

`project session-defaults show|update` manages defaults for new Sessions created through the
Task CLI/API. Explicit run options override these defaults. Existing Sessions and desktop New
conversation drafts are not changed.

`--provider-default-model` keeps following the provider-owned default instead of pinning the
first model in its catalog. An explicit `--model` stays fixed. If a saved selection becomes
unavailable, choose a replacement explicitly or wait for it to become available again.

## Managed execution of research materials

`client.execution` uses the receiving machine's authenticated local service. It prepares immutable
research materials in an Open-Science managed environment and executes a bounded command through
Notebook. It does not start an Agent/model task. Use an existing writable Session, or
`execution.createSession({ projectId, requestId, title })` to create an ordinary local Session.
The source research and destination Session can differ within the authorized Project.

```js
const scope = { projectId: 'your-project-id', sessionId: 'your-writable-session-id' }
const { runtimes, diagnostics } = await client.execution.runtimes()
if (!runtimes.length) {
  console.log(diagnostics?.issues)
  throw new Error('Open Science needs an available independent Node runtime.')
}
const materials = await client.execution.inspectMaterials({
  ...scope,
  sourceSessionId: 'imported-research-session-id'
})
// Select an available immutable Version reported by materials.versions.
const environment = await client.execution.prepare({
  ...scope,
  requestId: 'prepare-analysis-1',
  sourceSessionId: materials.source.sessionId,
  sourceIdentity: materials.source.identity,
  runtimeId: runtimes[0].runtimeId,
  materials: { files: [{ versionId: 'selected-version-id', restorePath: 'input.json' }] }
})
const operation = await client.execution.execute({
  ...scope,
  environmentId: environment.environmentId,
  requestId: 'analysis-1',
  command: 'node --version',
  timeoutMs: 10_000
})
const latest = await client.execution.waitOperation({
  ...scope,
  requestId: operation.requestId,
  timeoutMs: 60_000
})
console.log(latest)
```

The initial native-service target is macOS with an independently installed Node 22 or newer.
Discovery uses the application's launch PATH and common host locations, including `~/.local/bin`.
An empty runtime list means the application cannot currently find a compatible runtime; make the
existing Node available to the application and restart it before retrying. The client does not
install a runtime or substitute Electron. For an isolated Test installation, explicitly select its
`configRoot` when connecting so execution and package operations use the intended application.

Runtime discovery's `available` means a compatible independent Node was found; it does not establish
that a particular plan or local HTTP service is supported. Optional `diagnostics` reports
`nativeServiceSupported` and `issues` with stable `code`, fixed `message`, and suggested `action`.
Codes distinguish `node_not_found`, `node_version_unsupported`, `node_host_mismatch`,
`node_not_independent`, `node_unusable`, and `native_service_unsupported`. The same diagnostics reach
the CLI and internal `host.managedExecution.runtimes()` without candidate paths, environment values,
or raw probe errors. Older applications may omit diagnostics. Inspect them before executing a plan;
they do not authorize or perform installation.

Save the actual execution scope as an ordinary output Artifact: include the selected `sourceIdentity`,
descriptor identity or `planKey` when present, declared scope, actual parameters, known missing
materials or alternative conditions, and limits on what the results establish. Declare that report
in `outputs` so it travels with the result package. This is a record of the chosen execution, not a
new `.science` field. External request/result records do not automatically capture the complete
Codex conversation.

Use a new `requestId` for new work. Retrying an identical preparation or execution with its existing
ID retrieves the same work; reusing that ID for different input is rejected. The optional HTTP
`idempotencyKey` is an additional transport retry safeguard, not a replacement for the request ID.

`waitOperation` waits at most 60 seconds and returns the current snapshot, which may still be
running. Aborting an SDK request only stops waiting. Explicitly use `cancelOperation` to stop work;
use `releaseEnvironment` after work settles and outputs are collected to release its managed files.
A `cleanup-pending` state means cleanup has not yet been verified. Release can also return a retained
`pendingCollection` while the original turn has saved files but has not published them yet. Requested
cleanup completes automatically after every exact output Version, including the execution/collection
receipt, is published. Pending outputs are preserved until then; do not delete files outside this API.

If output publication did not finish, inspect `getEnvironment` for `pendingCollection.collectionId`.
`collectOutputs({ projectId, sessionId, environmentId, collectionId, requestId })` saves the retained
outputs without rerunning the experiment. It returns an operation start snapshot: observe the same
`requestId` using `getOperation` or `waitOperation`, including after an HTTP observation timeout.
Keep the collection's request ID for identical retries. Collection is separate from `execute`;
never rerun a command merely to recover publication. If collection reports that saved Versions still
await publication, finish or recover the original turn's finalization before trying collection again.

Inside that same active producing turn, an exact output `versionId` may be read using
`host.artifactPath(versionId)` through the turn's producer authority. This does not publish it early:
the ordinary Artifact catalog and other readers still expose only published Versions.

Only explicit `discardOutputs({ projectId, sessionId, environmentId, collectionId })` abandons the
identified pending collection. It returns the current environment; inspect it before release.
Already published immutable Artifacts remain available. Neither request accepts `provenance`,
`recoveryAuthority` or `writeAttempt`; these are application-owned authorities, not public inputs.

The command starts in its writable work directory. `OPEN_SCIENCE_INPUT_DIR` refers to restored,
read-only inputs, `OPEN_SCIENCE_OUTPUT_DIR` to the output directory, and `OPEN_SCIENCE_NODE` to the
selected independent Node executable. Declare output paths relative to the output directory in
`outputs` to publish immutable Session artifacts. Runtime paths, filesystem grants and execution
capabilities cannot be supplied through this API. The first supported sandbox is macOS; remote
callers are rejected. Optional local HTTP service adaptation uses a managed Unix socket and does
not expose a public TCP endpoint.

## Local `.science` package transfers

`client.packages` uses explicit file paths on the receiving local machine. It shares the desktop
package format, validation, locks and import receipt. Importing preserves read-only research history
and does not execute its contents. Inspect first, review the returned summary and omissions, then
explicitly commit the returned handle:

```js
const review = await client.packages.preflightImport(
  {
    filePath: '/absolute/path/research.science',
    target: { projectName: 'Imported research' } // Or { projectId: 'existing-project-id' }
  },
  { idempotencyKey: 'inspect-research-1', timeoutMs: 120_000 }
)
console.log(review.preview, review.expiresAt)
// After reviewing this exact preview:
const imported = await client.packages.commitImport({ preflightId: review.preflightId })
await client.packages.export(
  {
    projectId: imported.projectId,
    sessionId: imported.sessionId,
    filePath: '/absolute/path/shared-research.science'
  },
  { timeoutMs: 120_000 }
)
```

Preflight stages and validates the archive but publishes no Project or Session. Its handle belongs to
the caller and expires after ten minutes by default; commit uses the staged archive, even if the
original file changes. Use `cancelImport({ preflightId })` to discard it. Only one transfer may be
active at a time. Shutdown discards an uncommitted preflight; review again after restarting.
Retrying a committed handle within the same service lifetime returns its imported identity without
importing twice. Use HTTP `idempotencyKey` options when retrying a lost preflight or export response;
a new preflight intentionally starts a new review.

Export requires a new destination filename and never overwrites an existing file. Optional
`excludedStorageKeys` and `includePdfNotes` use the existing package selection rules; sensitive
content checks remain enforced. A successful transfer can return `cleanupPending: true` when its
publication succeeded but private staging cleanup must be retried. Remote callers cannot use host
file paths. These methods do not open desktop dialogs or weaken desktop command restrictions.
