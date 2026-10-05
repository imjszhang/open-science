import { create } from 'zustand'
import type { RunObservationSelection } from '../../../shared/run-observation'
import type { RecordedRunObservationSelection } from '../../../shared/run-observation-recorded'

type Destination = { projectId: string; sessionId: string; draftKey: string }
type PendingQuestion = {
  destination: Destination
  selection: RunObservationSelection | RecordedRunObservationSelection
}

// A transient handoff to the existing composer. It never creates a Session or discussion link.
export const useRunObservationQuestionStore = create<{
  destination?: Destination
  pending?: PendingQuestion
  /** Published only after the active composer has actually accepted the frozen evidence. */
  lastAdded?: PendingQuestion
  ask(selection: RunObservationSelection): boolean
  askRecorded(selection: RecordedRunObservationSelection): boolean
}>((set, get) => ({
  askRecorded: (selection) => {
    const destination = get().destination
    if (!destination || destination.projectId !== selection.receiving.projectId) return false
    set({ pending: { destination: { ...destination }, selection: structuredClone(selection) } })
    return true
  },
  ask: (selection) => {
    const destination = get().destination
    if (
      !destination ||
      destination.projectId !== selection.identity.projectId ||
      destination.sessionId !== selection.identity.sessionId
    )
      return false
    set({ pending: { destination: { ...destination }, selection: structuredClone(selection) } })
    return true
  }
}))
