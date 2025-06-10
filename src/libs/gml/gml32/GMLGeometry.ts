export interface GMLPoint {
    type: 'Point';
    id: string;
    srsName: string;
    coordinates: [number, number];
}

interface GMLLineString {
    type: 'LineString';
    id: string;
    srsName: string;
    coordinates: [number, number][];
}

export interface GMLPolygon {
    type: 'Polygon';
    id: string;
    srsName: string;
    coordinates: [number, number][][];
}

interface GMLMultiPolygon {
    type: 'MultiPolygon';
    id: string;
    srsName: string;
    coordinates: [number, number][][][];
}

interface GMLMultiSurface {
    type: 'MultiSurface';
    id: string;
    srsName: string;
    coordinates: [number, number][][][];
}

interface GMLMultiPoint {
    type: 'MultiPoint';
    id: string;
    srsName: string;
    coordinates: [number, number][];
}

interface GMLMultiLineString {
    type: 'MultiLineString';
    id: string;
    srsName: string;
    coordinates: [number, number][][];
}

interface GMLMultiCurve {
    type: 'MultiCurve';
    id: string;
    srsName: string;
    coordinates: [number, number][][];
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


export type GMLGeometry = GMLPoint | GMLLineString | GMLPolygon |
    GMLMultiPoint | GMLMultiLineString | GMLMultiCurve | GMLMultiPolygon | GMLMultiSurface |
    GMLMultiGeometry | GMLGeometryCollection;

export type GMLGeometryTypeNames = GMLGeometry['type'];
