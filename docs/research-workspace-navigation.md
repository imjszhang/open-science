# Research navigation and recorded-run viewing

Implemented locally on top of the stage-three Replay branch, 2026-10-06.
This change makes imported studies, their discussions and ordinary execution Sessions distinguishable
without adding a Session type, changing `.science` v1, or changing execution authority.

## Navigation contract

- Projects containing imported research remember the last explicitly opened Session, research
  workspace or ordinary draft in a local UI preference. Ordinary projects keep their existing
  most-recent-Session behavior. Background Session updates do not replace that preference.
- With no valid preference, a recent imported source opens its research workspace; a recent
  ordinary Session opens that Session. Exact Session links, search results and notifications
  still open the named Session. Internal `openProject` continuations retain their existing behavior.
- A research parent resumes its discussion or presents an unsent, source-specific draft.
  Its visible **Original record · Read-only** child opens the immutable imported Session.
  Existing discussion children remain exact Session destinations. Creating a draft does not
  create a Session or send a message.
- Ordinary Sessions are never reclassified because they read or execute imported materials.
  Only authoritative import and research membership identities establish the sidebar hierarchy.
- Deferred leave confirmations and asynchronous source lookups revalidate navigation intent,
  source import identity and destination availability before changing selection or preferences.

## Preview source and ownership

The right pane continuously identifies its actual source and its relationship to the current
conversation. The receiving source is independent of the selected left-hand Session. Source IDs
and temporary viewer grants are not used as human-facing titles or as inferred local Run authority.

Research navigation supplies a default preview only when there is no explicit user reference.
Explicitly opening a tab or interacting inside it makes it a user reference. Entering a discussion
does not replace an explicitly selected recording, file or source. Leaving research removes only
automatic defaults. Invalid sources remain explicit unavailable states rather than being replaced
with another Session or latest Version.

Replay tool tabs remain runtime-only. The new local preference stores navigation destinations,
not the complete preview layout, viewer URLs, grants, running processes or credentials.

## Discovering saved runs

The existing research preview offers **Session process**, **Run recordings**, **Original records**
and **Source files**. A newly discovered recording list can become the initial view only before
the user has interacted; delayed discovery must not interrupt playback, seeking, reading or scrolling.
The imported Notebook also links to its saved recordings instead of trying to observe an author's Run.

Discovery reuses the source-scoped Replay Artifact catalog. It reads exact receiving Versions in
pages of at most 32 candidates, two 4 KB previews concurrently. Conflicting or out-of-scope identities
are rejected. Matching content is a discovery hint only; the existing main-process reader validates
the full archive and media when opened. Multiple records and Versions are listed separately.
Missing files, incomplete scans and unsupported hosts are disclosed, with retry/continuation actions.
Viewing a recording never starts an experiment. Capture gaps and missing images retain their existing
truthful presentation.

## Asking about a step

Recorded evidence can enter a writable receiving-project draft before it has a Session ID.
The destination consists of project, draft identity and optional Session identity. Live observation
still requires the exact execution Session. A readonly imported source offers an explicit discussion
recovery action that retains the frozen selection and keeps the same archive Viewer open.

The composer owns appending through `appendText(draftKey, text)`. It verifies the active draft and
appends to its current document reference after draft restoration; a stale render cannot overwrite
the destination's saved text. Delivery acknowledges only successful composer acceptance. Navigation
changes, cancelled recovery and closed viewers invalidate pending handoffs. No message is sent.

## Validation and installed acceptance

The source checks include exact routing, cancellation and deferred navigation, ordinary/draft
independence, imported identity isolation, archive discovery limits and stale results, source labels,
recorded-step recovery and a composed draft-restoration regression. The broader workspace run passed
46 files / 1440 tests, with the five opt-in desktop embedding tests skipped in that invocation.
The separately enabled fresh-viewer Electron run passed all five scenarios, including the actual
source bar, real divider, small viewport, foreground capture, resizing and visible-notice rejection.
The eight-locale guard passed 777 checks; module registration guards passed 44 checks.
The nine desktop navigation/replay/project-switching journeys passed across the initial run and
targeted reruns: two assertions were updated for explicitly retained previews, and re-entering
an already-linked research draft exposed a focus bug that was fixed without changing its reference.
Node, sandbox and Web type checks, changed-file lint and module ownership checks also passed.

Before delivery, build the exact reviewed commit through the independent Test maintenance tool,
preserving its configuration/data and pre-install backup. Verify the existing live-07 receiving
research (#84) and ordinary execution Session (#83): saved recording discovery, image readback,
exact-step question into an unsent draft, source labels and ordinary-session navigation. Record
the installed version and results in the Test release's acceptance receipt. Existing experiment
receipts remain immutable; UI acceptance does not count as another scientific experiment.
