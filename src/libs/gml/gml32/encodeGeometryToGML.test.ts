import {describe, expect, it} from 'vitest';
import {encodeGeometryToGML} from "./encodeGeometryToGML";
import {GMLGeometry} from "./GMLGeometry";

// First direct unit test for this module (previously only exercised indirectly via
// AdvancedGMLCodec.test.ts and live-GeoServer integration tests). Pure function, jsdom-only,
// no network - builds GMLGeometry literals directly and asserts structurally via DOMParser.

function parseXML(content: string): Document {
    // encodeGeometryToGML(), called standalone (no inDoc), returns a full document of its own
    // (its own XML declaration, and it never declares xmlns:gml itself - that's the caller's job,
    // normally done by encodeFeatureToGML/AdvancedGMLCodec on an ancestor element). Strip the
    // declaration and supply the namespace via a wrapper root so DOMParser can resolve gml: at all.
    const withoutDeclaration = content.replace(/^<\?xml[^>]*\?>/, '');
    return new DOMParser().parseFromString(`<root xmlns:gml="http://www.opengis.net/gml/3.2">${withoutDeclaration}</root>`, "application/xml");
}

function point(coordinates: any): GMLGeometry {
    return {type: 'Point', id: 'p.1', srsName: 'CRS:84', coordinates} as GMLGeometry;
}

function lineString(coordinates: any[]): GMLGeometry {
    return {type: 'LineString', id: 'l.1', srsName: 'CRS:84', coordinates} as GMLGeometry;
}

function polygon(rings: any[][]): GMLGeometry {
    return {type: 'Polygon', id: 'poly.1', srsName: 'CRS:84', coordinates: rings} as GMLGeometry;
}

function multiGeometry(geometries: GMLGeometry[]): GMLGeometry {
    return {type: 'MultiGeometry', id: 'mg.1', srsName: 'CRS:84', geometries} as GMLGeometry;
}

describe('encodeGeometryToGML - 2D backward compatibility (mode3D omitted, all-2D input)', () => {
    it('Point: no srsDimension, exactly 2 numbers', () => {
        const doc = parseXML(encodeGeometryToGML(point([10, 20]), {}));
        const pointEl = doc.getElementsByTagName('gml:Point')[0];
        expect(pointEl.getAttribute('srsDimension')).toBeNull();
        expect(doc.getElementsByTagName('gml:pos')[0].textContent).toBe('10 20');
    });

    it('LineString: no srsDimension, 2 numbers per position', () => {
        const doc = parseXML(encodeGeometryToGML(lineString([[0, 0], [1, 1]]), {}));
        expect(doc.getElementsByTagName('gml:LineString')[0].getAttribute('srsDimension')).toBeNull();
        expect(doc.getElementsByTagName('gml:posList')[0].textContent).toBe('0 0 1 1');
    });

    it('Polygon: no srsDimension, 2 numbers per position', () => {
        const ring = [[0, 0], [0, 10], [10, 10], [0, 0]];
        const doc = parseXML(encodeGeometryToGML(polygon([ring]), {}));
        expect(doc.getElementsByTagName('gml:Polygon')[0].getAttribute('srsDimension')).toBeNull();
        expect(doc.getElementsByTagName('gml:posList')[0].textContent).toBe('0 0 0 10 10 10 0 0');
    });
});

describe('encodeGeometryToGML - explicit mode3D overrides', () => {
    it('mode3D:true forces 3D on all-2D input (Z padded with 0)', () => {
        const doc = parseXML(encodeGeometryToGML(point([10, 20]), {mode3D: true}));
        expect(doc.getElementsByTagName('gml:Point')[0].getAttribute('srsDimension')).toBe('3');
        expect(doc.getElementsByTagName('gml:pos')[0].textContent).toBe('10 20 0');
    });

    it('mode3D:false drops Z from genuinely-3D input', () => {
        const doc = parseXML(encodeGeometryToGML(point([10, 20, 55]), {mode3D: false}));
        expect(doc.getElementsByTagName('gml:Point')[0].getAttribute('srsDimension')).toBeNull();
        expect(doc.getElementsByTagName('gml:pos')[0].textContent).toBe('10 20');
    });
});

