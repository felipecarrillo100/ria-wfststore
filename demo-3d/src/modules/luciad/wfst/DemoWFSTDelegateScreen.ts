import { WFSTDelegateScreenHelper, WFSTFeatureStore, WFSTFeatureLockStore } from 'ria-wfststore'
import type { Feature } from '@luciad/ria/model/feature/Feature.js'

type ConfirmHandler = (onOK: () => void, onCancel: () => void) => void
type EditNewFeatureHandler = (feature: Feature, store: WFSTFeatureStore | WFSTFeatureLockStore) => void

export class DemoWFSTDelegateScreen extends WFSTDelegateScreenHelper {
  private confirmHandler: ConfirmHandler | null = null
  private editNewFeatureHandler: EditNewFeatureHandler | null = null

  setConfirmHandler(fn: ConfirmHandler) {
    this.confirmHandler = fn
  }

  setEditNewFeatureHandler(fn: EditNewFeatureHandler) {
    this.editNewFeatureHandler = fn
  }

  confirmGeometryUpdate(onOK: () => void, onCancel = () => {}) {
    if (this.confirmHandler) this.confirmHandler(onOK, onCancel)
    else onOK()
  }

  EditNewFeatureProperties(feature: Feature, store: WFSTFeatureStore | WFSTFeatureLockStore) {
    if (this.editNewFeatureHandler) {
      this.editNewFeatureHandler(feature, store)
    }
    // No handler registered: silently no-op (feature not created — expected during startup)
  }
}
