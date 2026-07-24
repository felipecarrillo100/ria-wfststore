import { WFSFeatureStore } from '@luciad/ria/model/store/WFSFeatureStore.js'
import { FeatureModel } from '@luciad/ria/model/feature/FeatureModel.js'
import { WFSTFeatureStore, AdvancedGMLCodec } from 'ria-wfststore'
import {type CreateOGC3DTilesModelOptions, OGC3DTilesModel} from "@luciad/ria/model/tileset/OGC3DTilesModel.js";
import {getReference} from "@luciad/ria/reference/ReferenceProvider.js";

export class ModelFactory {
  static async createWfsModel(serviceUrl: string, typeName: string, wfst = false): Promise<FeatureModel> {
    const store = wfst
      ? await WFSTFeatureStore.createFromURL_WFST(serviceUrl, typeName, {
          codec: new AdvancedGMLCodec({ mode3D: true }),
          outputFormat: 'application/gml+xml; version=3.2',
        })
      : await WFSFeatureStore.createFromURL(serviceUrl, typeName)
    return new FeatureModel(store)
  }

  /**
   * Creates an OGC 3D Tiles Model using create.
   */
  static async create3DTilesModel(options: OGC3DModelOptions): Promise<OGC3DTilesModel> {
    const { url, crs, ...rest } = options;
    const reference = crs ? getReference(crs) : undefined;
    return OGC3DTilesModel.create(url, {...rest as CreateOGC3DTilesModelOptions, reference});
  }

}

export interface JSONHTTPRequest {
  /** Whether to include credentials (cookies) in cross-origin requests */
  credentials?: boolean
  /** * Custom headers to include in the request.
   * Note: Luciad requires these to be strings.
   */
  requestHeaders?: Record<string, string>; // Changed from string | number | boolean
  /** Custom query parameters to include in the request */
  requestParameters?: Record<string, string | number | boolean>;
}
/**
 * Options for configuring an OGC 3D Tiles model.
 */
export interface OGC3DModelOptions extends JSONHTTPRequest {
  /** URL to the tileset.json file. */
  url: string;
  /** Coordinate Reference System. */
  crs?: string;
}
