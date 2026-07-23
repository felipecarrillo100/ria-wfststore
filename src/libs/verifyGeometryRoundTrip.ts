import {Shape} from "@luciad/ria/shape/Shape";
import {ShapeList} from "@luciad/ria/shape/ShapeList";
import {Bounds} from "@luciad/ria/shape/Bounds";
import {detectCircularShapeTypeName} from "./gml/gml32/encodeCircularShapeToJSON";
import {WFSTGeometryRoundTripError} from "./WFSTGeometryRoundTripError";

/**
 * A server can accept a WFS-T Insert/Update of a Circle/Arc yet silently degrade it into
 * something unreadable on the very next `GetFeature` - confirmed against a live LuciadFusion
 * service, which re-encodes any geometrically closed curve as a Polygon boundary RIA's decoder
 * can't read back into a circle at all. Left unchecked, {@link WFSTFeatureStore.add}/
 * {@link WFSTFeatureStore.put} report success and the failure only surfaces later, on reload,
 * disconnected from the save action that caused it.
 *
 * Scoped to Circle/Arc only - the one demonstrated failure class - so every other geometry type
 * pays nothing beyond this cheap gate.
 *
 * @param shape the shape about to be (or just was) written.
 * @returns true if `shape` is a Circle/Arc and therefore worth round-trip-verifying via
 *          {@link assertGeometryRoundTrip}.
 */
export function shouldVerifyRoundTrip(shape: Shape | null): boolean {
    return !!shape && detectCircularShapeTypeName(shape) !== null;
}

// Bounds differing by more than this fraction of the original's own width/height are treated as
// a genuinely different shape, not floating-point/reprojection noise. Precedent for a tolerance
// of this order: AdvancedGMLCodec.test.ts's "Circle by 3 points" case documents a ~0.5-1% bias
// even for exact input on a geodetic reference: this is deliberately wider than that, to absorb
// real drift while still catching "came back null/empty/wildly different".
/**
 * Bounds differing by more than this fraction of the original's own width/height are treated as
 * a genuinely different shape, not floating-point/reprojection noise - see
 * {@link boundsRoughlyMatch}. Precedent for a tolerance of this order: `AdvancedGMLCodec.test.ts`'s
 * "Circle by 3 points" case documents a ~0.5-1% bias even for exact input on a geodetic reference:
 * this is deliberately wider than that, to absorb real drift while still catching "came back
 * null/empty/wildly different".
 */
const RELATIVE_BOUNDS_TOLERANCE = 0.05;

/**
 * Verifies that `decoded` (a freshly-read-back shape, immediately after a WFS-T Insert/Update of
 * `original`) is still recognizably the same geometry, bounds-wise - the actual check behind
 * {@link shouldVerifyRoundTrip}'s gate.
 *
 * Throws {@link WFSTGeometryRoundTripError} (mirrors {@link WFSTInvalidGeometry}'s own
 * throw-on-failure style, used for the analogous encode-time validation case) rather than
 * returning a result value - callers are expected to catch it exactly like the existing
 * `WFSTInvalidGeometry` catch blocks in {@link WFSTFeatureStore.add}/{@link WFSTFeatureStore.put}.
 * Not exported from `index.ts`: purely an internal signal, same as `WFSTInvalidGeometry`.
 *
 * @param original the shape as it was sent.
 * @param decoded  the shape as read back from the server immediately after, or null if nothing
 *                 could be decoded at all.
 * @throws {WFSTGeometryRoundTripError} if `decoded` is null, an empty `ShapeList`, or its bounds
 *         don't roughly match `original`'s (see {@link boundsRoughlyMatch}).
 */
export function assertGeometryRoundTrip(original: Shape, decoded: Shape | null): void {
    if (!decoded) {
        throw new WFSTGeometryRoundTripError("the server did not return a decodable shape for the feature just written");
    }
    // A flat, single-level unwrap only - WFSTFeatureStore accepts any decode codec, not just
    // AdvancedGMLCodec, so a caller using a different codec wouldn't get
    // normalizeDecodedArcShape's own ShapeList(1) unwrap for free.
    let comparable = decoded;
    if (decoded instanceof ShapeList) {
        if (decoded.shapeCount === 0) {
            throw new WFSTGeometryRoundTripError("the server returned an empty geometry collection for the feature just written");
        }
        if (decoded.shapeCount === 1) {
            comparable = decoded.getShape(0);
        }
    }
    const originalBounds = original.bounds;
    const decodedBounds = comparable.bounds;
    if (!originalBounds || !decodedBounds || !boundsRoughlyMatch(originalBounds, decodedBounds)) {
        throw new WFSTGeometryRoundTripError(
            `decoded geometry does not match what was sent (sent bounds ${describeBounds(originalBounds)}, got back ${describeBounds(decodedBounds)})`
        );
    }
}

/** @returns true if `a` and `b` match within {@link RELATIVE_BOUNDS_TOLERANCE} of `a`'s own scale, in every one of x/y/width/height. */
function boundsRoughlyMatch(a: Bounds, b: Bounds): boolean {
    const scale = Math.max(a.width, a.height, 1e-9);
    const tolerance = scale * RELATIVE_BOUNDS_TOLERANCE;
    return Math.abs(a.x - b.x) <= tolerance
        && Math.abs(a.y - b.y) <= tolerance
        && Math.abs(a.width - b.width) <= tolerance
        && Math.abs(a.height - b.height) <= tolerance;
}

/** @returns a human-readable one-line summary of `bounds` (or `"none"` if null), for {@link assertGeometryRoundTrip}'s error message. */
function describeBounds(bounds: Bounds | null): string {
    if (!bounds) return "none";
    return `[x=${bounds.x}, y=${bounds.y}, w=${bounds.width}, h=${bounds.height}]`;
}