describe('encodeGeometryToGML - auto-detection (mode3D omitted)', () => {
    it('Point with real Z: srsDimension=3, Z preserved', () => {
        const doc = parseXML(encodeGeometryToGML(point([10, 20, 55]), {}));
        expect(doc.getElementsByTagName('gml:Point')[0].getAttribute('srsDimension')).toBe('3');
        expect(doc.getElementsByTagName('gml:pos')[0].textContent).toBe('10 20 55');
    });

    it('LineString with one real-Z vertex: whole element becomes 3D, Z=0 padded on the other vertex', () => {
        const doc = parseXML(encodeGeometryToGML(lineString([[0, 0, 0], [1, 1, 5]]), {}));
        expect(doc.getElementsByTagName('gml:LineString')[0].getAttribute('srsDimension')).toBe('3');
        expect(doc.getElementsByTagName('gml:posList')[0].textContent).toBe('0 0 0 1 1 5');
    });

    it('Polygon ring with a real-Z vertex: whole ring becomes 3D', () => {
        const ring = [[0, 0, 10], [0, 10, 10], [10, 10, 10], [0, 0, 10]];
        const doc = parseXML(encodeGeometryToGML(polygon([ring]), {}));
        expect(doc.getElementsByTagName('gml:Polygon')[0].getAttribute('srsDimension')).toBe('3');
        expect(doc.getElementsByTagName('gml:posList')[0].textContent).toBe('0 0 10 0 10 10 10 10 10 0 0 10');
    });

    it('structurally-3-length but all-Z-zero input stays 2D (proves the upstream mode3D:true GeoJsonCodec flip stays backward compatible)', () => {
        const doc = parseXML(encodeGeometryToGML(point([10, 20, 0]), {}));
        expect(doc.getElementsByTagName('gml:Point')[0].getAttribute('srsDimension')).toBeNull();
        expect(doc.getElementsByTagName('gml:pos')[0].textContent).toBe('10 20');
    });
});

describe('encodeGeometryToGML - MultiGeometry/GeometryCollection with mixed dimensionality', () => {
    it('mode3D omitted: each member independently auto-detects', () => {
        const doc = parseXML(encodeGeometryToGML(multiGeometry([
            point([1, 1]),
            point([2, 2, 9])
        ]), {}));
        const points = doc.getElementsByTagName('gml:Point');
        expect(points.length).toBe(2);
        expect(points[0].getAttribute('srsDimension')).toBeNull();
        expect(points[1].getAttribute('srsDimension')).toBe('3');
        expect(doc.getElementsByTagName('gml:MultiGeometry')[0].getAttribute('srsDimension')).toBeNull();
    });

    it('mode3D:true forced: cascades uniformly, both members become 3D', () => {
        const doc = parseXML(encodeGeometryToGML(multiGeometry([
            point([1, 1]),
            point([2, 2, 9])
        ]), {mode3D: true}));
        const points = doc.getElementsByTagName('gml:Point');
        expect(points[0].getAttribute('srsDimension')).toBe('3');
        expect(points[1].getAttribute('srsDimension')).toBe('3');
    });
});

describe('encodeGeometryToGML - axis invert never swaps Z', () => {
    it('invert:true swaps X/Y but leaves Z untouched', () => {
        const doc = parseXML(encodeGeometryToGML(point([10, 20, 55]), {invert: true}));
        expect(doc.getElementsByTagName('gml:pos')[0].textContent).toBe('20 10 55');
    });
});

describe('encodeGeometryToGML - GeoServer EPSG:4979 srsName workaround', () => {
    // See the GeoServerWorkAround doc comment in encodeGeometryToGML.ts for the full story: this
    // exact URN triggers a ClassCastException in GeoServer's WFS-T insert handling, even though
    // GeoServer's own GetCapabilities is what tells clients to use it as this CRS's srsName.
    it('rewrites the EPSG:4979 URN to the short form GeoServer/LuciadFusion both accept', () => {
        const geometry = {type: 'Point', id: 'p.1', srsName: 'urn:ogc:def:crs:EPSG::4979', coordinates: [10, 20, 55]} as GMLGeometry;
        const doc = parseXML(encodeGeometryToGML(geometry, {}));
        expect(doc.getElementsByTagName('gml:Point')[0].getAttribute('srsName')).toBe('EPSG:4979');
    });

    it('leaves every other srsName untouched - the workaround is scoped to this one CRS/string', () => {
        const doc = parseXML(encodeGeometryToGML(point([10, 20]), {}));
        expect(doc.getElementsByTagName('gml:Point')[0].getAttribute('srsName')).toBe('CRS:84');
    });
});

describe('encodeGeometryToGML - usePosList:false with 3D', () => {
    it('each individual gml:pos child carries the correct 3-value triplet', () => {
        const doc = parseXML(encodeGeometryToGML(lineString([[0, 0, 1], [1, 1, 2]]), {usePosList: false}));
        const positions = doc.getElementsByTagName('gml:pos');
        expect(positions.length).toBe(2);
        expect(positions[0].textContent).toBe('0 0 1');
        expect(positions[1].textContent).toBe('1 1 2');
    });

    it('MultiGeometry forwards usePosList to nested members (pre-existing gap, fixed alongside the 3D work)', () => {
        const doc = parseXML(encodeGeometryToGML(multiGeometry([
            lineString([[0, 0], [1, 1]])
        ]), {usePosList: false}));
        expect(doc.getElementsByTagName('gml:posList').length).toBe(0);
        expect(doc.getElementsByTagName('gml:pos').length).toBe(2);
    });
});
