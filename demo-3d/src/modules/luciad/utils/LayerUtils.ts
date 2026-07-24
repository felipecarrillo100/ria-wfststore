import {RIAMap} from "@luciad/ria/view/RIAMap.js";
import type {LayerTreeNode} from "@luciad/ria/view/LayerTreeNode.js";
import {Layer} from "@luciad/ria/view/Layer.js";
import {TileSet3DLayer} from "@luciad/ria/view/tileset/TileSet3DLayer.js";
import {FeatureLayer} from "@luciad/ria/view/feature/FeatureLayer.js";
import {RasterTileSetLayer} from "@luciad/ria/view/tileset/RasterTileSetLayer.js";

export function fitMapToLayer(
    map: RIAMap,
    node: LayerTreeNode
) {
    if (!map) return;
    if (node instanceof Layer) {
        const layer = node as Layer;
        if (layer instanceof TileSet3DLayer) {
            map.mapNavigator.fit({bounds: layer.bounds, animate: true} );
            return;
        }
        if (layer instanceof RasterTileSetLayer) {
            const model = layer.model;
            if (model.bounds) map.mapNavigator.fit({bounds: model.bounds, animate: true} );
            return;
        }
        if (layer instanceof FeatureLayer) {
            if (layer.bounds) {
                map.mapNavigator.fit({bounds: layer.bounds, animate: true} );
                return;
            }
            const queryFinishedHandle = layer.workingSet.on("QueryFinished", () => {
                if (layer.bounds) {
                    //#snippet layerFit
                    map.mapNavigator.fit({
                        bounds: layer.bounds,
                        animate: true
                    });
                    //#endsnippet layerFit
                }
                queryFinishedHandle.remove();
            });
        }
     }
}