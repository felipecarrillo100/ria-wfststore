import type { FeatureLayer } from '@luciad/ria/view/feature/FeatureLayer.js'

// openPanel() takes a registered component *type key*, not a component instance, so per-instance
// data (which layer, which map panel to zoom on) can't travel through its call directly. This is
// the side-channel: write the target here right before opening the panel, the panel's own wrapper
// reads it back (keyed by its own panel id, from usePanelId()) on mount.
interface FeatureListTarget {
  layer: FeatureLayer
  mapPanelId: string
}

const registry = new Map<string, FeatureListTarget>()

export function registerFeatureListTarget(panelId: string, target: FeatureListTarget): void {
  registry.set(panelId, target)
}

export function getFeatureListTarget(panelId: string): FeatureListTarget | undefined {
  return registry.get(panelId)
}

export function clearFeatureListTarget(panelId: string): void {
  registry.delete(panelId)
}
