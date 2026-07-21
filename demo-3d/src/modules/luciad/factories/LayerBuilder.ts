import { RIAMap } from '@luciad/ria/view/RIAMap.js'
import { FeatureLayer } from '@luciad/ria/view/feature/FeatureLayer.js'
import type { WFSTFeatureLockStore } from 'ria-wfststore'
import { ModelFactory } from './ModelFactory'
import { LayerFactory } from './LayerFactory'
import { createLockedLayer } from '../wfst/EditWithLockHelper'
import type {TileSet3DLayer} from "@luciad/ria/view/tileset/TileSet3DLayer.js";

export interface AddWfsLayerPayload {
  url: string;
  featureType: string;
  title: string;
  wfst: boolean | null;
}

export interface Add3DTilesPayload {
  url: string;
  title: string;
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

  static addLockLayer(lockStore: WFSTFeatureLockStore, label: string, map: RIAMap): FeatureLayer {
    const layer = createLockedLayer(lockStore, label)
    map.layerTree.addChild(layer)
    return layer
  }

  static async add3DTileLayer(payload: Add3DTilesPayload, map: RIAMap):  Promise<TileSet3DLayer>{
    const model = await ModelFactory.create3DTilesModel({url: payload.url})
    const layer = await LayerFactory.create3DTilesLayer(model, {
      label: payload.title
    })
    map.layerTree.addChild(layer)
    return layer
  }
}
