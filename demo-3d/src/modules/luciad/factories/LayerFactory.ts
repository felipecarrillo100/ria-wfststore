import {FeatureLayer, type FeatureLayerConstructorOptions} from '@luciad/ria/view/feature/FeatureLayer.js'
import {FeatureModel} from '@luciad/ria/model/feature/FeatureModel.js'
import {LoadSpatially} from '@luciad/ria/view/feature/loadingstrategy/LoadSpatially.js'
import {WFSQueryProvider} from './WFSQueryProvider'
import {ColourfulFeaturePainter} from "../painters/ColourfulFeaturePainter.ts";
import type {OGC3DTilesModel} from "@luciad/ria/model/tileset/OGC3DTilesModel.js";
import {TileSet3DLayer, type TileSet3DLayerConstructorOptions} from "@luciad/ria/view/tileset/TileSet3DLayer.js";

export interface WfsLayerOptions extends FeatureLayerConstructorOptions{
  wfst: boolean
}

/** Module-level registry — layerId → wfst-capable. Consumed in the future WFST editing phase. */
export const layerWfstRegistry = new Map<string, boolean>()

export class LayerFactory {
  static createWfsLayer(model: FeatureModel, options: WfsLayerOptions): FeatureLayer {
    const loadingStrategy = new LoadSpatially({ queryProvider: new WFSQueryProvider(500) })
    // LuciadRIA does not replace existing features on re-query by default; force it so invalidate() actually refreshes edited features.
    loadingStrategy.shouldUpdate = () => true;
    const layer = new FeatureLayer(model, {
      ...options,
      loadingStrategy,
    })
    layerWfstRegistry.set(layer.id, options.wfst);
    layer.painter = new ColourfulFeaturePainter({showLabels: false});
    return layer;
  }

  /**
   * Creates a TileSet3DLayer for OGC 3D Tiles.
   */
  static async create3DTilesLayer(model: OGC3DTilesModel, options?: TileSet3DLayerConstructorOptions): Promise<TileSet3DLayer> {
    return new TileSet3DLayer(model, options as TileSet3DLayerConstructorOptions);
  }
}
