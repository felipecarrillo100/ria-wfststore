import { BasicCreateController } from '@luciad/ria/view/controller/BasicCreateController.js'
import { ShapeType } from '@luciad/ria/shape/ShapeType.js'
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
} as const

export function createDrawController(
  tool: Exclude<DrawTool, 'select'>,
  getLayer: () => FeatureLayer | null,
): BasicCreateController {
  const ctrl = new BasicCreateController(SHAPE_TYPE_MAP[tool])
  ;(ctrl as any).__drawTool = tool
  ctrl.onChooseLayer = () => getLayer()
  return ctrl
}

export function getDrawToolFromController(ctrl: Controller | null): DrawTool {
  if (!ctrl) return 'select'
  const tag = (ctrl as any).__drawTool
  if (tag === 'point' || tag === 'line' || tag === 'polygon') return tag as DrawTool
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

// A cached "current layer" can be stale-typed (e.g. a non-FeatureLayer node cast to FeatureLayer
// at selection time) - instanceof checks the real runtime prototype chain, so it can't be fooled
// by that cast. Falls back to the tree walk when the cached value isn't actually a FeatureLayer.
export function resolveTargetLayer(map: RIAMap, cachedLayer: FeatureLayer | null): FeatureLayer | null {
  if (cachedLayer instanceof FeatureLayer) return cachedLayer
  return findFirstEditableLayer(map)
}
