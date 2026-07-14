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


export type GMLGeometry = GMLPoint | GMLLineString | GMLPolygon |
    GMLMultiPoint | GMLMultiLineString | GMLMultiCurve | GMLMultiPolygon | GMLMultiSurface |
    GMLMultiGeometry | GMLGeometryCollection;

export type GMLGeometryTypeNames = GMLGeometry['type'];
