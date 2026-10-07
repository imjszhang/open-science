# Browser recording and read-only project replay

The optional browser recorder captures the actual project page during an admitted execution.
It does not open a second page, start a research process, create a Notebook Run, or replay project
JavaScript. A recording is an independent research material alongside Notebook and Results.

## Capture and lifecycle

`BrowserRecordingOwner` receives an existing source and auxiliary publication capability. The
Electron adapter subscribes to compositor presentations of the registered project iframe. A
separate sandboxed encoder window receives cropped pixels only and encodes independent VP8 WebM
segments. It never navigates to the project. Starting recording requires its own `allowRecording`
permission; the existing single-image `allowCapture` permission is unchanged.

The initial capture target is 10 fps. The recorder saves the visible project region, not the
desktop, other applications, the conversation, or content outside the recorded viewport. The
original page and execution retain their identities. Passive click/scroll records carry
`browser-observed` provenance; author declarations and host evidence remain distinguishable.
No raw keyboard events or input values are recorded. Input, textarea, contenteditable and explicit
`data-open-science-recording-private` regions are masked before encoding. This is not automatic
recognition of secrets drawn into a Canvas or arbitrary text.

Visible pages continue recording when another application has focus. Hidden/minimized pages
produce explicit gaps. The first adapter stops with partial evidence when the recorded layout,
zoom or document identity changes; resize the preview before recording or start a new recording
afterwards. It must never keep a stale crop or report a frozen frame as continuous evidence.

Stopping the recorder does not stop the experiment. Execution shutdown drains the encoder and
publishes the index while the original write capability still exists. Every saved media segment
also publishes a partial immutable index, so already saved evidence remains discoverable after
an interruption. Recovery never restarts the project. Recording budgets are independent of model
usage: media segments are at most 16 MiB, total recording media defaults to 512 MiB and the maximum
recording duration defaults to one hour. Capacity or encoding failures do not change the experiment
outcome. Actual gaps and dropped frames are preserved in the index.

## Portable evidence

`open-science-web-recording` version 1 is optional Artifact JSON. It stores segment intervals,
codec/viewport metadata, operation markers, coverage gaps and exact media Version/checksum/size
references. The existing image recording v1 and run-observation archive v1 remain unchanged.
The `.science` container and its mandatory fields are not extended.

Receiving readers resolve every reference through the imported scope's immutable Versions, not
sender paths or URLs. Video media has a dedicated authorized, bounded Range/HEAD reader. Seeking
does not reopen an environment or connect to the original project service. Missing media and
unsupported codecs stay explicit; Replay never fills missing evidence by executing the project.

The player shares the existing Project Replay material view, supporting time-based seeking,
playback speed, segment transitions and event markers. Explicit gaps are not fabricated into
frames. Image-only historical recordings keep their sampling semantics. Switching material or
research pauses playback and cancels pending media reads. Notebook and Results retain independent
selection and execution behavior.

`recorded-project-moment` references contain the receiving index Version/checksum, recording ID,
relative time, exact segment Version and segment-relative time. They do not fabricate Notebook
steps. A selected moment is untrusted recorded evidence, never an instruction to execute code.

## Desktop and Codex

Normal sessions expose recording controls on their existing project observation viewer.
`client.projectRecordings` exposes inspection, start/pause/resume/stop/status, historical read,
openRecorded, selectMoment and selection. Requests are authenticated and local. Recording is
opt-in on the viewer, and selecting an Electron source from Codex requires an explicitly
recording-enabled source belonging to the same exact execution.

Codex controls Open Science's actual desktop project surface using a returned `sourceViewId`.
This is not arbitrary recording of the Codex browser tab. Both clients can open the same archived
evidence through their own authorized read-only viewers. The browser can retain a selected moment
for SDK reading or copy its reference; it cannot automatically send a message to Codex.

## Verification and follow-up

The implementation includes contract, lifecycle, authorization, SDK, renderer, Range, exact-import
and real Electron/Chromium tests. Native capture tests assert unchanged document identity/request
count, moving Canvas content, input masking, focus changes, explicit gaps and decodable independent
segments. The Tuanzi engineering acceptance uses pinned v0.5.6 source
`b6d5810fef3baac1195c980fe728ce7a8a69408b` in a fresh directory, with no external provider calls.
Its receipts are separate from the application tests; scientific reproduction remains
`NOT_EVALUATED` by these recording checks.

Full DOM reconstruction, audio capture and MP4 export are not part of this adapter. The preserved
media and time index are suitable inputs for a later export renderer. That renderer must consume
archived evidence and must not require the original project runtime.
