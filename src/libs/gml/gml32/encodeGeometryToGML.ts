import { create } from 'xmlbuilder2';
import { XMLBuilder } from "xmlbuilder2/lib/interfaces";
import { GMLGeometry } from "./GMLGeometry";
import { getReference } from "@luciad/ria/reference/ReferenceProvider";

/** Configuration for GML geometry encoding. */
interface EncodeGeometryToGMLOptions {
    /** Use gml:posList for coordinate sequences. Default is true. */
    usePosList?: boolean;
    /** If provided, append to this XMLBuilder instance instead of creating a new document. */
    inDoc?: XMLBuilder;
    /** Force axis inversion (lon/lat swap). */
    invert?: boolean;
    /** Pre-determined CRS swap requirement. If undefined, it will be calculated from SRS name. */
    nativeCrsSwapAxis?: boolean;
    /** Target GML version. */
    gmlVersion?: '3.2' | '3.1.1';
}

/**
 * Encodes a geometry object into GML XML.
 * Handles axis order based on CRS and optional user inversion.
 */
export function encodeGeometryToGML(geometry: GMLGeometry, options: EncodeGeometryToGMLOptions = {}): string {
    const doc = options.inDoc ? options.inDoc : create({ version: '1.0', encoding: 'UTF-8' });
    const gmlVersion = options.gmlVersion || '3.2';
    const usePosList = options.usePosList ?? true;

    // Determine if the native CRS uses Lat/Long order
    const swapAxisRequired = options.nativeCrsSwapAxis ?? needsSwapAxis(geometry.srsName);

    const hasToInvertAxis = () => {
        // If user explicitly asks to invert, we XOR it with the native requirement
        return options.invert ? !swapAxisRequired : swapAxisRequired;
    }

    const gmlCommonProps = (geom: GMLGeometry) => ({
        'srsName': geom.srsName
    });

    /** Formats coordinates based on axis order. */
    const formatCoordinates = (coordinates: number[]) => {
        if (hasToInvertAxis()) {
            return `${coordinates[1]} ${coordinates[0]}`;
        }
        return `${coordinates[0]} ${coordinates[1]}`;
    }

    /** Creates a space-separated posList from an array of coordinates. */
    const createPosList = (coordinates: [number, number][]) => {
        return coordinates.map(formatCoordinates).join(' ');
    }

    switch (geometry.type) {
        case 'Point': {
            doc.ele('gml:Point', gmlCommonProps(geometry))
                .ele('gml:pos')
                .txt(formatCoordinates(geometry.coordinates))
                .up();
            break;
        }
        case 'LineString': {
            const lineStringElement = doc.ele('gml:LineString', gmlCommonProps(geometry));
            if (usePosList) {
                lineStringElement.ele('gml:posList').txt(createPosList(geometry.coordinates)).up();
            } else {
                geometry.coordinates.forEach(coord => {
                    lineStringElement.ele('gml:pos').txt(formatCoordinates(coord)).up();
                });
            }
            break;
        }
        case 'Polygon': {
            const polygonElement = doc.ele('gml:Polygon', gmlCommonProps(geometry));
            geometry.coordinates.forEach((ring, index) => {
                const ringType = index === 0 ? 'gml:exterior' : 'gml:interior';
                const linearRing = polygonElement.ele(ringType).ele('gml:LinearRing');
                if (usePosList) {
                    linearRing.ele('gml:posList').txt(createPosList(ring)).up();
                } else {
                    ring.forEach(coord => {
                        linearRing.ele('gml:pos').txt(formatCoordinates(coord)).up();
                    });
                }
            });
            break;
        }
        case 'MultiSurface': {
            const multiSurface = doc.ele('gml:MultiSurface', gmlCommonProps(geometry));
            geometry.coordinates.forEach(polygon => {
                const polygonNode = multiSurface.ele('gml:surfaceMember').ele('gml:Polygon');
                polygon.forEach((ring, index) => {
                    const ringType = index === 0 ? 'gml:exterior' : 'gml:interior';
                    const linearRing = polygonNode.ele(ringType).ele('gml:LinearRing');
                    if (usePosList) {
                        linearRing.ele('gml:posList').txt(createPosList(ring)).up();
                    } else {
                        ring.forEach(coord => {
                            linearRing.ele('gml:pos').txt(formatCoordinates(coord)).up();
                        });
                    }
                });
            });
            break;
        }
        case 'MultiPolygon': {
            const multiPolygon = doc.ele('gml:MultiPolygon', gmlCommonProps(geometry));
            geometry.coordinates.forEach(polygon => {
                const polygonNode = multiPolygon.ele('gml:polygonMember').ele('gml:Polygon');
                polygon.forEach((ring, index) => {
                    const ringType = index === 0 ? 'gml:exterior' : 'gml:interior';
                    const linearRing = polygonNode.ele(ringType).ele('gml:LinearRing');
                    if (usePosList) {
                        linearRing.ele('gml:posList').txt(createPosList(ring)).up();
                    } else {
                        ring.forEach(coord => {
                            linearRing.ele('gml:pos').txt(formatCoordinates(coord)).up();
                        });
                    }
                });
            });
            break;
        }
        case 'MultiPoint': {
            const multiPoint = doc.ele('gml:MultiPoint', gmlCommonProps(geometry));
            geometry.coordinates.forEach(coord => {
                multiPoint.ele('gml:pointMember').ele('gml:Point').ele('gml:pos')
                    .txt(formatCoordinates(coord)).up();
            });
            break;
        }
        case 'MultiCurve': {
            const multiCurve = doc.ele('gml:MultiCurve', gmlCommonProps(geometry));
            geometry.coordinates.forEach(lineString => {
                const lineStringNode = multiCurve.ele('gml:curveMember').ele('gml:LineString');
                if (usePosList) {
                    lineStringNode.ele('gml:posList').txt(createPosList(lineString)).up();
                } else {
                    lineString.forEach(coord => {
                        lineStringNode.ele('gml:pos').txt(formatCoordinates(coord)).up();
                    });
                }
            });
            break;
        }
        case 'MultiLineString': {
            const isV311 = gmlVersion === '3.1.1';
            const multiLineString = isV311 ? doc.ele('gml:MultiLineString', gmlCommonProps(geometry))
                : doc.ele('gml:MultiCurve', gmlCommonProps(geometry));

            geometry.coordinates.forEach(lineString => {
                const memberTag = isV311 ? 'gml:lineStringMember' : 'gml:curveMember';
                const lineStringNode = multiLineString.ele(memberTag).ele('gml:LineString');
                if (usePosList) {
                    lineStringNode.ele('gml:posList').txt(createPosList(lineString)).up();
                } else {
                    lineString.forEach(coord => {
                        lineStringNode.ele('gml:pos').txt(formatCoordinates(coord)).up();
                    });
                }
            });
            break;
        }
        case 'MultiGeometry':
        case 'GeometryCollection': {
            const multiGeom = doc.ele('gml:MultiGeometry', gmlCommonProps(geometry));
            geometry.geometries.forEach(subGeom => {
                const member = multiGeom.ele('gml:geometryMember');
                encodeGeometryToGML(subGeom, { inDoc: member, invert: options.invert, nativeCrsSwapAxis: swapAxisRequired, gmlVersion });
            });
            break;
        }
        default:
            throw new Error('Unsupported geometry type');
    }

    return doc.end({ prettyPrint: false });
}

/**
 * Determines if a CRS (via URN) requires axis swapping (Latitude before Longitude).
 */
function needsSwapAxis(urn: string): boolean {
    try {
        const crs = getReference(urn);
        const axis = crs.axisInformation;
        const axis0 = axis[0].axis.abbreviation.toLowerCase();
        const axis1 = axis[1].axis.abbreviation.toLowerCase();

        const lonCandidates = ['lon', 'long', 'longitude', 'lng', 'e', 'x', 'easting', 'east'];
        const latCandidates = ['lat', 'latitude', 'n', 'y', 'northing', 'north'];

        const isLon = (name: string) => lonCandidates.includes(name);
        const isLat = (name: string) => latCandidates.includes(name);

        if (isLat(axis0) && isLon(axis1)) {
            return true; // Lat/Long order
        }
    } catch {
        // Fallback or unknown
    }
    return false;
}
