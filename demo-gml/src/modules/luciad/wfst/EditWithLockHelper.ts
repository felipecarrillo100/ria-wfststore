import { WFSTFeatureLockStore } from 'ria-wfststore'
import { FeatureModel } from '@luciad/ria/model/feature/FeatureModel.js'
import { FeatureLayer } from '@luciad/ria/view/feature/FeatureLayer.js'
import { ColourfulFeaturePainter, type ColorSet } from '../painters/ColourfulFeaturePainter'

export const LOCKED_COLOR_SET: ColorSet = {
    normalStroke:   'rgb(81,6,98)',
    normalFill:     'rgba(232,103,211,0.75)',
    selectedStroke: 'rgb(182,14,220)',
    selectedFill:   'rgba(236,97,212,0.75)',
}

export function createLockedLayer(lockStore: WFSTFeatureLockStore, layerLabel: string): FeatureLayer {
    const ref = lockStore.getReference()
    const model = new FeatureModel(lockStore as any, { reference: ref })
    const painter = new ColourfulFeaturePainter({ colorSet: LOCKED_COLOR_SET, showLabels: false })
    return new FeatureLayer(model, {
        label: `[Lock] ${layerLabel}`,
        painter,
        selectable: true,
        hoverable: true,
    })
}
