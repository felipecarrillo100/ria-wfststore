import {describe, expect, it} from 'vitest';
import {GMLFeatureEncoder} from "./GMLFeatureEncoder";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {createArc, createCircleByCenterPoint, createPoint, createPolygon, createPolyline, createShapeList} from "@luciad/ria/shape/ShapeFactory";
import {Feature} from "@luciad/ria/model/feature/Feature";
import {GMLCodec} from "@luciad/ria/model/codec/GMLCodec";
import {Circle} from "@luciad/ria/shape/Circle";
import {Arc} from "@luciad/ria/shape/Arc";
import {WFSTInvalidGeometry} from "./WFSTInvalidGeometry";

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

// Phase 4: Circle/Arc bypass the usual GeoJSON-intermediate path entirely (see
// tryBuildCircularGeometryJSON), built directly from the RIA shape instead. This is the actual
// production WFS-T write path (WFSTQueries.singleAdd2_0_0/singleUpdate2_0_0 call
// encoder.encodeFeature() directly), so it's verified separately from AdvancedGMLCodec's own
// tests for the same underlying shared helper. gml:GeometryPropertyType is used as the target -
// there is no dedicated "Circle"/"Arc"/"Curve" schema type in GMLGeometryTypeToGeometry's map
// (mirroring real DescribeFeatureType practice: a column that can hold a curve is typed generic).
describe('GMLFeatureEncoder Circle/Arc support (Phase 4)', () => {
    const circularReference = getReference("EPSG:4326");

    // encodeFeature()'s `geometry` return value is already unwrapped from its own <geometry>
    // container (see GMLFeatureEncoder.XMLUnwrap) - re-wrap it for a real GMLCodec.decode() call,
    // the same pattern GMLCodecCircularShapeSupport.test.ts uses.
    function decodeGeometryFragment(geometryXML: string) {
        const codec = new GMLCodec();
        const content = `<?xml version="1.0" encoding="UTF-8"?>
<gml:FeatureCollection xmlns:gml="http://www.opengis.net/gml/3.2" gml:id="FC1">
  <gml:featureMember>
    <gml:Feature gml:id="f.1"><geometry>${geometryXML}</geometry></gml:Feature>
  </gml:featureMember>
</gml:FeatureCollection>`;
        const cursor = codec.decode({content, contentType: "application/gml+xml; version=3.2", reference: circularReference});
        return cursor.hasNext() ? cursor.next() : null;
    }

    it('Circle: encodeFeature() output is decodable and preserves center/radius', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:GeometryPropertyType"});
        const circle = createCircleByCenterPoint(circularReference, createPoint(circularReference, [10, 20]), 250);
        const feature = new Feature(circle, {label: "circle"}, "f.circle");

        const {geometry, geometryType} = encoder.encodeFeature(feature);
        expect(geometryType).toBe("Circle");
        expect(geometry).toContain("gml:CircleByCenterPoint");

        const decoded = decodeGeometryFragment(geometry);
        const decodedCircle = decoded.shape as Circle;
        expect(decodedCircle.center.x).toBeCloseTo(10, 6);
        expect(decodedCircle.center.y).toBeCloseTo(20, 6);
        expect(decodedCircle.radius).toBeCloseTo(250, 6);
    });

    it('Arc: encodeFeature() output is decodable and preserves center/radius/azimuth/sweep', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:GeometryPropertyType"});
        const arc = createArc(circularReference, createPoint(circularReference, [0, 0]), 100, 100, 0, 45, -60);
        const feature = new Feature(arc, {}, "f.arc");

        const {geometry, geometryType} = encoder.encodeFeature(feature);
        expect(geometryType).toBe("Arc");
        expect(geometry).toContain("gml:ArcByCenterPoint");

        const decoded = decodeGeometryFragment(geometry);
        const decodedArc = decoded.shape as Arc;
        expect(decodedArc.a).toBeCloseTo(100, 6);
        expect(decodedArc.startAzimuth).toBeCloseTo(45, 6);
        expect(decodedArc.sweepAngle).toBeCloseTo(-60, 6);
    });

    it('an elliptical Arc (a !== b) throws through GMLFeatureEncoder too, not just AdvancedGMLCodec', () => {
        const encoder = new GMLFeatureEncoder({targetGeometry: "gml:GeometryPropertyType"});
        const arc = createArc(circularReference, createPoint(circularReference, [0, 0]), 100, 50, 0, 0, -90);
        const feature = new Feature(arc, {}, "f.arc-elliptical");

        expect(() => encoder.encodeFeature(feature)).toThrow(WFSTInvalidGeometry);
    });
});
