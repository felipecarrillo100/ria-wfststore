import {FeatureLayer, type FeatureLayerConstructorOptions} from '@luciad/ria/view/feature/FeatureLayer.js'
import { FeatureModel } from '@luciad/ria/model/feature/FeatureModel.js'
import { LoadSpatially } from '@luciad/ria/view/feature/loadingstrategy/LoadSpatially.js'
import { WFSQueryProvider } from './WFSQueryProvider'
import {ColourfulFeaturePainter} from "../painters/ColourfulFeaturePainter.ts";

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
}
