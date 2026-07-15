import {Shape} from "@luciad/ria/shape/Shape";
import {ShapeType} from "@luciad/ria/shape/ShapeType";
import {Circle} from "@luciad/ria/shape/Circle";
import {Arc} from "@luciad/ria/shape/Arc";
import {CircularArc} from "@luciad/ria/shape/CircularArc";
import {Point} from "@luciad/ria/shape/Point";
import {PointCoordinates} from "@luciad/ria/shape/PointCoordinate";
import {GMLArc, GMLCircle} from "./GMLGeometry";
import {WFSTInvalidGeometry} from "../../WFSTInvalidGeometry";

// Cheap shape-type check with no encoding involved - reused by tryBuildCircularGeometryJSON below
// and by any caller (e.g. WFSTFeatureStore.add()'s pre-flight schema-compatibility check) that
// only needs to know "is this a Circle/Arc" without building the full GML JSON, so it doesn't
// have to fall back to GeoJsonCodec (which throws on these shapes) just to find that out.
//
// Two distinct, unrelated RIA shape families both encode to the same gml:ArcByCenterPoint: the
// generic elliptical Arc (ShapeType.ARC, has independent a/b semi-axes, only valid here when
// a === b) and CircularArc (ShapeType.CIRCULAR_ARC - CircularArcByCenterPoint etc., a single
// `radius`, structurally circular by construction, no a !== b case possible). Prefer CircularArc
// whenever it's available as an input: unlike Arc, its interactive RIA editor can't drift it into
// a non-circular ellipse, which the generic Arc editor allows and this library must then reject.
export function detectCircularShapeTypeName(shape: Shape): "Circle" | "Arc" | null {
    if (ShapeType.contains(shape.type, ShapeType.CIRCLE)) return "Circle";
    if (ShapeType.contains(shape.type, ShapeType.ARC) || ShapeType.contains(shape.type, ShapeType.CIRCULAR_ARC)) return "Arc";
    return null;
}

// Shared by GMLFeatureEncoder (schema-aware WFS-T encoding) and AdvancedGMLCodec
// (schema-independent encoding) - both otherwise route every shape through RIA's own
// GeoJsonCodec first, which throws outright on Circle/Arc. Building the GML JSON directly from
// the shape's own properties sidesteps that entirely; returns null for every other shape type so
// callers fall back to their normal GeoJSON-based path unchanged.
export function tryBuildCircularGeometryJSON(shape: Shape, srsName: string, id: string): GMLCircle | GMLArc | null {
    const typeName = detectCircularShapeTypeName(shape);
    if (typeName === "Circle") {
        const circle = shape as Circle;
        return {
            type: "Circle",
            id,
            srsName,
            center: pointToCoordinates(circle.center),
            radius: circle.radius
        };
    }
    if (typeName === "Arc") {
        if (ShapeType.contains(shape.type, ShapeType.CIRCULAR_ARC)) {
            // Structurally circular already (single radius, no a/b to mismatch) - no validation needed.
            const circularArc = shape as CircularArc;
            return {
                type: "Arc",
                id,
                srsName,
                center: pointToCoordinates(circularArc.center),
                radius: circularArc.radius,
                startAzimuth: circularArc.startAzimuth,
                sweepAngle: circularArc.sweepAngle
            };
        }
        const arc = shape as Arc;
        // GML 3.2's ArcByCenterPoint has a single radius - no standard segment exists for a
        // genuinely elliptical arc (a !== b), same reason Ellipse/ArcBand/Sector are excluded
        // entirely (see GMLCodecCircularShapeSupport.test.ts).
        if (Math.abs(arc.a - arc.b) > 1e-6) {
            throw new WFSTInvalidGeometry(
                `Arc with distinct semi-major/semi-minor axes (a=${arc.a}, b=${arc.b}) has no standard GML 3.2 representation - only circular arcs (a === b) can be encoded as gml:ArcByCenterPoint`
            );
        }
        return {
            type: "Arc",
            id,
            srsName,
            center: pointToCoordinates(arc.center),
            radius: arc.a,
            startAzimuth: arc.startAzimuth,
            sweepAngle: arc.sweepAngle
        };
    }
    return null;
}

// Always 3 elements (z defaults to 0 for a structurally-2D point, same as every other geometry
// type here) - encodeGeometryToGML's own coordHasZ/mode3D auto-detection decides 2D vs 3D output
// from whether z is actually non-zero, not from this array's length.
function pointToCoordinates(point: Point): PointCoordinates {
    return [point.x, point.y, point.z];
}
