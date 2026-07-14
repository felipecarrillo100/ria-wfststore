import {GMLGeometry} from "./GMLGeometry";

// Shared by GMLFeatureEncoder and AdvancedGMLCodec: both need the same schema-independent,
// unconditional normalizations before handing a GeoJSON-derived geometry to the GML builders.

export function normalizeSrsName(srsName: string): string {
    return srsName === "CRS:84" ? "urn:ogc:def:crs:EPSG:4326" : srsName;
}

export function normalizeGMLGeometry(geometry: GMLGeometry): GMLGeometry {
    if ((geometry.type as string) === "MultiPolygon") {
        return {...geometry, type: "MultiSurface"} as GMLGeometry;
    }
    return geometry;
}
