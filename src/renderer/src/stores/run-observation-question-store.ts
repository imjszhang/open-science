import { create } from 'zustand'
import type { RunObservationSelection } from '../../../shared/run-observation'
import type { RecordedRunObservationSelection } from '../../../shared/run-observation-recorded'

export type ObservationQuestionDestination = {
  projectId: string
  sessionId?: string
  draftKey: string
}
export type ObservationQuestionSelection = RunObservationSelection | RecordedRunObservationSelection
type PendingQuestion = {
  destination: ObservationQuestionDestination
  selection: ObservationQuestionSelection
  /** A guarded navigation can finish before its composer mounts. Never retain that intent
   * after another navigation has replaced the destination. */
  isCurrent?: () => boolean
}

export const sameObservationQuestionDestination = (
  left: ObservationQuestionDestination | undefined,
  right: ObservationQuestionDestination | undefined
): boolean =>
  Boolean(
    left &&
    right &&
    left.projectId === right.projectId &&
    left.sessionId === right.sessionId &&
    left.draftKey === right.draftKey
  )

const acceptsSelection = (
  destination: ObservationQuestionDestination | undefined,
  selection: ObservationQuestionSelection
): boolean =>
  Boolean(
    destination &&
    ('snapshot' in selection
      ? destination.projectId === selection.identity.projectId &&
        destination.sessionId === selection.identity.sessionId
      : destination.projectId === selection.receiving.projectId)
  )

// A transient handoff to the existing composer. It never creates a Session or discussion link.
export const useRunObservationQuestionStore = create<{
  destination?: ObservationQuestionDestination
  pending?: PendingQuestion
  /** Published only after the active composer has actually accepted the frozen evidence. */
  lastAdded?: PendingQuestion
  ask(selection: RunObservationSelection): boolean
  askRecorded(selection: RecordedRunObservationSelection): boolean
  recover(
    selection: ObservationQuestionSelection,
    destination: ObservationQuestionDestination,
    isCurrent: () => boolean
  ): boolean
}>((set, get) => ({
  recover: (selection, destination, isCurrent) => {
    if (!isCurrent() || !acceptsSelection(destination, selection)) return false
    if (
      selection.selectionId &&
      [get().pending, get().lastAdded].some(
        (previous) =>
          previous &&
          previous.selection.selectionId === selection.selectionId &&
          sameObservationQuestionDestination(previous.destination, destination)
      )
    )
      return true
    set({
      pending: { destination: { ...destination }, selection: structuredClone(selection), isCurrent }
    })
    return true
  },
  askRecorded: (selection) => {
    const destination = get().destination
    if (!destination || !acceptsSelection(destination, selection)) return false
    set({ pending: { destination: { ...destination }, selection: structuredClone(selection) } })
    return true
  },
  ask: (selection) => {
    const destination = get().destination
    if (!destination || !acceptsSelection(destination, selection)) return false
    set({ pending: { destination: { ...destination }, selection: structuredClone(selection) } })
    return true
  }
}))
