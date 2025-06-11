import {create} from 'xmlbuilder2';
import {XMLBuilder} from "xmlbuilder2/lib/interfaces";
import {GMLGeometry} from "./GMLGeometry";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";

export enum EncodeGeometryDimension {
   Force2D = '2d',
   Force3D = '3d',
   Auto = 'auto'
}

interface EncodeGeometryToGMLOptions {
    usePosList?: boolean;
    inDoc?: XMLBuilder;
    invert?: boolean;
    nativeCrsSwapAxis?: boolean;
    gmlVersion?: '3.2' | '3.1.1';
    forceDimension?: EncodeGeometryDimension;  // New option
}

export function encodeGeometryToGML(geometry: GMLGeometry, options: EncodeGeometryToGMLOptions = {}): string {
    const doc = options.inDoc ? options.inDoc : create({ version: '1.0', encoding: 'UTF-8' });
    const swapAxisRequiredForThisProjection = typeof options.nativeCrsSwapAxis !== "undefined"
        ? options.nativeCrsSwapAxis
        : needsSwapAxis(geometry.srsName);
    const usePosList = typeof options.usePosList !== "undefined" ? options.usePosList : true;
    const gmlVersion = options.gmlVersion || '3.2';
    const forceDim = options.forceDimension || EncodeGeometryDimension.Auto;

    const hasToInvertAxis = () => {
        return options.invert ? !swapAxisRequiredForThisProjection : swapAxisRequiredForThisProjection;
    };

    const GMLProperties = (geometry: GMLGeometry) => ({
        'srsName': geometry.srsName
    });

    // Format coordinate according to forceDimension and axis inversion
    const formatCoordinate = (coordinates: number[]) => {
        const dim = (forceDim === EncodeGeometryDimension.Auto) ? coordinates.length : (forceDim === EncodeGeometryDimension.Force3D ? 3 : 2);

        if (dim === 2) {
            // Only X and Y
            if (hasToInvertAxis()) return `${coordinates[1]} ${coordinates[0]}`;
            return `${coordinates[0]} ${coordinates[1]}`;
        } else {
            // 3D: X, Y, Z (Z = 0 if missing)
            const x = hasToInvertAxis() ? coordinates[1] : coordinates[0];
            const y = hasToInvertAxis() ? coordinates[0] : coordinates[1];
            const z = (coordinates.length > 2) ? coordinates[2] : 0;
            return `${x} ${y} ${z}`;
        }
    };

    const createPosList = (coordinates: [number, number, number?][]) => {
        return coordinates.map(formatCoordinate).join(' ');
    };

    switch (geometry.type) {
        case 'Point': {
            doc.ele('gml:Point', GMLProperties(geometry))
                .ele('gml:pos')
                .txt(formatCoordinate(geometry.coordinates))
                .up();
            break;
        }
        case 'LineString': {
            const lineStringElement = doc.ele('gml:LineString', GMLProperties(geometry));
            if (usePosList) {
                lineStringElement.ele('gml:posList').txt(createPosList(geometry.coordinates)).up();
            } else {
                geometry.coordinates.forEach(coord => {
                    lineStringElement.ele('gml:pos').txt(formatCoordinate(coord)).up();
                });
            }
            break;
        }
        case 'Polygon': {
            const polygonElement = doc.ele('gml:Polygon', GMLProperties(geometry));
            geometry.coordinates.forEach((ring, index) => {
                const ringType = index === 0 ? 'gml:exterior' : 'gml:interior';
                const linearRingElement = polygonElement.ele(ringType).ele('gml:LinearRing');
                if (usePosList) {
                    linearRingElement.ele('gml:posList').txt(createPosList(ring)).up();
                } else {
                    ring.forEach(coord => {
                        linearRingElement.ele('gml:pos').txt(formatCoordinate(coord)).up();
                    });
                }
            });
            break;
        }
        case 'MultiSurface': {
            const multiSurfaceElement = doc.ele('gml:MultiSurface', GMLProperties(geometry));
            geometry.coordinates.forEach(polygon => {
                const polygonMemberElement = multiSurfaceElement.ele('gml:surfaceMember').ele('gml:Polygon');
                polygon.forEach((ring, index) => {
                    const ringType = index === 0 ? 'gml:exterior' : 'gml:interior';
                    const linearRingElement = polygonMemberElement.ele(ringType).ele('gml:LinearRing');
                    if (usePosList) {
                        linearRingElement.ele('gml:posList').txt(createPosList(ring)).up();
                    } else {
                        ring.forEach(coord => {
                            linearRingElement.ele('gml:pos').txt(formatCoordinate(coord)).up();
                        });
                    }
                });
            });
            break;
        }
        case 'MultiPolygon': {
            const multiPolygonElement = doc.ele('gml:MultiPolygon', GMLProperties(geometry));
            geometry.coordinates.forEach(polygon => {
                const polygonMemberElement = multiPolygonElement.ele('gml:polygonMember').ele('gml:Polygon');
                polygon.forEach((ring, index) => {
                    const ringType = index === 0 ? 'gml:exterior' : 'gml:interior';
                    const linearRingElement = polygonMemberElement.ele(ringType).ele('gml:LinearRing');
                    if (usePosList) {
                        linearRingElement.ele('gml:posList').txt(createPosList(ring)).up();
                    } else {
                        ring.forEach(coord => {
                            linearRingElement.ele('gml:pos').txt(formatCoordinate(coord)).up();
                        });
                    }
                });
            });
            break;
        }
        case 'MultiPoint': {
            const multiPointElement = doc.ele('gml:MultiPoint', GMLProperties(geometry));
            geometry.coordinates.forEach(coord => {
                multiPointElement.ele('gml:pointMember')
                    .ele('gml:Point')
                    .ele('gml:pos')
                    .txt(formatCoordinate(coord))
                    .up()
                    .up()
                    .up();
            });
            break;
        }
        case 'MultiCurve': {
            const multiCurveElement = doc.ele('gml:MultiCurve', GMLProperties(geometry));
            geometry.coordinates.forEach(lineString => {
                const lineStringMemberElement = multiCurveElement.ele('gml:curveMember').ele('gml:LineString');
                if (usePosList) {
                    lineStringMemberElement.ele('gml:posList').txt(createPosList(lineString)).up();
                } else {
                    lineString.forEach(coord => {
                        lineStringMemberElement.ele('gml:pos').txt(formatCoordinate(coord)).up();
                    });
                }
            });
            break;
        }
        case 'MultiLineString': {
            const multiLineStringElement = gmlVersion === '3.1.1'
                ? doc.ele('gml:MultiLineString', GMLProperties(geometry))
                : doc.ele('gml:MultiCurve', GMLProperties(geometry));
            geometry.coordinates.forEach(lineString => {
                const lineStringMemberElement = multiLineStringElement.ele(
                    gmlVersion === '3.1.1' ? 'gml:lineStringMember' : 'gml:curveMember'
                ).ele('gml:LineString');
                if (usePosList) {
                    lineStringMemberElement.ele('gml:posList').txt(createPosList(lineString)).up();
                } else {
                    lineString.forEach(coord => {
                        lineStringMemberElement.ele('gml:pos').txt(formatCoordinate(coord)).up();
                    });
                }
            });
            break;
        }
        case 'MultiGeometry':
        case 'GeometryCollection': {
            const multiGeometryElement = doc.ele('gml:MultiGeometry', GMLProperties(geometry));
            geometry.geometries.forEach(subGeometry => {
                const geometryMemberElement = multiGeometryElement.ele('gml:geometryMember');
                encodeGeometryToGML(subGeometry, {
                    inDoc: geometryMemberElement,
                    invert: options.invert,
                    nativeCrsSwapAxis: swapAxisRequiredForThisProjection,
                    gmlVersion,
                    forceDimension: forceDim
                });
            });
            break;
        }
        default:
            throw new Error('Unsupported geometry type');
    }

    return doc.end({ prettyPrint: false });
}

// Determines if swapping is required for this projection
function needsSwapAxis(urn: string) {
    const crs = getReference(urn);
    const axis = crs.axisInformation;
    const axis0 = axis[0].axis.abbreviation.toLowerCase();
    const axis1 = axis[1].axis.abbreviation.toLowerCase();

    const lonCandidates = [
        'lon', 'long', 'longitude', 'lng',
        'e', 'x', 'easting', 'east'
    ];
    const latCandidates = [
        'lat', 'latitude',
        'n', 'y', 'northing', 'north'
    ];

    const isLon = (axis: string) => lonCandidates.includes(axis);
    const isLat = (axis: string) => latCandidates.includes(axis);

    let status = 'unknown';
    if (isLon(axis0) && isLat(axis1)) {
        status = 'longlat';
    } else if (isLat(axis0) && isLon(axis1)) {
        status = 'latlong';
    }
    return status === 'latlong';
}
