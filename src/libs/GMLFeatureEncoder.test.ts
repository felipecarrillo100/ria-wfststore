import {describe, expect, it} from 'vitest';
import {GMLFeatureEncoder} from "./GMLFeatureEncoder";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {createPoint, createPolygon, createPolyline, createShapeList} from "@luciad/ria/shape/ShapeFactory";
import {Feature} from "@luciad/ria/model/feature/Feature";

// First-ever direct unit test for this class (previously only indirectly exercised via
// AdvancedGMLCodec, which only calls the static encodeFeatureToGeoJSON helper, never
// encodeFeature() itself - the actual production WFS-T write path, via WFSTQueries). Pure
// jsdom, no network. Minimal scope: auto-detect/forced-mode3D passthrough, and one
// wrapToMultiSurface 3D regression case.

const reference = getReference("CRS:84");

describe('GMLFeatureEncoder 3D support', () => {
    it('2D feature (mode3D omitted): no srsDimension, byte-for-byte the pre-3D behavior', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:PointPropertyType"});
        const feature = new Feature(createPoint(reference, [1, 2]), {}, "f.1");

        const {geometry} = encoder.encodeFeature(feature);
        expect(geometry).not.toContain('srsDimension');
    });

    it('3D feature (mode3D omitted): auto-detects, srsDimension="3", Z preserved', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:PointPropertyType"});
        const feature = new Feature(createPoint(reference, [1, 2, 33]), {}, "f.1");

        const {geometry} = encoder.encodeFeature(feature);
        expect(geometry).toContain('srsDimension="3"');
        expect(geometry).toContain('33');
    });

    it('mode3D:true forces 3D output on 2D-only input', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:PointPropertyType", mode3D: true});
        const feature = new Feature(createPoint(reference, [1, 2]), {}, "f.1");

        const {geometry} = encoder.encodeFeature(feature);
        expect(geometry).toContain('srsDimension="3"');
    });

    it('mode3D:false drops Z on genuinely-3D input', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:PointPropertyType", mode3D: false});
        const feature = new Feature(createPoint(reference, [1, 2, 33]), {}, "f.1");

        const {geometry} = encoder.encodeFeature(feature);
        expect(geometry).not.toContain('srsDimension');
    });

    it('wrapToMultiSurface: 3D Polygon ring survives the coordinate-array wrap into MultiSurface', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:MultiSurfacePropertyType"});
        const ring = [[0, 0, 7], [0, 10, 7], [10, 10, 7], [10, 0, 7], [0, 0, 7]] as any;
        const feature = new Feature(createPolygon(reference, ring), {}, "f.1");

        const {geometry, geometryType} = encoder.encodeFeature(feature);
        expect(geometryType).toBe("MultiSurface");
        expect(geometry).toContain('gml:MultiSurface');
        expect(geometry).toContain('srsDimension="3"');
        expect(geometry).toContain('7');
    });
});

// Regression coverage for wrapToMulti{Surface,Curve,Point}'s two branches - wrapping a lone
// single-geometry feature into a Multi* structure, and remapping an already-Multi feature's
// GeoJSON type name (e.g. "MultiPolygon") to the GML type the server actually advertises (e.g.
// "MultiSurface") - locked in before table-driving the three near-identical branches in
// SingleFeatureGMLasJSONEncode, so the refactor can be verified byte-for-byte against these.
describe('GMLFeatureEncoder wrapToMulti* branches', () => {
    it('wrapToMultiSurface: a lone Polygon is wrapped into a single-member MultiSurface', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:MultiSurfacePropertyType"});
        const feature = new Feature(createPolygon(reference, [[0, 0], [0, 1], [1, 1], [0, 0]]), {}, "f.1");

        const {geometry, geometryType} = encoder.encodeFeature(feature);
        expect(geometryType).toBe("MultiSurface");
        expect(geometry).toContain('gml:MultiSurface');
        expect((geometry.match(/surfaceMember/g) || []).length).toBe(2); // open + close tag
    });

    it('wrapToMultiSurface: an already-MultiPolygon feature is remapped (not re-wrapped) to MultiSurface', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:MultiSurfacePropertyType"});
        const shapeList = createShapeList(reference, [
            createPolygon(reference, [[0, 0], [0, 1], [1, 1], [0, 0]]),
            createPolygon(reference, [[5, 5], [5, 6], [6, 6], [5, 5]]),
        ]);
        const feature = new Feature(shapeList, {}, "f.1");

        const {geometry, geometryType} = encoder.encodeFeature(feature);
        expect(geometryType).toBe("MultiSurface");
        expect(geometry).toContain('gml:MultiSurface');
        expect((geometry.match(/surfaceMember/g) || []).length).toBe(4); // 2 members, open + close each
    });

    it('wrapToMultiCurve: a lone LineString is wrapped into a single-member MultiCurve', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:MultiCurvePropertyType"});
        const feature = new Feature(createPolyline(reference, [[0, 0], [1, 1]] as any), {}, "f.1");

        const {geometry, geometryType} = encoder.encodeFeature(feature);
        expect(geometryType).toBe("MultiCurve");
        expect(geometry).toContain('gml:MultiCurve');
        expect((geometry.match(/curveMember/g) || []).length).toBe(2);
    });

    it('wrapToMultiCurve: an already-MultiLineString feature is remapped (not re-wrapped) to MultiCurve', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:MultiCurvePropertyType"});
        const shapeList = createShapeList(reference, [
            createPolyline(reference, [[0, 0], [1, 1]] as any),
            createPolyline(reference, [[5, 5], [6, 6], [7, 5]] as any),
        ]);
        const feature = new Feature(shapeList, {}, "f.1");

        const {geometry, geometryType} = encoder.encodeFeature(feature);
        expect(geometryType).toBe("MultiCurve");
        expect(geometry).toContain('gml:MultiCurve');
        expect((geometry.match(/curveMember/g) || []).length).toBe(4);
    });

    it('wrapToMultiPoint: a lone Point is wrapped into a single-member MultiPoint', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:MultiPointPropertyType"});
        const feature = new Feature(createPoint(reference, [1, 2]), {}, "f.1");

        const {geometry, geometryType} = encoder.encodeFeature(feature);
        expect(geometryType).toBe("MultiPoint");
        expect(geometry).toContain('gml:MultiPoint');
        expect((geometry.match(/pointMember/g) || []).length).toBe(2);
    });

    it('wrapToMultiPoint: an already-MultiPoint feature is left as MultiPoint (no remap needed)', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:MultiPointPropertyType"});
        const shapeList = createShapeList(reference, [
            createPoint(reference, [1, 2]),
            createPoint(reference, [3, 4]),
        ]);
        const feature = new Feature(shapeList, {}, "f.1");

        const {geometry, geometryType} = encoder.encodeFeature(feature);
        expect(geometryType).toBe("MultiPoint");
        expect(geometry).toContain('gml:MultiPoint');
        expect((geometry.match(/pointMember/g) || []).length).toBe(4);
    });
});
