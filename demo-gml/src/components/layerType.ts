import { LayerTreeNode } from '@luciad/ria/view/LayerTreeNode.js'
import { LayerGroup } from '@luciad/ria/view/LayerGroup.js'
import { WMSTileSetLayer } from '@luciad/ria/view/tileset/WMSTileSetLayer.js'
import { RasterTileSetLayer } from '@luciad/ria/view/tileset/RasterTileSetLayer.js'
import { TileSet3DLayer } from '@luciad/ria/view/tileset/TileSet3DLayer.js'
import { FeatureLayer } from '@luciad/ria/view/feature/FeatureLayer.js'
import { FeatureModel } from '@luciad/ria/model/feature/FeatureModel.js'
import { WMTSTileSetModel } from '@luciad/ria/model/tileset/WMTSTileSetModel.js'
import { FusionTileSetModel } from '@luciad/ria/model/tileset/FusionTileSetModel.js'
import { OGC3DTilesModel } from '@luciad/ria/model/tileset/OGC3DTilesModel.js'
import { HSPCTilesModel } from '@luciad/ria/model/tileset/HSPCTilesModel.js'
import { WFSFeatureStore } from '@luciad/ria/model/store/WFSFeatureStore.js'

export enum LayerType {
  GROUP        = 'GROUP',
  WMS          = 'WMS',
  WMTS         = 'WMTS',
  LTS          = 'LTS',
  WFS          = 'WFS',
  OGC_3D_TILES = 'OGC_3D_TILES',
  HSPC         = 'HSPC',
  PANORAMA     = 'PANORAMA',
  FEATURE      = 'FEATURE',
  UNKNOWN      = 'UNKNOWN',
}

export function getLayerType(node: LayerTreeNode): LayerType {
  if (node instanceof LayerGroup) return LayerType.GROUP
  // WMSTileSetLayer extends RasterTileSetLayer — must be checked first
  if (node instanceof WMSTileSetLayer) return LayerType.WMS
  if (node instanceof RasterTileSetLayer) {
    if (node.model instanceof WMTSTileSetModel) return LayerType.WMTS
    if (node.model instanceof FusionTileSetModel) return LayerType.LTS
    return LayerType.UNKNOWN
  }
  if (node instanceof TileSet3DLayer) {
    if (node.model instanceof HSPCTilesModel) return LayerType.HSPC
    if (node.model instanceof OGC3DTilesModel) return LayerType.OGC_3D_TILES
    return LayerType.UNKNOWN
  }
  if (node instanceof FeatureLayer) {
    if ((node as any).panoramaModel !== null) return LayerType.PANORAMA
    if (node.model instanceof FeatureModel && node.model.store instanceof WFSFeatureStore) return LayerType.WFS
    return LayerType.FEATURE
  }
  return LayerType.UNKNOWN
}
