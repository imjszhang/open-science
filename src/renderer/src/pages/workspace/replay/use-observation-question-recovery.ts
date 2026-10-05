import { useTranslation } from 'react-i18next'
import { useSessionStore } from '@/stores/session-store'
import { useNavigationStore } from '@/stores/navigation-store'
import {
  openResearchWorkspace,
  researchSourceFromSession
} from '../workspace-discussion-navigation'

export type ObservationQuestionRecovery = { label: string; onClick: () => void | Promise<void> }

/** A deliberate recovery action reuses the existing research/Session navigation and its guards. */
export const useObservationQuestionRecovery = (target?: {
  projectId: string
  sessionId: string
}): ObservationQuestionRecovery | undefined => {
  const { t } = useTranslation()
  const session = useSessionStore((state) =>
    state.sessions.find(
      (item) =>
        item.projectId === target?.projectId &&
        item.id === target?.sessionId &&
        !item.isPending &&
        item.archivedAt === undefined
    )
  )
  const source = researchSourceFromSession(session)
  if (!session || !target) return undefined
  return source
    ? {
        label: t('Discuss'),
        onClick: async () => {
          if (!(await openResearchWorkspace(source)))
            throw new Error('Research discussion is unavailable.')
        }
      }
    : {
        label: t('Open source Session'),
        onClick: () => {
          useNavigationStore.getState().openSession(target.projectId, target.sessionId, 'user')
        }
      }
}
