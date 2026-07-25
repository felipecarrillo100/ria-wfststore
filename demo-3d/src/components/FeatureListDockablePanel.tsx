import { useEffect, useState } from 'react'
import { usePanelId } from 'react-dockable-desktop'
import { getFeatureListTarget, clearFeatureListTarget } from '../featureListRegistry'
import { FeatureListPanel } from './FeatureListPanel'

// Registered in workspace.ts as the 'feature-list' panel type. Reads its target (which layer,
// which map to zoom on) from featureListRegistry, written by MapLayersComponent right before
// openPanel() is called - see that registry module for why this indirection exists.
export function FeatureListDockablePanel() {
  const panelId = usePanelId()
  const [target] = useState(() => getFeatureListTarget(panelId))

  useEffect(() => {
    return () => clearFeatureListTarget(panelId)
  }, [panelId])

  if (!target) return null
  return <FeatureListPanel layer={target.layer} panelId={target.mapPanelId} />
}
