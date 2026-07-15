import {describe, expect, it} from 'vitest';
import {decodeStoredFeature, verifyGeometryCompatibilityOrThrowError} from "./WFSTFeaturePreparation";
import {WFSTInvalidGeometry} from "./WFSTInvalidGeometry";
import {AdvancedGMLCodec} from "./gml/gml32/AdvancedGMLCodec";
import {createCircularArcByCenterPoint, createPoint} from "@luciad/ria/shape/ShapeFactory";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {Feature} from "@luciad/ria/model/feature/Feature";
import {ShapeType} from "@luciad/ria/shape/ShapeType";
import {Cursor} from "@luciad/ria/model/Cursor";

// Extracted out of WFSTQueries.ts (Phase 3 slice 3) so this validation/decoding logic is
// directly testable, rather than only reachable through a full XML-templating call. Previously
// had zero direct coverage - only ever exercised indirectly via WFSTFeatureStore's add()/put()/
// commitLockTransaction() round-trip tests.

describe('verifyGeometryCompatibilityOrThrowError', () => {
    it('does not throw when the produced geometry matches the target GML type', () => {
        expect(() => verifyGeometryCompatibilityOrThrowError("Point", "gml:PointPropertyType" as any)).not.toThrow();
    });

    it('does not throw when the target is the generic gml:GeometryPropertyType (accepts anything)', () => {
        expect(() => verifyGeometryCompatibilityOrThrowError("MultiSurface", "gml:GeometryPropertyType" as any)).not.toThrow();
    });

    it('throws WFSTInvalidGeometry when the produced geometry does not match the target GML type', () => {
        expect(() => verifyGeometryCompatibilityOrThrowError("Polygon", "gml:PointPropertyType" as any))
            .toThrow(WFSTInvalidGeometry);
    });
});

describe('decodeStoredFeature', () => {
    it('decodes a stored GeoJSON feature string back into a Feature, preserving id and properties', () => {
        const jsonFeature = JSON.stringify({
            type: "Feature",
            id: "test_features.7",
            geometry: {type: "Point", coordinates: [1, 2]},
            properties: {label: "stored"}
        });

        const feature = decodeStoredFeature(jsonFeature, "EPSG:4326");
        expect(feature).not.toBeNull();
        expect(feature.id).toBe("test_features.7");
        expect(feature.properties.label).toBe("stored");
    });

    it('returns null when the decoded FeatureCollection is empty', () => {
        const emptyCollection = JSON.stringify({type: "FeatureCollection", features: []});
        expect(decodeStoredFeature(emptyCollection, "EPSG:4326")).toBeNull();
    });

    // WFSTFeatureLockStore stores GML instead of GeoJSON when its delegate store is
    // GML-configured (GeoJSON has no representation for Circle/Arc at all) - decodeStoredFeature
    // must recognize and decode that format too, distinguishing it from GeoJSON by content alone.
    it('decodes a stored GML feature string (not GeoJSON) back into a Feature', () => {
        const reference = getReference("EPSG:4326");
        const codec = new AdvancedGMLCodec();
        const point = createPoint(reference, [1, 2]);
        const feature = new Feature(point, {label: "stored-gml"}, "test_features.9");
        let done = false;
        const cursor: Cursor<Feature> = {hasNext: () => !done, next: () => { done = true; return feature; }};
        const gmlContent = codec.encode(cursor).content;

        const decoded = decodeStoredFeature(gmlContent, "EPSG:4326");
        expect(decoded).not.toBeNull();
        expect(decoded.id).toBe("test_features.9");
        expect(decoded.properties.label).toBe("stored-gml");
    });

    it('decodes a stored GML CircularArcByCenterPoint feature, which GeoJSON could never represent at all', () => {
        const reference = getReference("EPSG:4326");
        const codec = new AdvancedGMLCodec();
        const shape = createCircularArcByCenterPoint(reference, createPoint(reference, [0, 0]), 500, 30, 200);
        const feature = new Feature(shape, {}, "test_features.10");
        let done = false;
        const cursor: Cursor<Feature> = {hasNext: () => !done, next: () => { done = true; return feature; }};
        const gmlContent = codec.encode(cursor).content;

        const decoded = decodeStoredFeature(gmlContent, "EPSG:4326");
        expect(decoded).not.toBeNull();
        const decodedShape: any = decoded.shape;
        expect(ShapeType.contains(decodedShape.type, ShapeType.CIRCULAR_ARC) || ShapeType.contains(decodedShape.type, ShapeType.ARC)).toBe(true);
    });
});
