// @vitest-environment jsdom
import { cleanup, renderHook } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { useSessionStore, type ChatSession } from '@/stores/session-store'
import { useNavigationStore } from '@/stores/navigation-store'
import * as navigation from '../workspace-discussion-navigation'
import { useObservationQuestionRecovery } from './use-observation-question-recovery'
const source: ChatSession = {
  id: 'source',
  projectId: 'project',
  title: 'Research',
  cwd: '',
  status: 'idle',
  messages: [],
  createdAt: 1,
  updatedAt: 1,
  packageOrigin: {
    importId: 'import',
    sourceProjectId: 'author',
    sourceSessionId: 'author-session',
    importedAt: 1,
    manifestChecksum: 'a'.repeat(64)
  }
}
afterEach(() => {
  cleanup()
  useSessionStore.setState({ sessions: [] })
  vi.restoreAllMocks()
})
it('uses the existing Discuss navigation only on an explicit recovery action', async () => {
  useSessionStore.setState({ sessions: [source] })
  const discuss = vi.spyOn(navigation, 'openResearchWorkspace').mockResolvedValue(true)
  const { result } = renderHook(() =>
    useObservationQuestionRecovery({ projectId: 'project', sessionId: 'source' })
  )
  expect(result.current?.label).toBe('Discuss')
  expect(discuss).not.toHaveBeenCalled()
  await result.current!.onClick()
  expect(discuss).toHaveBeenCalledExactlyOnceWith({
    sourceProjectId: 'project',
    sourceSessionId: 'source',
    sourceImportId: 'import',
    sourceTitle: 'Research'
  })
})
it('keeps ordinary Sessions on existing navigation and does not expose a foreign source', () => {
  useSessionStore.setState({ sessions: [{ ...source, packageOrigin: undefined }] })
  const navigate = vi.spyOn(useNavigationStore.getState(), 'openSession').mockReturnValue(true)
  const { result, rerender } = renderHook(
    ({ projectId }) => useObservationQuestionRecovery({ projectId, sessionId: 'source' }),
    { initialProps: { projectId: 'project' } }
  )
  expect(result.current?.label).toBe('Open source Session')
  result.current!.onClick()
  expect(navigate).toHaveBeenCalledExactlyOnceWith('project', 'source', 'user')
  rerender({ projectId: 'other' })
  expect(result.current).toBeUndefined()
})
