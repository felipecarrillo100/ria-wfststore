import {GMLGeometry} from "./GMLGeometry";

// Shared by GMLFeatureEncoder and AdvancedGMLCodec: both need the same schema-independent,
// unconditional normalizations before handing a GeoJSON-derived geometry to the GML builders.

/**
 * Rewrites the informal `"CRS:84"` identifier (RIA's own shorthand for WGS84 lon/lat) to its
 * proper URN form before it's written as a `srsName` attribute - `"CRS:84"` itself isn't a valid
 * GML `srsName` value.
 *
 * @param srsName the CRS identifier to normalize.
 * @returns the normalized identifier, or `srsName` unchanged if it isn't `"CRS:84"`.
 */
export function normalizeSrsName(srsName: string): string {
    return srsName === "CRS:84" ? "urn:ogc:def:crs:EPSG:4326" : srsName;
}

/**
 * Schema-independent, unconditional geometry-type normalization shared by {@link GMLFeatureEncoder}
 * and {@link AdvancedGMLCodec}, applied before handing a GeoJSON-derived geometry to the GML
 * builders - currently just GeoJSON's `MultiPolygon` -> GML's `MultiSurface` (GML has no
 * `MultiPolygon` element).
 *
 * @param geometry the geometry to normalize.
 * @returns the normalized geometry, or `geometry` unchanged if no normalization applies.
 */
export function normalizeGMLGeometry(geometry: GMLGeometry): GMLGeometry {
    if ((geometry.type as string) === "MultiPolygon") {
        return {...geometry, type: "MultiSurface"} as GMLGeometry;
    }
    return geometry;
}
