// @vitest-environment jsdom
import { useEffect, useImperativeHandle, type ReactNode, type Ref } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ReplayResearchLayout, type ResearchReplayLayout } from './ReplayResearchLayout'

const setLayout = vi.hoisted(() => vi.fn())
vi.mock('@/components/ui/resizable', () => ({
  ResizablePanelGroup: ({
    children,
    groupRef
  }: {
    children: ReactNode
    groupRef: Ref<unknown>
  }) => {
    useImperativeHandle(groupRef, () => ({ setLayout }))
    return <div>{children}</div>
  },
  ResizablePanel: ({ children, inert }: { children: ReactNode; inert?: boolean }) => (
    <div inert={inert}>{children}</div>
  ),
  ResizableHandle: ({ disabled, ...props }: { disabled: boolean }) => (
    <div {...props} data-disabled={disabled} />
  )
}))

afterEach(() => {
  cleanup()
  vi.clearAllMocks()
})

describe('ReplayResearchLayout', () => {
  it('preserves content owners across tabs, split and columns and makes hidden content inert', () => {
    const mounts = vi.fn()
    const unmounts = vi.fn()
    const Content = ({ id }: { id: string }): React.JSX.Element => {
      useEffect(() => {
        mounts(id)
        return () => unmounts(id)
      }, [id])
      return <input aria-label={`${id} note`} defaultValue="retained" />
    }
    const panes = ['conversation', 'notebook', 'project', 'results'].map((id) => ({
      id,
      label: id,
      content: <Content id={id} />
    }))
    const view = render(
      <ReplayResearchLayout layout={{ mode: 'tabs', visiblePaneIds: ['notebook'] }} panes={panes} />
    )
    const notebook = screen.getByLabelText('notebook note') as HTMLInputElement
    const conversation = screen.getByLabelText('conversation note')
    expect(conversation.closest('[inert]')).not.toBeNull()
    fireEvent.change(notebook, { target: { value: 'Reading an earlier run' } })
    const modes: ResearchReplayLayout[] = [
      { mode: 'split', visiblePaneIds: ['conversation', 'notebook'] },
      { mode: 'columns', visiblePaneIds: panes.map(({ id }) => id) },
      { mode: 'tabs', visiblePaneIds: ['project'] },
      { mode: 'split', visiblePaneIds: ['conversation', 'notebook'] }
    ]
    for (const layout of modes)
      view.rerender(<ReplayResearchLayout layout={layout} panes={panes} />)
    expect(screen.getByLabelText('notebook note')).toBe(notebook)
    expect(notebook.value).toBe('Reading an earlier run')
    expect(conversation.closest('[inert]')).toBeNull()
    expect(mounts).toHaveBeenCalledTimes(4)
    expect(unmounts).not.toHaveBeenCalled()
    const finalSizes = Object.values(setLayout.mock.lastCall![0] as Record<string, number>)
    expect(finalSizes).toEqual([35, 65, 0, 0])
  })

  it('changes the question focus only on explicit interaction with a visible pane', () => {
    const onFocusPane = vi.fn()
    const panes = ['conversation', 'notebook'].map((id) => ({
      id,
      label: id,
      content: <button>{id}</button>
    }))
    const view = render(
      <ReplayResearchLayout
        layout={{ mode: 'tabs', visiblePaneIds: ['conversation'] }}
        panes={panes}
        onFocusPane={onFocusPane}
      />
    )
    expect(onFocusPane).not.toHaveBeenCalled()
    fireEvent.pointerDown(screen.getByRole('button', { name: 'conversation' }))
    expect(onFocusPane).toHaveBeenLastCalledWith('conversation')
    onFocusPane.mockClear()
    view.rerender(
      <ReplayResearchLayout
        layout={{ mode: 'split', visiblePaneIds: ['conversation', 'notebook'] }}
        panes={panes}
        onFocusPane={onFocusPane}
      />
    )
    expect(onFocusPane).not.toHaveBeenCalled()
    fireEvent.focus(screen.getByRole('button', { name: 'notebook' }))
    expect(onFocusPane).toHaveBeenCalledWith('notebook')
  })
})
