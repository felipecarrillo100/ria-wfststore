import {describe, expect, it} from 'vitest';
import {decodeStoredJSONFeature, verifyGeometryCompatibilityOrThrowError} from "./WFSTFeaturePreparation";
import {WFSTInvalidGeometry} from "./WFSTInvalidGeometry";

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

describe('decodeStoredJSONFeature', () => {
    it('decodes a stored GeoJSON feature string back into a Feature, preserving id and properties', () => {
        const jsonFeature = JSON.stringify({
            type: "Feature",
            id: "test_features.7",
            geometry: {type: "Point", coordinates: [1, 2]},
            properties: {label: "stored"}
        });

        const feature = decodeStoredJSONFeature(jsonFeature, "EPSG:4326");
        expect(feature).not.toBeNull();
        expect(feature.id).toBe("test_features.7");
        expect(feature.properties.label).toBe("stored");
    });

    it('returns null when the decoded FeatureCollection is empty', () => {
        const emptyCollection = JSON.stringify({type: "FeatureCollection", features: []});
        expect(decodeStoredJSONFeature(emptyCollection, "EPSG:4326")).toBeNull();
    });
});
