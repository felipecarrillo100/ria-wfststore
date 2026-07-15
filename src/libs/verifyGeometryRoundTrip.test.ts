import {describe, expect, it} from "vitest";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {
    createCircleByCenterPoint,
    createCircularArcByCenterPoint,
    createPoint,
    createPolygon,
    createPolyline,
    createShapeList
} from "@luciad/ria/shape/ShapeFactory";
import {assertGeometryRoundTrip, shouldVerifyRoundTrip} from "./verifyGeometryRoundTrip";
import {WFSTGeometryRoundTripError} from "./WFSTGeometryRoundTripError";

const reference = getReference("EPSG:4326");

describe("shouldVerifyRoundTrip", () => {
    it("is true for Circle", () => {
        expect(shouldVerifyRoundTrip(createCircleByCenterPoint(reference, createPoint(reference, [0, 0]), 500))).toBe(true);
    });
    it("is true for CircularArcByCenterPoint", () => {
        expect(shouldVerifyRoundTrip(createCircularArcByCenterPoint(reference, createPoint(reference, [0, 0]), 500, 0, 90))).toBe(true);
    });
    it("is false for Point/Polygon/Polyline", () => {
        expect(shouldVerifyRoundTrip(createPoint(reference, [0, 0]))).toBe(false);
        expect(shouldVerifyRoundTrip(createPolygon(reference, [[0, 0], [1, 0], [1, 1]]))).toBe(false);
        expect(shouldVerifyRoundTrip(createPolyline(reference, [[0, 0], [1, 1]]))).toBe(false);
    });
    it("is false for null", () => {
        expect(shouldVerifyRoundTrip(null)).toBe(false);
    });
});

describe("assertGeometryRoundTrip", () => {
    it("does not throw when decoded bounds match the original", () => {
        const original = createCircularArcByCenterPoint(reference, createPoint(reference, [0, 0]), 500, 30, 200);
        const decoded = createCircularArcByCenterPoint(reference, createPoint(reference, [0, 0]), 500, 30, 200);
        expect(() => assertGeometryRoundTrip(original, decoded)).not.toThrow();
    });

    it("does not throw for drift within the relative tolerance", () => {
        const original = createCircleByCenterPoint(reference, createPoint(reference, [0, 0]), 500);
        const decoded = createCircleByCenterPoint(reference, createPoint(reference, [0.00001, 0]), 500);
        expect(() => assertGeometryRoundTrip(original, decoded)).not.toThrow();
    });

    it("throws when decoded is null", () => {
        const original = createCircleByCenterPoint(reference, createPoint(reference, [0, 0]), 500);
        expect(() => assertGeometryRoundTrip(original, null)).toThrow(WFSTGeometryRoundTripError);
    });

    it("throws when decoded is an empty ShapeList", () => {
        const original = createCircleByCenterPoint(reference, createPoint(reference, [0, 0]), 500);
        const decoded = createShapeList(reference, []);
        expect(() => assertGeometryRoundTrip(original, decoded)).toThrow(WFSTGeometryRoundTripError);
    });

    it("unwraps a single-member ShapeList and compares against that member", () => {
        const original = createCircleByCenterPoint(reference, createPoint(reference, [0, 0]), 500);
        const inner = createCircleByCenterPoint(reference, createPoint(reference, [0, 0]), 500);
        const decoded = createShapeList(reference, [inner]);
        expect(() => assertGeometryRoundTrip(original, decoded)).not.toThrow();
    });

    it("throws when decoded bounds are wildly different (e.g. the complementary/wrong arc)", () => {
        const original = createCircularArcByCenterPoint(reference, createPoint(reference, [0, 0]), 500, 30, 200);
        const decoded = createCircularArcByCenterPoint(reference, createPoint(reference, [0, 0]), 500, 30, -160);
        expect(() => assertGeometryRoundTrip(original, decoded)).toThrow(WFSTGeometryRoundTripError);
    });

    it("throws when decoded is a wrong-location circle entirely", () => {
        const original = createCircleByCenterPoint(reference, createPoint(reference, [0, 0]), 500);
        const decoded = createCircleByCenterPoint(reference, createPoint(reference, [50, 50]), 500);
        expect(() => assertGeometryRoundTrip(original, decoded)).toThrow(WFSTGeometryRoundTripError);
    });
});
