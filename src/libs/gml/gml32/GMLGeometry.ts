import {PointCoordinates} from "@luciad/ria/shape/PointCoordinate";

export interface GMLPoint {
    type: 'Point';
    id: string;
    srsName: string;
    coordinates: PointCoordinates;
}

interface GMLLineString {
    type: 'LineString';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[];
}

export interface GMLPolygon {
    type: 'Polygon';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[][];
}

interface GMLMultiPolygon {
    type: 'MultiPolygon';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[][][];
}

interface GMLMultiSurface {
    type: 'MultiSurface';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[][][];
}

interface GMLMultiPoint {
    type: 'MultiPoint';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[];
}

interface GMLMultiLineString {
    type: 'MultiLineString';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[][];
}

interface GMLMultiCurve {
    type: 'MultiCurve';
    id: string;
    srsName: string;
    coordinates: PointCoordinates[][];
}

export interface GMLMultiGeometry {
    type: 'MultiGeometry';
    id: string;
    srsName: string;
    geometries: GMLGeometry[];
}

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
export interface GMLCircle {
    type: 'Circle';
    id: string;
    srsName: string;
    center: PointCoordinates;
    // Always meters - see Circle.d.ts. Encoded as gml:CircleByCenterPoint (never the 3-point
    // form): its radius is explicit and self-describing, unlike a 3-point circle's implied radius.
    radius: number;
}

export interface GMLArc {
    type: 'Arc';
    id: string;
    srsName: string;
    center: PointCoordinates;
    // Always meters. Circular arcs only (a === b) - GML 3.2's ArcByCenterPoint has a single
    // radius, no standard segment exists for a genuinely elliptical arc (a !== b).
    radius: number;
    // RIA's own compass convention: degrees, clockwise from north. Converted to/from GML's
    // math convention (degrees, counterclockwise from east) at the encode/decode boundary.
    startAzimuth: number;
    sweepAngle: number;
}

export type GMLGeometry = GMLPoint | GMLLineString | GMLPolygon |
    GMLMultiPoint | GMLMultiLineString | GMLMultiCurve | GMLMultiPolygon | GMLMultiSurface |
    GMLMultiGeometry | GMLGeometryCollection | GMLCircle | GMLArc;

export type GMLGeometryTypeNames = GMLGeometry['type'];
