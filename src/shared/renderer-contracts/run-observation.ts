import type { RecordedRunObservationSelection } from '../run-observation-recorded'
import type { RunObservationSelection, RunObservationTarget } from '../run-observation'
import type { RunObservationRecordingStatus } from '../run-observation-recording-status'
import type {
  OpenRecordedObservationViewer,
  RecordedObservationViewerAccess,
  OpenRunObservationViewer,
  RunObservationViewerAccess,
  RunObservationViewerReference
} from '../run-observation-viewer'
import { callable, ELECTRON } from './definition'

// The scoped observation IPC adapter owns validation and caller leases. These are not
// ApplicationCommand router methods; marking them as such installs a second owner.
export const contracts = {
  'observations.recordingStatus': callable<
    (request: { target: RunObservationTarget }) => Promise<RunObservationRecordingStatus>
  >()('run-observation', ['run-observation:recordingStatus', ELECTRON]),
  'observations.openRecorded': callable<
    (request: OpenRecordedObservationViewer) => Promise<RecordedObservationViewerAccess>
  >()('run-observation', ['run-observation:openRecorded', ELECTRON]),
  'observations.recordingSelection': callable<
    (request: RunObservationViewerReference) => Promise<RecordedRunObservationSelection | null>
  >()('run-observation', ['run-observation:recordingSelection', ELECTRON]),
  'observations.open': callable<
    (request: OpenRunObservationViewer) => Promise<RunObservationViewerAccess>
  >()('run-observation', ['run-observation:open', ELECTRON]),
  'observations.selection': callable<
    (request: RunObservationViewerReference) => Promise<RunObservationSelection | null>
  >()('run-observation', ['run-observation:selection', ELECTRON]),
  'observations.revoke': callable<(request: RunObservationViewerReference) => Promise<void>>()(
    'run-observation',
    ['run-observation:revoke', ELECTRON]
  )
} as const
