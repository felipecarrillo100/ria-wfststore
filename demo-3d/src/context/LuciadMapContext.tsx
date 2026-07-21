import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from 'react'
import type { ReactNode } from 'react'
import type { RIAMap } from '@luciad/ria/view/RIAMap.js'
import type { FeatureLayer } from '@luciad/ria/view/feature/FeatureLayer.js'
import type { MapCameraState, DrawTool } from '../types/AppState'

interface LuciadMapContextValue {
  maps: Record<string, RIAMap>
  currentlySelectedId: string | null
  currentlySelectedMap: RIAMap | null
  registerMap: (id: string, map: RIAMap) => void
  unregisterMap: (id: string) => void
  setCurrentlySelected: (id: string | null) => void
  setPendingRestoreStates: (states: Record<string, MapCameraState>) => void
  consumePendingState: (id: string) => MapCameraState | undefined
  drawTools: Record<string, DrawTool>
  setDrawTool: (panelId: string, tool: DrawTool) => void
  activeDrawTool: DrawTool
  currentLayers: Record<string, FeatureLayer | null>
  setCurrentLayer: (panelId: string, layer: FeatureLayer | null) => void
  activeCurrentLayer: FeatureLayer | null
}

const LuciadMapContext = createContext<LuciadMapContextValue | null>(null)

export function LuciadMapProvider({ children }: { children: ReactNode }) {
  const [maps, setMaps] = useState<Record<string, RIAMap>>({})
  const [currentlySelectedId, setCurrentlySelectedId] = useState<string | null>(null)
  const [drawTools, setDrawToolsState] = useState<Record<string, DrawTool>>({})
  const [currentLayers, setCurrentLayersState] = useState<Record<string, FeatureLayer | null>>({})
  const pendingRef = useRef<Record<string, MapCameraState>>({})

  const registerMap = useCallback((id: string, map: RIAMap) => {
    setMaps((prev) => ({ ...prev, [id]: map }))
  }, [])

  const unregisterMap = useCallback((id: string) => {
    setMaps((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setCurrentlySelectedId((prev) => (prev === id ? null : prev))
    setDrawToolsState((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
    setCurrentLayersState((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }, [])

  const setCurrentlySelected = useCallback((id: string | null) => {
    setCurrentlySelectedId(id)
  }, [])

  const setPendingRestoreStates = useCallback(
    (states: Record<string, MapCameraState>) => {
      pendingRef.current = states
    },
    [],
  )

  const consumePendingState = useCallback(
    (id: string): MapCameraState | undefined => {
      const state = pendingRef.current[id]
      if (state !== undefined) {
        const next = { ...pendingRef.current }
        delete next[id]
        pendingRef.current = next
      }
      return state
    },
    [],
  )

  const setDrawTool = useCallback((id: string, tool: DrawTool) => {
    setDrawToolsState((prev) => ({ ...prev, [id]: tool }))
  }, [])

  const setCurrentLayer = useCallback((id: string, layer: FeatureLayer | null) => {
    setCurrentLayersState((prev) => ({ ...prev, [id]: layer }))
  }, [])

  const currentlySelectedMap =
    currentlySelectedId != null ? (maps[currentlySelectedId] ?? null) : null

  const activeDrawTool: DrawTool =
    currentlySelectedId != null ? (drawTools[currentlySelectedId] ?? 'select') : 'select'

  const activeCurrentLayer: FeatureLayer | null =
    currentlySelectedId != null ? (currentLayers[currentlySelectedId] ?? null) : null

  const value: LuciadMapContextValue = {
    maps,
    currentlySelectedId,
    currentlySelectedMap,
    registerMap,
    unregisterMap,
    setCurrentlySelected,
    setPendingRestoreStates,
    consumePendingState,
    drawTools,
    setDrawTool,
    activeDrawTool,
    currentLayers,
    setCurrentLayer,
    activeCurrentLayer,
  }

  return (
    <LuciadMapContext.Provider value={value}>
      {children}
    </LuciadMapContext.Provider>
  )
}

export function useLuciadMapContext(): LuciadMapContextValue {
  const ctx = useContext(LuciadMapContext)
  if (!ctx) throw new Error('useLuciadMapContext must be used within LuciadMapProvider')
  return ctx
}
