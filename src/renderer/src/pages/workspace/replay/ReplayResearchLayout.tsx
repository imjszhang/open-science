import { Fragment, useId, useLayoutEffect, useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { GroupImperativeHandle } from 'react-resizable-panels'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/ui/resizable'
import { cn } from '@/lib/utils'

export type ResearchReplayLayout = {
  mode: 'tabs' | 'split' | 'columns'
  visiblePaneIds: readonly string[]
  widths?: Record<string, number>
  onWidthsChange?: (widths: Record<string, number>) => void
}

type ResearchReplayPane = { id: string; label: string; content: ReactNode }

const minimumWidth = (id: string): number =>
  id === 'conversation' ? 300 : id === 'notebook' ? 360 : 320

/** Keep one panel tree through fullscreen/tab transitions so resource-owning views stay mounted. */
export const ReplayResearchLayout = ({
  layout,
  materialTabs,
  materialTabPanelId,
  panes,
  focusedPaneId,
  onFocusPane
}: {
  layout: ResearchReplayLayout
  materialTabs?: ReactNode
  materialTabPanelId?: string
  panes: readonly ResearchReplayPane[]
  focusedPaneId?: string
  onFocusPane?: (id: string) => void
}): React.JSX.Element => {
  const { t } = useTranslation()
  const prefix = useId()
  const groupRef = useRef<GroupImperativeHandle>(null)
  const visibleIds = panes
    .filter((pane) => layout.visiblePaneIds.includes(pane.id))
    .map(({ id }) => id)
  if (!visibleIds.length && panes.length) visibleIds.push(panes[0].id)
  const multiple = visibleIds.length > 1
  const panelIds = Object.fromEntries(panes.map(({ id }) => [id, `${prefix}-${id}`]))
  const sizes: Record<string, number> = {}
  const weights = visibleIds.map((id) => {
    const stored = layout.widths?.[id]
    if (typeof stored === 'number' && Number.isFinite(stored) && stored > 0) return stored
    if (layout.mode === 'split' && multiple) return id === 'conversation' ? 35 : 65
    return 1
  })
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  panes.forEach(({ id }) => {
    const index = visibleIds.indexOf(id)
    sizes[panelIds[id]] = index < 0 ? 0 : (weights[index] / total) * 100
  })
  const sizesKey = JSON.stringify(sizes)
  useLayoutEffect(() => {
    groupRef.current?.setLayout(JSON.parse(sizesKey) as Record<string, number>)
  }, [sizesKey, layout.mode])

  return (
    <div
      data-replay-layout-mode={layout.mode}
      className="flex h-full min-h-0 min-w-0 flex-1 overflow-x-auto overflow-y-hidden"
    >
      <ResizablePanelGroup
        groupRef={groupRef}
        orientation="horizontal"
        disabled={!multiple}
        className="min-h-0 shrink-0"
        style={{
          minWidth: multiple
            ? // Leave drag room even when the viewport requires horizontal scrolling.
              visibleIds.reduce((sum, id) => sum + minimumWidth(id), 0) +
              (visibleIds.length - 1) * 81
            : 0
        }}
        onLayoutChanged={(next, { isUserInteraction }) => {
          if (!multiple || !isUserInteraction) return
          const widths = Object.fromEntries(visibleIds.map((id) => [id, next[panelIds[id]] ?? 0]))
          if (Object.values(widths).every((width) => width > 0)) layout.onWidthsChange?.(widths)
        }}
      >
        {panes.map((pane, index) => {
          const visible = visibleIds.includes(pane.id)
          const nextVisible = panes.slice(index + 1).find(({ id }) => visibleIds.includes(id))
          const separatorVisible = visible && Boolean(nextVisible)
          const tabbedMaterial =
            layout.mode === 'split' && pane.id !== 'conversation' && visible && !!materialTabs
          return (
            <Fragment key={pane.id}>
              <ResizablePanel
                id={panelIds[pane.id]}
                defaultSize={`${sizes[panelIds[pane.id]]}%`}
                minSize={!visible ? '0%' : multiple ? `${minimumWidth(pane.id)}px` : '100%'}
                maxSize={visible ? '100%' : '0%'}
                aria-hidden={!visible || undefined}
                inert={!visible || undefined}
                className="h-full min-h-0"
              >
                <section
                  data-replay-pane={pane.id}
                  data-replay-pane-visible={visible}
                  aria-label={pane.label}
                  className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden"
                  onPointerDownCapture={() => visible && onFocusPane?.(pane.id)}
                  onFocusCapture={() => visible && onFocusPane?.(pane.id)}
                >
                  <div
                    data-replay-layout-control=""
                    className={cn(
                      'shrink-0 border-b border-border-200 text-xs font-medium text-text-300',
                      tabbedMaterial ? '' : 'flex h-10 items-center px-3',
                      focusedPaneId === pane.id && 'bg-bg-100 text-text-100',
                      !multiple && 'hidden'
                    )}
                  >
                    {tabbedMaterial ? materialTabs : pane.label}
                  </div>
                  <div
                    id={tabbedMaterial ? materialTabPanelId : undefined}
                    role={tabbedMaterial ? 'tabpanel' : undefined}
                    aria-label={tabbedMaterial ? pane.label : undefined}
                    className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden"
                  >
                    {pane.content}
                  </div>
                </section>
              </ResizablePanel>
              {index < panes.length - 1 ? (
                <ResizableHandle
                  data-replay-layout-control=""
                  data-replay-resize-after={pane.id}
                  aria-label={t('Resize {{left}} and {{right}}', {
                    left: pane.label,
                    right: nextVisible?.label ?? pane.label
                  })}
                  disabled={!separatorVisible}
                  aria-hidden={!separatorVisible}
                  onPointerDown={(event) => {
                    // Preserve the drag when crossing the archived web, video or PDF frame.
                    if (separatorVisible && event.button === 0)
                      event.currentTarget.setPointerCapture(event.pointerId)
                  }}
                  className={separatorVisible ? 'z-20 bg-border-200 after:w-5' : 'hidden'}
                />
              ) : null}
            </Fragment>
          )
        })}
      </ResizablePanelGroup>
    </div>
  )
}
