import { BasicCreateController } from '@luciad/ria/view/controller/BasicCreateController.js'
import { ShapeType } from '@luciad/ria/shape/ShapeType.js'
import { createCircularArcByCenterPoint, createPoint } from '@luciad/ria/shape/ShapeFactory.js'
import { Feature } from '@luciad/ria/model/feature/Feature.js'
import { FeatureLayer } from '@luciad/ria/view/feature/FeatureLayer.js'
import { LayerGroup } from '@luciad/ria/view/LayerGroup.js'
import { LayerTreeNodeType } from '@luciad/ria/view/LayerTreeNodeType.js'
import { WFSTFeatureStore } from 'ria-wfststore'
import type { Controller } from '@luciad/ria/view/controller/Controller.js'
import type { RIAMap } from '@luciad/ria/view/RIAMap.js'
import type { DrawTool } from '../../../types/AppState'

const SHAPE_TYPE_MAP = {
  point: ShapeType.POINT,
  line: ShapeType.POLYLINE,
  polygon: ShapeType.POLYGON,
  // Both 'arc' and 'circle' create a CircularArcByCenterPoint (single radius, structurally
  // circular by construction) - NOT the generic elliptical Arc (ShapeType.ARC). Arc's default
  // interactive editor lets a user drag its a/b semi-axes independently into a genuine ellipse,
  // which this library's GML encoder then rejects (no standard GML 3.2 representation for a !== b).
  // CircularArcByCenterPointEditor has no such failure mode. See AppState.ts's DrawTool comment for
  // why this demo also never creates a true Circle shape.
  arc: ShapeType.CIRCULAR_ARC_BY_CENTER_POINT,
  circle: ShapeType.CIRCULAR_ARC_BY_CENTER_POINT,
} as const

// Default placeholder radius before the user's first click repositions/resizes the shape - same
// role as ShapeFactory.createShape's own defaults for Point/Polygon/Polyline (an arbitrary,
// throwaway starting value, not a meaningful default size).
const DEFAULT_ARC_RADIUS = 5

export function createDrawController(
  tool: Exclude<DrawTool, 'select'>,
  getLayer: () => FeatureLayer | null,
): BasicCreateController {
  const ctrl = new BasicCreateController(SHAPE_TYPE_MAP[tool])
  ;(ctrl as any).__drawTool = tool
  ctrl.onChooseLayer = () => getLayer()
  if (tool === 'arc' || tool === 'circle') {
    // Always structurally circular (single radius, no a/b to mismatch) - see SHAPE_TYPE_MAP's
    // comment for why CircularArcByCenterPoint replaces the generic Arc here. 'circle' starts at a
    // full 360-degree sweep so it reads as a circle in the UI and round-trips through GML as one
    // (see AppState.ts); the user can still drag it into a partial arc afterward like any other
    // CircularArcByCenterPoint shape.
    const sweepAngle = tool === 'circle' ? 360 : 90
    ctrl.onCreateNewObject = (_map, layer) => {
      const reference = (layer.model as any).reference
      const center = createPoint(reference, [0, 0])
      return new Feature(createCircularArcByCenterPoint(reference, center, DEFAULT_ARC_RADIUS, 0, sweepAngle), {})
    }
  }
  return ctrl
}

export function getDrawToolFromController(ctrl: Controller | null): DrawTool {
  if (!ctrl) return 'select'
  const tag = (ctrl as any).__drawTool
  if (tag === 'point' || tag === 'line' || tag === 'polygon' || tag === 'arc' || tag === 'circle') return tag as DrawTool
  return 'select'
}

// Depth-first walk; returns first FeatureLayer backed by WFSTFeatureStore
export function findFirstEditableLayer(map: RIAMap): FeatureLayer | null {
  function walk(node: any): FeatureLayer | null {
    if (node.treeNodeType === LayerTreeNodeType.LAYER_GROUP) {
      for (const child of (node as LayerGroup).children) {
        const found = walk(child)
        if (found) return found
      }
    } else if (node instanceof FeatureLayer) {
      const store = (node.model as any)?.store
      if (store instanceof WFSTFeatureStore) return node
    }
    return null
  }
  return walk(map.layerTree)
}
