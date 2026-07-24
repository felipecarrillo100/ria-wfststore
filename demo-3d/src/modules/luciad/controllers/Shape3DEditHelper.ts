import { Shape3DEditController } from 'ria-3d-shape-editor'
import type { EditableShape, SupportedShapeType } from 'ria-3d-shape-editor'
import { ShapeType } from '@luciad/ria/shape/ShapeType.js'
import { FeatureLayer } from '@luciad/ria/view/feature/FeatureLayer.js'
import { Feature } from '@luciad/ria/model/feature/Feature.js'
import { WFSTFeatureStore } from 'ria-wfststore'
import type { Controller } from '@luciad/ria/view/controller/Controller.js'
import type { RIAMap } from '@luciad/ria/view/RIAMap.js'
import type { PickInfo } from '@luciad/ria/view/PickInfo.js'
import type { DrawTool } from '../../../types/AppState'

const SHAPE_TYPE_MAP = {
  point3d: ShapeType.POINT,
  line3d: ShapeType.POLYLINE,
  polygon3d: ShapeType.POLYGON,
} as const

export type ThreeDEditTool = keyof typeof SHAPE_TYPE_MAP

export function isEdit3DGeometrySupported(shapeType: ShapeType): boolean {
  return shapeType === ShapeType.POINT || shapeType === ShapeType.POLYLINE || shapeType === ShapeType.POLYGON
}

// FeatureLayer.setEditedObject exists at runtime (confirmed by reading the actual RIA source -
// it's what forces the layer to re-tessellate a feature live instead of using a stale cached
// snapshot, the same mechanism stock EditController uses internally) but isn't declared in RIA's
// public .d.ts. This gives the call site a real, minimal, honest typed contract instead of
// sprinkling `as any` at every call.
function setEditedObject(layer: FeatureLayer, feature: Feature | null): void {
  (layer as unknown as { setEditedObject(f: Feature | null): void }).setEditedObject(feature)
}

// This is where WFS-T awareness lives for the 3D editor - ria-3d-shape-editor itself has zero
// knowledge of WFS-T or any other backend; it only mutates the shape it creates and emits events.
export function create3DEditController(tool: ThreeDEditTool, layer: FeatureLayer): Shape3DEditController {
  const ctrl = new Shape3DEditController(SHAPE_TYPE_MAP[tool], layer)
  ;(ctrl as any).__drawTool = tool

  // Persist only on confirmed finish (the checkmark handle) - never on ShapeCreated. The shape
  // lives only inside the controller until the user explicitly confirms; Cancel/Escape/any other
  // deactivation is confirmed:false and must never reach the store.
  ctrl.on('ShapeEditingFinished', ({ shape, confirmed }) => {
    if (!confirmed) return
    const feature = new Feature(shape, {})
    const store = (layer.model as any)?.store
    if (store instanceof WFSTFeatureStore) {
      Promise.resolve(store.add(feature)).catch((err: unknown) => console.error('WFS-T add failed:', err))
    } else {
      // Not .put(): a brand-new feature has no id yet, and WFSTFeatureLockStore.put() only
      // records a pending edit when it finds a matching existing entry by id - for a new
      // feature it finds none, so the shape would render locally (super.put() still adds it to
      // the in-memory store) but never get queued into insertedIds, and would be silently
      // dropped from the eventual WFS-T commit. .add() is what actually queues it.
      Promise.resolve(layer.model.add(feature)).catch((err: unknown) => console.error('add failed:', err))
    }
  })

  return ctrl
}

// Edit-in-place path (invoked from the "Edit 3D geometry" context menu item, not a toolbar tool):
// the controller starts directly in edit mode on the feature's own existing shape (mutated in
// place - see Shape3DEditController's existingShape constructor path). Confirming persists via
// store.put() (an update, preserving the feature's id/properties) rather than store.add() - this
// is the one real difference from create3DEditController.
//
// layer.setEditedObject(feature) is REQUIRED here, not optional polish: LuciadRIA's FeatureLayer
// only re-tessellates a feature's rendering live when it's flagged as the layer's _editedObject -
// otherwise it keeps drawing a cached, stale (pre-edit) snapshot no matter how many times the
// controller mutates the shape in place and invalidates. This is exactly the mechanism stock
// EditController itself uses internally for the same reason. Clearing it back to null is
// deliberately sequenced differently on confirm vs. cancel/anything-else:
// - Cancel/Escape/other: cancel() has ALREADY reverted the shape in place by the time
//   ShapeEditingFinished fires, and nothing was ever sent to the server, so it's safe to clear
//   setEditedObject immediately - there is nothing stale to race against.
// - Confirm: store.put() is async: the layer's own cached snapshot only refreshes once the WFS-T
//   round trip completes and the store emits its own change event. Clearing setEditedObject
//   immediately (synchronously, before that completes) would cause a visible snap-back-to-stale
//   flash for the network-latency-sized window until the store's event lands. So it's only
//   cleared once the persist promise settles, success or failure.
export function edit3DGeometryController(feature: Feature, layer: FeatureLayer): Shape3DEditController | null {
  const shape = feature.shape
  if (!shape || !isEdit3DGeometrySupported(shape.type)) return null

  const shapeType = shape.type as SupportedShapeType
  const ctrl = new Shape3DEditController(shapeType, layer, { existingShape: shape as EditableShape })

  // Selection is a map/app concern, not something the backend-agnostic ria-3d-shape-editor
  // package should own - capture whatever was selected before this session and restore it
  // exactly on end (possibly nothing, possibly an unrelated feature/layer), regardless of how
  // the session ended.
  let previousSelection: PickInfo[] = []

  ctrl.on('Activated', (map: RIAMap) => {
    setEditedObject(layer, feature)
    previousSelection = map.selectedObjects.map(s => ({ layer: s.layer, objects: s.selected as Feature[] } as PickInfo))
    map.selectObjects([{ layer, objects: [feature] }])
  })

  ctrl.on('Deactivated', (map: RIAMap) => {
    if (previousSelection.length > 0) map.selectObjects(previousSelection)
    else map.clearSelection()
  })

  ctrl.on('ShapeEditingFinished', ({ shape, confirmed }) => {
    if (!confirmed) {
      setEditedObject(layer, null)
      return
    }
    const updated = new Feature(shape, feature.properties, feature.id)
    const store = (layer.model as any)?.store
    const persist = store instanceof WFSTFeatureStore ? store.put(updated) : layer.model.put(updated)
    Promise.resolve(persist)
      .catch((err: unknown) => console.error('WFS-T update failed:', err))
      .finally(() => setEditedObject(layer, null))
  })

  return ctrl
}

export function getShape3DEditToolFromController(ctrl: Controller | null): DrawTool | null {
  if (!ctrl) return null
  const tag = (ctrl as any).__drawTool
  if (tag === 'point3d' || tag === 'line3d' || tag === 'polygon3d') return tag as DrawTool
  return null
}
