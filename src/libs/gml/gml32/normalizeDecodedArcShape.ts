import {Shape} from "@luciad/ria/shape/Shape";
import {ShapeType} from "@luciad/ria/shape/ShapeType";
import {ShapeList} from "@luciad/ria/shape/ShapeList";
import {Arc} from "@luciad/ria/shape/Arc";
import {createCircularArcByCenterPoint} from "@luciad/ria/shape/ShapeFactory";

/**
 * Post-processes a shape freshly decoded by RIA's own `GMLCodec.decode()` (used by
 * {@link AdvancedGMLCodec.decode}) to undo two decode-time quirks that would otherwise make a
 * round-tripped Circle/Arc unsafe to keep editing:
 *
 * 1. RIA's own `GMLCodec.decode()` always reconstructs a `gml:ArcByCenterPoint` segment as the
 *    generic elliptical Arc (`ShapeType.ARC`, independent a/b semi-axes) - GML makes no
 *    distinction between it and `CircularArcByCenterPoint` (see `detectCircularShapeTypeName`'s
 *    own comment on this), so there is no "decode to CircularArc" path in RIA at all. Left as-is,
 *    a decoded circular arc is then editable via RIA's default `ArcEditor`, which allows dragging
 *    a/b independently into a genuine ellipse - exactly the shape this library's encoder must
 *    reject on the next save. Swapping it, right after decode, for the structurally-circular
 *    `CircularArcByCenterPoint` (single radius, no a/b to mismatch) closes that loop: a shape
 *    drawn as `CircularArcByCenterPoint`, saved, reloaded, and edited again can never become
 *    editable into an ellipse.
 *
 * 2. Separately: some servers (confirmed against a live LuciadFusion instance, for a
 *    generic/untyped PostGIS geometry column) always wrap `GetFeature` output in a
 *    `MultiGeometry`/`MultiCurve` container, even for a single member - RIA decodes that as a
 *    `ShapeList` of 1. Left as-is, a decoded circular feature's top-level `shape.type` is
 *    `SHAPE_LIST`, not `CIRCLE`/`CIRCULAR_ARC`, so any caller that only checks the top-level shape
 *    type (e.g. `detectCircularShapeTypeName`, used by both this codec's `encode()` and
 *    `GMLFeatureEncoder`'s WFS-T Update path) fails to recognize it at all and falls back to
 *    GeoJSON encoding, which throws on Circle/Arc - surfacing as a silent save failure the next
 *    time the reloaded feature is edited. Unwrapping a single-member collection down to its bare
 *    circular shape (scoped to Circle/Arc only, not multi-part Polygons/Polylines, which
 *    legitimately keep their `ShapeList`/collection identity) keeps a decoded circular feature's
 *    shape identical, in every way that matters downstream, to one freshly drawn via
 *    `createCircularArcByCenterPoint()`/`createCircleByCenterPoint()`.
 *
 * @param shape the freshly-decoded shape to normalize (recurses into `ShapeList` members).
 * @returns the normalized shape - the same instance if neither quirk applied.
 */
export function normalizeDecodedArcShape(shape: Shape): Shape {
    if (shape instanceof ShapeList) {
        for (let i = 0; i < shape.shapeCount; i++) {
            const inner = shape.getShape(i);
            const normalized = normalizeDecodedArcShape(inner);
            if (normalized !== inner) {
                shape.removeShape(i);
                shape.addShape(i, normalized);
            }
        }
        if (shape.shapeCount === 1) {
            const onlyMember = shape.getShape(0);
            if (isCircularShape(onlyMember)) {
                return onlyMember;
            }
        }
        return shape;
    }
    if (ShapeType.contains(shape.type, ShapeType.ARC)) {
        const arc = shape as Arc;
        if (Math.abs(arc.a - arc.b) <= 1e-6) {
            return createCircularArcByCenterPoint(arc.reference, arc.center, arc.a, arc.startAzimuth, arc.sweepAngle);
        }
    }
    return shape;
}

/** @returns true if `shape` is a structurally-circular Circle or CircularArc (not a generic possibly-elliptical Arc). */
function isCircularShape(shape: Shape): boolean {
    return ShapeType.contains(shape.type, ShapeType.CIRCLE) || ShapeType.contains(shape.type, ShapeType.CIRCULAR_ARC);
}
