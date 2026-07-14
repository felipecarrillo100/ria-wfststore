import {describe, expect, it} from 'vitest';
import {GMLFeatureEncoder} from "./GMLFeatureEncoder";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {createPoint, createPolygon} from "@luciad/ria/shape/ShapeFactory";
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
