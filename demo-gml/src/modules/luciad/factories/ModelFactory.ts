import { WFSFeatureStore } from '@luciad/ria/model/store/WFSFeatureStore.js'
import { FeatureModel } from '@luciad/ria/model/feature/FeatureModel.js'
import { WFSTFeatureStore, AdvancedGMLCodec } from 'ria-wfststore'

// GML, not the default GeoJSON - GeoJSON can't represent Circle/Arc at all (RIA's own
// GeoJsonCodec throws outright on them), so this demo can't showcase native curve encoding
// without it. AdvancedGMLCodec both encodes and decodes; RIA's own GMLCodec can only decode.
const GML_OUTPUT_FORMAT = 'application/gml+xml; version=3.2'

export class ModelFactory {
  static async createWfsModel(serviceUrl: string, typeName: string, wfst = false): Promise<FeatureModel> {
    // Only the WFS-T branch needs GML: that's the one this demo draws/edits Circle/Arc through.
    // Read-only WFS browsing keeps the default (GeoJSON) codec, same as demo/.
    const store = wfst
      ? await WFSTFeatureStore.createFromURL_WFST(serviceUrl, typeName, {
          codec: new AdvancedGMLCodec(),
          outputFormat: GML_OUTPUT_FORMAT,
        })
      : await WFSFeatureStore.createFromURL(serviceUrl, typeName)
    return new FeatureModel(store)
  }
}
