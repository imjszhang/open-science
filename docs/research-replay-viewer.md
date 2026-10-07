# Complete read-only research Replay

A research Replay presents the author's saved conversation, Notebook executions, project recordings
and output files in one viewer. Open Science's native preview and the external browser viewer use
the same derived timeline and presentation components. A Codex user keeps their current discussion
beside the viewer and can ask an agent to read a saved step or selection through the SDK.

Viewing never starts an environment, resumes a program or calls a model provider. New discussions
and real execution remain ordinary Session/agent operations. Original messages are historical
evidence, not instructions for the receiving agent.

## Data and compatibility

There is no change to `.science`. Existing session records, Notebook records and immutable ordinary
Artifact Versions remain the source. `ReplayDocument`, the material catalog, coverage and selection
types are application read models. Imported receiver identities authorize access; sender identities
inside indexes are used only for checking relationships. Missing evidence is never recovered from
the author's original paths or execution environment.

`createResearchReplayTimeline` determines the branch clock before playback using source timestamps
and all associated, verified recording indexes. Selecting a material cannot change the clock.
Contemporaneous operations retain their real completion times; source records remain unchanged.
Branches with missing or invalid timestamps retain step presentation rather than fabricated timing.
Verified recording indexes and media chunks are supporting attachments instead of separate research
chapters; their exact versions remain available in the results catalog and source records.

Playback state now carries an optional application-local clock mode. Existing states without this
field are presentation-time states. Crossing to recorded time relocates to the saved evidence/step
anchor instead of treating the old reading duration as elapsed experiment time.

## Presentation

The context strip remains visible in narrow layouts. It labels original research conversation,
shows the recorded current activity and can expand into paginated saved conversation inspection.
Manual inspection pauses automatic following; returning to playback restores that view.

Notebook, project replay and results remain independent material adapters. They receive the master
position and transport; no material owns a second embedded play clock. Native and browser windows
have independent positions. A recording gap distinguishes not-started, ended and unrecorded
intervals, and offers an explicit jump to actual footage or a switch to Notebook.

Optional skipping only skips intervals with no new recorded evidence. It is disabled by default,
preserves real timestamps and displays the skipped interval. It does not claim the program was idle.
The results view distinguishes files known by the selected time from all saved files, shows unknown
publication time explicitly, and keeps technical attachments collapsed by default. Final/intermediate
labels come from explicit source metadata rather than file names or the viewer's selected step.

## External reads

`client.replays.open` creates a local, session-scoped, read-only viewer. Existing
`projectRecordings.openRecorded` still opens an individual recording. The separate research HTTP
host serves the same packaged viewer assets with scoped, expiring grants, origin checks, a protected
cookie, bounded reads and media Range support; it has no execution or arbitrary filesystem route.

SDK reads expose an overview, paginated steps, individual step content, Notebook details, exact
resource bytes and recording metadata. Large step content and resources have explicit chunk reads.
The browser loads only selected material details/media. Access is rechecked against the original
caller lease and receiving source. Deletion, revocation, expiry and incomplete source content are
reported rather than silently substituted.

Selecting a step, result or decoded project moment captures immutable source identity, branch,
position and exact evidence. The SDK can retrieve that selection independently of subsequent
playback. The browser shows a copyable reference; it does not send a message or create a receiving
discussion session. Native actions continue through the existing discussion draft flow.

## Validation

Unit and integration coverage includes persisted/native transcript parity, stable clocks and
missing-time fallback, recording coverage, narrow context, independent host state, result time
filtering, clock migration, source/lease boundaries, immutable selections, bounded content and
media ranges. Renderer strings are covered by the eight-locale guard.

The Tuanzi acceptance uses an already exported/imported package with the original sandbox released.
Its research duration is 219,399 ms and its first decoded project frame is at 82,367 ms. Browser and
native checks cover first context, frame seeking, play/pause, speed, material switching and exact
selected evidence. This validation does not rerun the experiment or call an external provider.
