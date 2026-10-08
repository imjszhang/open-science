import { createContext, useContext, useLayoutEffect, useMemo, useRef, type ReactNode } from 'react'

/** Presentation-only action. Evidence capture and delivery stay with the material owner. */
export type ReplayMaterialAction = {
  label: string
  /** Exact selected record timestamp; never substitute the research playhead. */
  recordedAt?: number
  title?: string
  disabled?: boolean
  pending?: boolean
  onAsk: () => void
}

type Registration = {
  register: (owner: symbol, action: ReplayMaterialAction | undefined) => void
}
const MaterialActionContext = createContext<Registration | null>(null)

export function ReplayMaterialActionProvider({
  enabled = true,
  onActionChange,
  children
}: {
  enabled?: boolean
  onActionChange: (action: ReplayMaterialAction | undefined) => void
  children: ReactNode
}): React.JSX.Element {
  const callback = useRef(onActionChange)
  useLayoutEffect(() => {
    callback.current = onActionChange
  }, [onActionChange])
  const owner = useRef<symbol | undefined>(undefined)
  const value = useMemo<Registration>(
    () => ({
      register: (nextOwner, action) => {
        if (action) {
          owner.current = nextOwner
          callback.current(action)
        } else if (owner.current === nextOwner) {
          owner.current = undefined
          callback.current(undefined)
        }
      }
    }),
    []
  )
  return (
    <MaterialActionContext.Provider value={enabled ? value : null}>
      {children}
    </MaterialActionContext.Provider>
  )
}

/** Keep the event current without publishing a new parent state on every playback tick. */
// Context provider and its consumer hook are intentionally colocated.
// eslint-disable-next-line react-refresh/only-export-components
export function useReplayMaterialAction(action: ReplayMaterialAction | undefined): boolean {
  const context = useContext(MaterialActionContext)
  const latest = useRef(action)
  useLayoutEffect(() => {
    latest.current = action
  })
  const owner = useRef(Symbol('replay-material'))
  const present = Boolean(action)
  const label = action?.label
  const disabled = action?.disabled
  const pending = action?.pending
  const recordedAt = action?.recordedAt
  const title = action?.title
  useLayoutEffect(() => {
    if (!context || !present || !label) return
    const identity = owner.current
    context.register(identity, {
      label,
      disabled,
      pending,
      recordedAt,
      title,
      onAsk: () => {
        const current = latest.current
        if (current && !current.disabled && !current.pending) current.onAsk()
      }
    })
    return () => context.register(identity, undefined)
  }, [context, present, label, disabled, pending, recordedAt, title])
  return context !== null
}
