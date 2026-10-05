import { useEffect, useLayoutEffect } from 'react'
import { useRunObservationQuestionStore } from '@/stores/run-observation-question-store'
import type { ComposerDoc } from './composer/composer-doc'
import { observationQuestionText } from './replay/observation-question'
import { requestComposerFocus } from './composer-focus-events'

export const useRunObservationQuestion = ({
  projectId,
  sessionId,
  draftKey,
  editable,
  doc,
  changeDoc
}: {
  projectId?: string
  sessionId?: string
  draftKey: string
  editable: boolean
  doc: ComposerDoc
  changeDoc(doc: ComposerDoc): void
}): void => {
  const pending = useRunObservationQuestionStore((state) => state.pending)
  useLayoutEffect(() => {
    const destination =
      editable && projectId && sessionId ? { projectId, sessionId, draftKey } : undefined
    useRunObservationQuestionStore.setState({ destination, lastAdded: undefined })
    return () => {
      if (useRunObservationQuestionStore.getState().destination === destination)
        useRunObservationQuestionStore.setState({
          destination: undefined,
          pending: undefined,
          lastAdded: undefined
        })
    }
  }, [projectId, sessionId, draftKey, editable])
  useEffect(() => {
    if (!pending || useRunObservationQuestionStore.getState().pending !== pending) return
    useRunObservationQuestionStore.setState({ pending: undefined })
    if (
      !editable ||
      pending.destination.projectId !== projectId ||
      pending.destination.sessionId !== sessionId ||
      pending.destination.draftKey !== draftKey
    )
      return
    changeDoc({
      nodes: [...doc.nodes, { type: 'text', text: observationQuestionText(pending.selection) }]
    })
    useRunObservationQuestionStore.setState({ lastAdded: pending })
    requestComposerFocus()
  }, [pending, projectId, sessionId, draftKey, editable, doc, changeDoc])
}
