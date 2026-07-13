import { WebGLMap as RIAMap } from '@luciad/ria/view/WebGLMap.js'
import { FeatureLayer } from '@luciad/ria/view/feature/FeatureLayer.js'
import { ModelFactory } from './ModelFactory'
import { LayerFactory } from './LayerFactory'

export interface AddWfsLayerPayload {
  url: string
  featureType: string
  title: string
  wfst: boolean | null
}

export class LayerBuilder {
  static async addWfsLayer(payload: AddWfsLayerPayload, map: RIAMap): Promise<FeatureLayer> {
    const model = await ModelFactory.createWfsModel(payload.url, payload.featureType, payload.wfst ?? false)
    const layer = LayerFactory.createWfsLayer(model, {
      label: payload.title || payload.featureType,
      selectable: true,
      hoverable: true,
      wfst: payload.wfst ?? false,
    })
    map.layerTree.addChild(layer)
    return layer
  }
}
