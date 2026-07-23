import {PointCoordinates} from "@luciad/ria/shape/PointCoordinate";

/**
 * The internal, GeoJSON-shaped geometry representation this library's GML encoders/decoders work
 * with as an intermediate step - one variant per GML geometry type this library supports. Built
 * by {@link GMLFeatureEncoder}/{@link AdvancedGMLCodec}, consumed by {@link encodeGeometryToGML}.
 */
export interface GMLPoint {
    type: 'Point';
    id: string;
    srsName: string;
    coordinates: PointCoordinates;
}

/** See {@link GMLPoint} - `coordinates` is one array of positions along the line. */
interface GMLLineString {
    type: 'LineString';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[];
}

/** See {@link GMLPoint} - `coordinates` is an array of rings (first = exterior, rest = interior/holes), each an array of positions. */
export interface GMLPolygon {
    type: 'Polygon';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[][];
}

/** See {@link GMLPoint} - `coordinates` is an array of {@link GMLPolygon}-shaped ring-sets, one per member polygon. */
interface GMLMultiPolygon {
    type: 'MultiPolygon';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[][][];
}

/** Same shape as {@link GMLMultiPolygon} - written as GML's `MultiSurface` instead of `MultiPolygon` for servers/schemas that declare the field that way (e.g. GeoServer). */
interface GMLMultiSurface {
    type: 'MultiSurface';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[][][];
}

/** See {@link GMLPoint} - `coordinates` is an array of member point positions. */
interface GMLMultiPoint {
    type: 'MultiPoint';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[];
}

/** See {@link GMLPoint} - `coordinates` is an array of member lines, each an array of positions. */
interface GMLMultiLineString {
    type: 'MultiLineString';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[][];
}

/** Same shape as {@link GMLMultiLineString} - written as GML's `MultiCurve` instead of `MultiLineString` for servers/schemas that declare the field that way. */
interface GMLMultiCurve {
    type: 'MultiCurve';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[][];
}

/** A heterogeneous collection of arbitrary member geometries - see {@link GMLPoint}. */
export interface GMLMultiGeometry {
    type: 'MultiGeometry';
    id: string;
    srsName: string;
    geometries: GMLGeometry[];
}

/** Same shape as {@link GMLMultiGeometry} - the GeoJSON-side name for the same concept; {@link normalizeGMLGeometry} rewrites this to `MultiGeometry` before GML output, since GML itself has no separate `GeometryCollection` type. */
interface GMLGeometryCollection {
    type: 'GeometryCollection';
    id: string;
    srsName: string;
    geometries: GMLGeometry[];
}

// Circle/Arc have no GeoJSON-coordinate-array representation (unlike every geometry above, which
// mirrors a GeoJSON geometry shape) - they carry RIA's own native Circle/Arc properties directly,
// since GMLFeatureEncoder builds these straight from the RIA shape, bypassing the GeoJSON
// intermediate step entirely (see GMLFeatureEncoder.tryBuildCircularGeometryJSON).
/**
 * Circle/Arc have no GeoJSON-coordinate-array representation (unlike every geometry above, which
 * mirrors a GeoJSON geometry shape) - they carry RIA's own native Circle/Arc properties directly,
 * since {@link GMLFeatureEncoder} builds these straight from the RIA shape, bypassing the GeoJSON
 * intermediate step entirely (see `tryBuildCircularGeometryJSON`).
 */
export interface GMLCircle {
    type: 'Circle';
    id: string;
    srsName: string;
    center: PointCoordinates;
    // Always meters - see Circle.d.ts. Encoded as gml:CircleByCenterPoint (never the 3-point
    // form): its radius is explicit and self-describing, unlike a 3-point circle's implied radius.
    /** Always meters (see `Circle.d.ts`). Encoded as `gml:CircleByCenterPoint` (never the 3-point form): its radius is explicit and self-describing, unlike a 3-point circle's implied radius. */
    radius: number;
}

/** See {@link GMLCircle} - the arc counterpart, adding a start angle and sweep. */
export interface GMLArc {
    type: 'Arc';
    id: string;
    srsName: string;
    center: PointCoordinates;
    // Always meters. Circular arcs only (a === b) - GML 3.2's ArcByCenterPoint has a single
    // radius, no standard segment exists for a genuinely elliptical arc (a !== b).
    /** Always meters. Circular arcs only (`a === b`) - GML 3.2's `ArcByCenterPoint` has a single radius; no standard segment exists for a genuinely elliptical arc (`a !== b`). */
    radius: number;
    // RIA's own compass convention: degrees, clockwise from north. Converted to/from GML's
    // math convention (degrees, counterclockwise from east) at the encode/decode boundary.
    /** RIA's own compass convention: degrees, clockwise from north. Converted to/from GML's math convention (degrees, counterclockwise from east) at the encode/decode boundary - see `compassAzimuthSweepToMathAngles` in `encodeGeometryToGML.ts`. */
    startAzimuth: number;
    /** See {@link startAzimuth} - degrees, RIA's compass convention (negative = counterclockwise). */
    sweepAngle: number;
}

/** Every GML geometry variant this library's encoders/decoders support - see {@link GMLPoint} and its siblings. */
export type GMLGeometry = GMLPoint | GMLLineString | GMLPolygon |
    GMLMultiPoint | GMLMultiLineString | GMLMultiCurve | GMLMultiPolygon | GMLMultiSurface |
    GMLMultiGeometry | GMLGeometryCollection | GMLCircle | GMLArc;

/** Every {@link GMLGeometry} variant's `type` discriminant, as a standalone union. */
export type GMLGeometryTypeNames = GMLGeometry['type'];
