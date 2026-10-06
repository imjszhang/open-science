# Replay demos and research execution

Implementation started 2026-10-07 from `cb4d16c76`. This ledger describes the accepted
product contract and records evidence as work completes. Unchecked items are not delivered.

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

- [ ] Optional, bounded demo Artifact with pinned descriptor/plan/material entrypoint, structured
      arguments, outputs, runtime and lifetime requirements, disclosed substitutions and view.
- [ ] Source-scoped inspect/start/status/history/stop using the existing managed executor without
      invoking a model. Exact run identity, retry safety, cancellation and recovery.
- [ ] Replay-only demo entry, explicit states and history; existing discussion/working-copy
      navigation remains intact. Ordinary backing Session ownership is discoverable and managed.
- [ ] Main-owned invocation confinement: demos cannot use external network, research credentials
      or unrelated global filesystem grants. Ordinary Notebook defaults remain unchanged.
- [ ] Shared research preflight and local execution profiles with private credential storage,
      execution-bound leases, explicit service permissions, and no public raw environment DTO.
- [ ] External SDK and internal Host parity for genuine research execution in ordinary Sessions;
      missing conditions never silently fall back to a demo.
- [ ] Receipts distinguish execution purpose, conditions, execution outcome, recording coverage
      and research interpretation; package export/import preserves provenance without secrets.
- [ ] Tuanzi offline demo fixture and a non-Tuanzi fixture; old package compatibility.
- [ ] Tuanzi live runner, frozen small benchmark protocol and checker; authorized actual external
      requests followed by export/import and recipient execution through the three entry points.
- [ ] Meaningful unit/integration/native/Electron checks, eight-locale guards, contracts/module
      impact, typechecks and lint for changed code.
- [ ] Independent Test build/install and installed-client verification; production installation
      and original input packages unchanged. No upstream submission is part of this delivery.

## Scope and pending execution choices

Initial native support is macOS with a compatible independent Node runtime and HTTP/API services.
Other runtimes/platforms must report prerequisites rather than weaken isolation. Demo records use
the existing observation timeline/media archive; MP4 rendering is not part of this implementation.

The current Tuanzi live-07 package contains offline engineering evidence only. Its live model
protocol is a draft, not a completed reference experiment. A small real benchmark must establish
reference evidence before claiming a recipient reproduction. Model/service selection and bounded
live-request budget must be established before that acceptance; mocks do not satisfy it.

The user subsequently authorized the existing Tuanzi `.env` configuration with an aggregate
100 CNY live-test ceiling. Secrets must remain local. The relay service's actual pricing or
enforceable quota still needs verification; a call-count limit alone is not a monetary ceiling.

## Implementation evidence

Pending. Read-only inspection confirmed the existing no-model managed execution path, retained
source material authority, source immutability, and the absent research credential binding and
per-invocation confinement. No experiment was started during planning.

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

## Current local verification evidence

The new Tuanzi fixture retains the original v0.5.6 source, engineering driver, checker and
reproduction descriptor bytes, and adds a separately published demo Artifact describing the local
rule generator and viewing-window adaptations. A separate generic interactive counter fixture
checks that the path is not tied to Tuanzi. Both were exported through the native `.science`
exporter in publication-only mode. These packaging checks started no project process and made no
model/API inference request.

The independent Test maintenance suite passed 48 checks before the planned upgrade. Unit and
native checks are recorded in the delivery checklist only after their relevant end-to-end
verification has completed; a passing mocked orchestration test alone is not installed-client
acceptance.
