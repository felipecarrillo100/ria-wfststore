import {create} from 'xmlbuilder2';
import {XMLBuilder} from "xmlbuilder2/lib/interfaces";
import {GMLGeometry} from "./GMLGeometry";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {PointCoordinates} from "@luciad/ria/shape/PointCoordinate";

// Function to encode geometries to GML 3.2 (or GML 3.1.1)
interface EncodeGeometryToGMLOptions {
    usePosList?: boolean;
    inDoc?: XMLBuilder;
    invert?: boolean;       //  Rever lon /lat for user's request
    nativeCrsSwapAxis?: boolean;  //  Rever lon /lat for user's request
    gmlVersion?: '3.2' | '3.1.1';
    // true forces 3D output (Z always written, even if 0), false forces 2D (Z always dropped).
    // Omitted (undefined) auto-detects per geometry: 3D only if some coordinate's Z isn't exactly 0.
    mode3D?: boolean;
}

export function encodeGeometryToGML(geometry: GMLGeometry, options: EncodeGeometryToGMLOptions): string {
    options = options || {};
    const doc = options.inDoc ? options.inDoc : create({ version: '1.0', encoding: 'UTF-8' });
    // If we have already determined nativeCrsSwapAxis not need to calculate it again.
    const swapAxisRequiredForThisProjection = typeof options.nativeCrsSwapAxis !== "undefined" ? options.nativeCrsSwapAxis : needsSwapAxis(geometry.srsName);
    const usePosList = typeof options.usePosList !== "undefined" ? options.usePosList : true;
    const gmlVersion = options.gmlVersion || '3.2';
    // Resolved once per geometry (not per recursive MultiGeometry/GeometryCollection member - see
    // that case below, which deliberately passes the raw, unresolved options.mode3D back down so
    // heterogeneous collections can have independently 2D and 3D members).
    const resolvedIs3D = resolveMode3D(options.mode3D, geometry);

    const hasToInvertAxis = () => {
        // Force axis swap on user's request.
        return options.invert ? !swapAxisRequiredForThisProjection : swapAxisRequiredForThisProjection;
    }

    const GMLProperties = (geometry: GMLGeometry, is3D: boolean) => ({
        'srsName': geometry.srsName,
        // Required for correct 3D decoding, not a stylistic choice: without it, a decoder that finds
        // no srsDimension on this element or any ancestor falls back to the reference's own axis count
        // (2), silently misreading a flat 3-per-point number list as 2D pairs.
        ...(is3D ? {'srsDimension': '3'} : {})
    });

    const invertCoordinates = (coordinates: PointCoordinates) => {
        const [x, y] = coordinates;
        const swappedXY = hasToInvertAxis() ? `${y} ${x}` : `${x} ${y}`;
        if (!resolvedIs3D) return swappedXY;
        // Z is never part of axis order swapping - only X/Y (longitude/latitude) conventions apply.
        // Pad with 0 when the source coordinate is structurally 2D but this geometry resolved to 3D
        // (e.g. an explicit mode3D:true forced against 2D data).
        const z = coordinates.length === 3 ? coordinates[2] : 0;
        return `${swappedXY} ${z}`;
    }

    const createPosList = (coordinates: PointCoordinates[]) => {
        return coordinates.map(invertCoordinates).join(' ');
    }


    switch (geometry.type) {
        case 'Point': {
            doc.ele('gml:Point', GMLProperties(geometry, resolvedIs3D))
                .ele('gml:pos')
                .txt(invertCoordinates(geometry.coordinates))
                .up();
            break;
        }
        case 'LineString': {
            const lineStringElement = doc.ele('gml:LineString', GMLProperties(geometry, resolvedIs3D));
            if (usePosList) {
                lineStringElement.ele('gml:posList').txt(createPosList(geometry.coordinates)).up();
            } else {
                geometry.coordinates.forEach(coord => {
                    lineStringElement.ele('gml:pos').txt(invertCoordinates(coord)).up();
                });
            }
            break;
        }
        case 'Polygon': {
            const polygonElement = doc.ele('gml:Polygon', GMLProperties(geometry, resolvedIs3D));

            geometry.coordinates.forEach((ring, index) => {
                const ringType = index === 0 ? 'gml:exterior' : 'gml:interior';
                const linearRingElement = polygonElement.ele(ringType).ele('gml:LinearRing');

                if (usePosList) {
                    linearRingElement.ele('gml:posList').txt(createPosList(ring)).up();
                } else {
                    ring.forEach(coord => {
                        linearRingElement.ele('gml:pos').txt(invertCoordinates(coord)).up();
                    });
                }
            });
            break;
        }
        case 'MultiSurface': {
            const multiPolygonElement = doc.ele('gml:MultiSurface', GMLProperties(geometry, resolvedIs3D));

            geometry.coordinates.forEach(polygon => {
                const polygonMemberElement = multiPolygonElement.ele('gml:surfaceMember').ele('gml:Polygon');

                polygon.forEach((ring, index) => {
                    const ringType = index === 0 ? 'gml:exterior' : 'gml:interior';
                    const linearRingElement = polygonMemberElement.ele(ringType).ele('gml:LinearRing');

                    if (usePosList) {
                        linearRingElement.ele('gml:posList').txt(createPosList(ring)).up();
                    } else {
                        ring.forEach(coord => {
                            linearRingElement.ele('gml:pos').txt(invertCoordinates(coord)).up();
                        });
                    }
                });
            });
            break;
        }
        case 'MultiPolygon': {
            const multiPolygonElement = doc.ele('gml:MultiPolygon', GMLProperties(geometry, resolvedIs3D));

            geometry.coordinates.forEach(polygon => {
                const polygonMemberElement = multiPolygonElement.ele('gml:polygonMember').ele('gml:Polygon');

                polygon.forEach((ring, index) => {
                    const ringType = index === 0 ? 'gml:exterior' : 'gml:interior';
                    const linearRingElement = polygonMemberElement.ele(ringType).ele('gml:LinearRing');

                    if (usePosList) {
                        linearRingElement.ele('gml:posList').txt(createPosList(ring)).up();
                    } else {
                        ring.forEach(coord => {
                            linearRingElement.ele('gml:pos').txt(invertCoordinates(coord)).up();
                        });
                    }
                });
            });
            break;
        }
        case 'MultiPoint': {
            const multiPointElement = doc.ele('gml:MultiPoint', GMLProperties(geometry, resolvedIs3D));

            geometry.coordinates.forEach(coord => {
                multiPointElement.ele('gml:pointMember')
                    .ele('gml:Point')
                    .ele('gml:pos')
                    .txt(invertCoordinates(coord))
                    .up();
            });
            break;
        }
        case 'MultiCurve': {
            const multiLineStringElement = doc.ele('gml:MultiCurve', GMLProperties(geometry, resolvedIs3D));

            geometry.coordinates.forEach(lineString => {
                const lineStringMemberElement = multiLineStringElement.ele('gml:curveMember').ele('gml:LineString');

                if (usePosList) {
                    lineStringMemberElement.ele('gml:posList').txt(createPosList(lineString)).up();
                } else {
                    lineString.forEach(coord => {
                        lineStringMemberElement.ele('gml:pos').txt(invertCoordinates(coord)).up();
                    });
                }
            });
            break;
        }
        case 'MultiLineString': {
            const multiLineStringElement = gmlVersion === '3.1.1'
                                           ? doc.ele('gml:MultiLineString', GMLProperties(geometry, resolvedIs3D))
                                           : doc.ele('gml:MultiCurve', GMLProperties(geometry, resolvedIs3D));

            geometry.coordinates.forEach(lineString => {
                const lineStringMemberElement = multiLineStringElement.ele(
                    gmlVersion === '3.1.1' ? 'gml:lineStringMember' : 'gml:curveMember'
                ).ele('gml:LineString');

                if (usePosList) {
                    lineStringMemberElement.ele('gml:posList').txt(createPosList(lineString)).up();
                } else {
                    lineString.forEach(coord => {
                        lineStringMemberElement.ele('gml:pos').txt(invertCoordinates(coord)).up();
                    });
                }
            });
            break;
        }
        case 'Circle': {
            const curveElement = doc.ele('gml:Curve', GMLProperties(geometry, resolvedIs3D));
            const segmentElement = curveElement.ele('gml:segments').ele('gml:CircleByCenterPoint');
            segmentElement.ele('gml:pos').txt(invertCoordinates(geometry.center)).up();
            segmentElement.ele('gml:radius', {uom: 'm'}).txt(`${geometry.radius}`).up();
            break;
        }
        case 'Arc': {
            const curveElement = doc.ele('gml:Curve', GMLProperties(geometry, resolvedIs3D));
            const segmentElement = curveElement.ele('gml:segments').ele('gml:ArcByCenterPoint');
            segmentElement.ele('gml:pos').txt(invertCoordinates(geometry.center)).up();
            segmentElement.ele('gml:radius', {uom: 'm'}).txt(`${geometry.radius}`).up();
            const {startAngle, endAngle} = compassAzimuthSweepToMathAngles(geometry.startAzimuth, geometry.sweepAngle);
            segmentElement.ele('gml:startAngle', {uom: 'deg'}).txt(`${startAngle}`).up();
            segmentElement.ele('gml:endAngle', {uom: 'deg'}).txt(`${endAngle}`).up();
            break;
        }
        case 'MultiGeometry':
        case 'GeometryCollection': {
            // No posList/pos of its own, so no single is3D fact to assert on the wrapper itself.
            const multiGeometryElement = doc.ele('gml:MultiGeometry', GMLProperties(geometry, false));

            geometry.geometries.forEach(subGeometry => {
                const geometryMemberElement = multiGeometryElement.ele('gml:geometryMember');
                encodeGeometryToGML(subGeometry, {
                    inDoc: geometryMemberElement,
                    invert: options.invert,
                    nativeCrsSwapAxis: swapAxisRequiredForThisProjection,
                    gmlVersion,
                    usePosList,
                    // Raw passthrough, NOT resolvedIs3D: a heterogeneous collection can legitimately
                    // have both 2D and 3D members, each independently auto-detected. An explicit
                    // true/false still cascades uniformly since the raw value is unchanged.
                    mode3D: options.mode3D
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

    // Possible longitude values:
    const lonCandidates = [
        'lon', 'long', 'longitude', 'lng',
        'e', 'x', 'easting', 'east'
    ];
    // Possible latitude values:
    const latCandidates = [
        'lat', 'latitude',
        'n', 'y', 'northing', 'north'
    ];

    const isLon = (axis: string) => lonCandidates.includes(axis);
    const isLat = (axis: string) => latCandidates.includes(axis);

    let status  = 'unknown';
    if (isLon(axis0) && isLat(axis1)) {
        status = 'longlat';
    } else if (isLat(axis0) && isLon(axis1)) {
        status = 'latlong';
    }
    return status === 'latlong';
}

function coordHasZ(coordinates: PointCoordinates): boolean {
    return coordinates.length === 3 && coordinates[2] !== 0;
}

function norm360(degrees: number): number {
    return ((degrees % 360) + 360) % 360;
}

// GMLGeometryParser.js's ArcByCenterPoint decoding always walks from startAngle to endAngle in the
// mathematically-increasing (counterclockwise) direction: startAzimuth = norm360(90 - startAngle),
// and sweepAngle = -norm360(endAngle - startAngle) (a 0-degree delta mapping to -360, i.e. a full
// circle, identical to what an omitted endAngle produces). Crucially, that CCW-only walk means a
// (startAngle, endAngle) pair can only ever represent ONE of the two arcs between those two points
// (the minor one or the major one, depending which point is labelled "start") - it cannot encode
// "go the other way around". Naively placing the shape's own start point at GML's startAngle and
// computing endAngle by adding the (always non-negative) CCW delta therefore only reproduces the
// original arc when sweepAngle was already <= 0 (RIA's own compass convention, where negative
// means counterclockwise, i.e. already the direction this walk assumes) - for a positive
// (clockwise) sweepAngle it silently reproduces the *complementary* arc instead (same two
// endpoints, but the other side of the circle). Confirmed empirically: encoding startAzimuth=30,
// sweepAngle=200 and decoding the result back gives a shape with a visibly different bounding box
// than the original (see AdvancedGMLCodec.test.ts). The fix: for a positive sweepAngle, swap which
// of the two endpoints gets labelled GML's "start" vs "end", so the CCW walk still traces the
// correct side. This means a decoded positive-sweep Arc/CircularArc comes back with a different
// (but geometrically equivalent - same band, same curve) startAzimuth/sweepAngle pair: RIA's own
// decode range for sweepAngle is always (-360, 0], so an originally-positive sweep can never be
// echoed back verbatim, only as its geometrically-correct negative-sweep restatement.
function compassAzimuthSweepToMathAngles(
    startAzimuth: number, sweepAngle: number
): {startAngle: number, endAngle: number} {
    const startPointAngle = norm360(90 - startAzimuth);
    const isFullCircle = norm360(sweepAngle) === 0; // covers 0, ±360, ±720, ...
    // A full circle is always written as an explicit startAngle+360 endAngle, never omitted.
    // RIA's own GMLGeometryParser.js treats a missing endAngle as "full circle" and decodes
    // startAngle+360 identically (norm360 reduces it before subtracting either way), so this is
    // lossless for RIA - but not every GML consumer shares that "absent = full circle"
    // convention. Confirmed against a live LuciadFusion WFS-T service: omitting endAngle for a
    // full-sweep Insert was NOT interpreted as a full circle - it silently produced a 270-degree
    // arc instead. An explicit, unambiguous endAngle round-trips correctly through both.
    if (isFullCircle) return {startAngle: startPointAngle, endAngle: startPointAngle + 360};
    const endPointAngle = norm360(startPointAngle - sweepAngle);
    return sweepAngle > 0
        ? {startAngle: endPointAngle, endAngle: startPointAngle}
        : {startAngle: startPointAngle, endAngle: endPointAngle};
}

// Scans the whole geometry once: true if ANY coordinate has a non-zero Z. OGC GML requires uniform
// dimensionality within one gml:posList/gml:pos, so for the "flat" geometry types (a single coordinate
// array under one element) this must be an all-or-nothing decision for the whole element.
function geometryHasZ(geometry: GMLGeometry): boolean {
    switch (geometry.type) {
        case 'Point':
            return coordHasZ(geometry.coordinates);
        case 'LineString':
        case 'MultiPoint':
            return geometry.coordinates.some(coordHasZ);
        case 'Polygon':
        case 'MultiLineString':
        case 'MultiCurve':
            return geometry.coordinates.some(ring => ring.some(coordHasZ));
        case 'MultiPolygon':
        case 'MultiSurface':
            return geometry.coordinates.some(polygon => polygon.some(ring => ring.some(coordHasZ)));
        case 'MultiGeometry':
        case 'GeometryCollection':
            return geometry.geometries.some(geometryHasZ);
        case 'Circle':
        case 'Arc':
            return coordHasZ(geometry.center);
        default:
            return false;
    }
}

function resolveMode3D(mode3D: boolean | undefined, geometry: GMLGeometry): boolean {
    return typeof mode3D === "boolean" ? mode3D : geometryHasZ(geometry);
}
