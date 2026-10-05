import type { RunObservationTarget } from './run-observation'

export type OpenRunObservationViewer = {
  target: RunObservationTarget
  allowInteraction?: boolean
  allowCancel?: boolean
  allowCapture?: boolean
}
export type RunObservationViewerAccess = {
  viewerId: string
  target: RunObservationTarget
  expiresAt: number
  url: string
}
export type RunObservationViewerReference = { viewerId: string }

export type OpenRecordedObservationViewer = {
  target: import('./run-observation-recorded').RecordedObservationTarget
}
export type RecordedObservationViewerAccess = {
  mode: 'recorded'
  viewerId: string
  target: import('./run-observation-recorded').RecordedObservationTarget
  expiresAt: number
  url: string
}
