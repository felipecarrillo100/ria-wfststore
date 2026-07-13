import { WFSFeatureStore } from '@luciad/ria/model/store/WFSFeatureStore.js'
import { FeatureModel } from '@luciad/ria/model/feature/FeatureModel.js'
import { WFSTFeatureStore } from 'ria-wfststore'

export class ModelFactory {
  static async createWfsModel(serviceUrl: string, typeName: string, wfst = false): Promise<FeatureModel> {
    const store = wfst
      ? await WFSTFeatureStore.createFromURL_WFST(serviceUrl, typeName)
      : await WFSFeatureStore.createFromURL(serviceUrl, typeName)
    return new FeatureModel(store)
  }
}
