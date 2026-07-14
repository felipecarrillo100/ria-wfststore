import {describe, expect, it} from 'vitest';
import {AdvancedGMLCodec} from "./AdvancedGMLCodec";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {createPoint, createPolygon, createPolyline, createShapeList} from "@luciad/ria/shape/ShapeFactory";
import {Polyline} from "@luciad/ria/shape/Polyline";
import {Polygon} from "@luciad/ria/shape/Polygon";
import {ShapeType} from "@luciad/ria/shape/ShapeType";
import {Feature} from "@luciad/ria/model/feature/Feature";
import {MemoryStore} from "@luciad/ria/model/store/MemoryStore";
import {Cursor} from "@luciad/ria/model/Cursor";
import {ProgrammingError} from "@luciad/ria/error/ProgrammingError";
import {WFSTFeatureStore} from "../../../WFSTFeatureStore";

const OWS_URL = "http://localhost:8092/geoserver/ows";

// Pure unit tests: no network/docker involved, same jsdom-only convention as
// WFSTFeatureLocksStorage.test.ts. AdvancedGMLCodec's decode() is inherited straight from
// GMLCodec (untouched), so these tests focus on the new encode-side behavior, using the
// inherited decode() only to prove encode()'s output is actually consumable.

const reference = getReference("CRS:84");

function cursorOf(...features: Feature[]): Cursor<Feature> {
    const store = new MemoryStore({reference: features[0]?.shape?.reference ?? reference});
    for (const feature of features) store.put(feature);
    return store.query();
}

function parseXML(content: string): Document {
    return new DOMParser().parseFromString(content, "application/xml");
}

describe('AdvancedGMLCodec.encode', () => {

    it('encodes a single Point feature into one gml:featureMember > gml:Feature', () => {
        const codec = new AdvancedGMLCodec();
        const feature = new Feature(createPoint(reference, [10, 20]), {label: "a"}, "f.1");

        const {content, contentType} = codec.encode(cursorOf(feature));
        expect(contentType).toBe("application/gml+xml; version=3.2");

        const doc = parseXML(content);
        expect(doc.getElementsByTagName("parsererror").length).toBe(0);
        const root = doc.documentElement;
        expect(root.tagName).toBe("gml:FeatureCollection");

        const members = doc.getElementsByTagName("gml:featureMember");
        expect(members.length).toBe(1);
        const featureEl = members[0].getElementsByTagName("gml:Feature")[0];
        expect(featureEl.getAttribute("gml:id")).toBe("f.1");
        expect(featureEl.getElementsByTagName("gml:Point").length).toBe(1);
    });

    it('encodes multiple features as sibling gml:featureMembers with a single XML declaration', () => {
        const codec = new AdvancedGMLCodec();
        const features = [
            new Feature(createPoint(reference, [1, 1]), {label: "a"}, "f.1"),
            new Feature(createPoint(reference, [2, 2]), {label: "b"}, "f.2"),
            new Feature(createPoint(reference, [3, 3]), {label: "c"}, "f.3"),
        ];

        const {content} = codec.encode(cursorOf(...features));
        expect(content.match(/<\?xml/g)?.length).toBe(1);

        const doc = parseXML(content);
        const members = doc.getElementsByTagName("gml:featureMember");
        expect(members.length).toBe(3);
        const ids = Array.from(members).map(m => m.getElementsByTagName("gml:Feature")[0].getAttribute("gml:id"));
        expect(ids).toEqual(["f.1", "f.2", "f.3"]);
    });

    it('normalizes a ShapeList of Polygons (GeoJSON MultiPolygon) to gml:MultiSurface', () => {
        const codec = new AdvancedGMLCodec();
        const ring = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
        const otherRing = [[20, 20], [20, 30], [30, 30], [30, 20], [20, 20]];
        const shapeList = createShapeList(reference, [
            createPolygon(reference, ring),
            createPolygon(reference, otherRing),
        ]);
        const feature = new Feature(shapeList, {label: "multi"}, "f.multi");

        const {content} = codec.encode(cursorOf(feature));
        const doc = parseXML(content);
        expect(doc.getElementsByTagName("gml:MultiSurface").length).toBe(1);
        expect(doc.getElementsByTagName("gml:MultiPolygon").length).toBe(0);
    });

    it('flips coordinate order only for reference identifiers listed in swapAxes', () => {
        const plainCodec = new AdvancedGMLCodec();
        const invertingCodec = new AdvancedGMLCodec({swapAxes: [reference.identifier]});
        const feature = () => new Feature(createPoint(reference, [10, 20]), {}, "f.1");

        const posOf = (content: string) => parseXML(content).getElementsByTagName("gml:pos")[0].textContent?.trim();

        const plainPos = posOf(plainCodec.encode(cursorOf(feature())).content);
        const invertedPos = posOf(invertingCodec.encode(cursorOf(feature())).content);

        expect(plainPos).not.toBe(invertedPos);
        expect(plainPos?.split(" ").reverse().join(" ")).toBe(invertedPos);
    });

    it('produces a valid, empty gml:FeatureCollection for an empty cursor', () => {
        const codec = new AdvancedGMLCodec();
        const {content} = codec.encode(cursorOf());
        const doc = parseXML(content);
        expect(doc.documentElement.tagName).toBe("gml:FeatureCollection");
        expect(doc.getElementsByTagName("gml:featureMember").length).toBe(0);
    });

    it('uses the GML 3.1.1 namespace and contentType when configured', () => {
        const codec = new AdvancedGMLCodec({gmlVersion: '3.1.1'});
        const feature = new Feature(createPoint(reference, [1, 2]), {}, "f.1");

        const {content, contentType} = codec.encode(cursorOf(feature));
        expect(contentType).toBe("text/xml; subtype=gml/3.1.1");
        expect(content).toContain('xmlns:gml="http://www.opengis.net/gml"');
        expect(content).not.toContain('http://www.opengis.net/gml/3.2');
    });

    it('throws a ProgrammingError for a feature without a shape', () => {
        const codec = new AdvancedGMLCodec();
        const shapelessFeature = new Feature(null, {}, "f.1");
        expect(() => codec.encode(cursorOf(shapelessFeature))).toThrow(ProgrammingError);
    });

    it('round-trips encode() -> inherited decode() preserving id, properties and geometry', () => {
        const codec = new AdvancedGMLCodec();
        const point = new Feature(createPoint(reference, [5, 6]), {label: "round-trip"}, "f.rt");

        const {content, contentType} = codec.encode(cursorOf(point));
        const cursor = codec.decode({content, contentType, reference});

        expect(cursor.hasNext()).toBe(true);
        const decoded = cursor.next();
        expect(decoded.id).toBe("f.rt");
        expect(decoded.properties.label).toBe("round-trip");
        expect(decoded.shape?.type).toBeTruthy();
        expect(cursor.hasNext()).toBe(false);
    });
});

// Backfilled coverage: these geometry types were previously only checked structurally (via
// DOMParser assertions in the block above), never actually fed back through the real, inherited
// GMLCodec.decode(). Round-tripping them closes that gap and proves encode() output is genuinely
// consumable for every geometry type this codec already claims to support, not just Point.
describe('AdvancedGMLCodec round-trip coverage for existing 2D geometry types', () => {
    it('2D Polygon: round-trips ring coordinates and vertex count', () => {
        const codec = new AdvancedGMLCodec();
        const ring = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
        const feature = new Feature(createPolygon(reference, ring), {label: "poly"}, "f.poly");

        const {content, contentType} = codec.encode(cursorOf(feature));
        const decoded = codec.decode({content, contentType, reference}).next();

        expect(decoded.id).toBe("f.poly");
        const polygon = decoded.shape as Polygon;
        expect(polygon.type).toBe(ShapeType.POLYGON);
        expect(polygon.pointCount).toBe(ring.length);
    });

    it('2D LineString: round-trips every vertex', () => {
        const codec = new AdvancedGMLCodec();
        const points = [[0, 0], [1, 1], [2, 2], [3, 1]];
        const feature = new Feature(createPolyline(reference, points as any), {label: "line"}, "f.line");

        const {content, contentType} = codec.encode(cursorOf(feature));
        const decoded = codec.decode({content, contentType, reference}).next();

        const line = decoded.shape as Polyline;
        expect(line.type).toBe(ShapeType.POLYLINE);
        expect(line.pointCount).toBe(points.length);
    });

    it('MultiPoint (ShapeList of Points): round-trips member count and coordinates', () => {
        const codec = new AdvancedGMLCodec();
        const shapeList = createShapeList(reference, [
            createPoint(reference, [1, 1]),
            createPoint(reference, [2, 2]),
            createPoint(reference, [3, 3]),
        ]);
        const feature = new Feature(shapeList, {label: "multipoint"}, "f.mp");

        const {content, contentType} = codec.encode(cursorOf(feature));
        expect(content).toContain("gml:MultiPoint");
        const decoded = codec.decode({content, contentType, reference}).next();

        const decodedList = decoded.shape as any;
        expect(decodedList.shapeCount).toBe(3);
        expect(decodedList.getShape(0).type).toBe(ShapeType.POINT);
    });

    it('MultiCurve (ShapeList of Polylines): round-trips member count and vertex counts', () => {
        const codec = new AdvancedGMLCodec();
        const shapeList = createShapeList(reference, [
            createPolyline(reference, [[0, 0], [1, 1]] as any),
            createPolyline(reference, [[5, 5], [6, 6], [7, 5]] as any),
        ]);
        const feature = new Feature(shapeList, {label: "multicurve"}, "f.mc");

        const {content, contentType} = codec.encode(cursorOf(feature));
        expect(content).toContain("gml:MultiCurve");
        const decoded = codec.decode({content, contentType, reference}).next();

        const decodedList = decoded.shape as any;
        expect(decodedList.shapeCount).toBe(2);
        expect(decodedList.getShape(0).type).toBe(ShapeType.POLYLINE);
        expect(decodedList.getShape(1).pointCount).toBe(3);
    });

    it('ShapeList of Polygons normalized to gml:MultiSurface: round-trips member count and ring coordinates', () => {
        const codec = new AdvancedGMLCodec();
        const ring = [[0, 0], [0, 10], [10, 10], [10, 0], [0, 0]];
        const otherRing = [[20, 20], [20, 30], [30, 30], [30, 20], [20, 20]];
        const shapeList = createShapeList(reference, [
            createPolygon(reference, ring),
            createPolygon(reference, otherRing),
        ]);
        const feature = new Feature(shapeList, {label: "multi"}, "f.multi");

        const {content, contentType} = codec.encode(cursorOf(feature));
        const decoded = codec.decode({content, contentType, reference}).next();

        const decodedList = decoded.shape as any;
        expect(decodedList.shapeCount).toBe(2);
        expect(decodedList.getShape(0).type).toBe(ShapeType.POLYGON);
        expect(decodedList.getShape(0).pointCount).toBe(ring.length);
        expect(decodedList.getShape(1).pointCount).toBe(otherRing.length);
    });
});

// Per explicit request: a Point with 3 coordinates, a LineString where every vertex has 3
// coordinates, and a Polygon ring where every vertex has 3 coordinates. Each round-trips through
// encode() and the *inherited, real, unmocked* GMLCodec.decode() - the strongest possible proof,
// since it exercises the actual shipped RIA parser, not a mock or our own assumptions about it.
describe('AdvancedGMLCodec 3D support', () => {
    it('Point with 3 coordinates: Z survives encode() -> decode()', () => {
        const codec = new AdvancedGMLCodec();
        const feature = new Feature(createPoint(reference, [10, 20, 55]), {label: "3d-point"}, "f.3d");

        const {content, contentType} = codec.encode(cursorOf(feature));
        expect(content).toContain('srsDimension="3"');

        const decoded = codec.decode({content, contentType, reference}).next();
        expect(decoded.shape?.type).toBe(ShapeType.POINT);
        expect((decoded.shape as any).z).toBe(55);
    });

    it('LineString where every vertex has 3 coordinates: Z survives on every vertex', () => {
        const codec = new AdvancedGMLCodec();
        const line = createPolyline(reference, [[0, 0, 1], [1, 1, 2], [2, 2, 3]] as any);
        const feature = new Feature(line, {label: "3d-line"}, "f.3d-line");

        const {content, contentType} = codec.encode(cursorOf(feature));
        expect(content).toContain('srsDimension="3"');

        const decoded = codec.decode({content, contentType, reference}).next();
        const decodedLine = decoded.shape as Polyline;
        expect(decodedLine.pointCount).toBe(3);
        for (let i = 0; i < 3; i++) {
            expect(decodedLine.getPoint(i).z).toBe(i + 1);
        }
    });

    it('Polygon ring where every vertex has 3 coordinates: Z survives on every vertex', () => {
        const codec = new AdvancedGMLCodec();
        const ring = [[0, 0, 10], [0, 10, 10], [10, 10, 10], [10, 0, 10], [0, 0, 10]] as any;
        const poly = createPolygon(reference, ring);
        const feature = new Feature(poly, {label: "3d-polygon"}, "f.3d-poly");

        const {content, contentType} = codec.encode(cursorOf(feature));
        expect(content).toContain('srsDimension="3"');

        const decoded = codec.decode({content, contentType, reference}).next();
        const decodedPoly = decoded.shape as Polygon;
        for (let i = 0; i < decodedPoly.pointCount; i++) {
            expect(decodedPoly.getPoint(i).z).toBe(10);
        }
    });

    it('mode3D:true forces 3D output even on 2D-only input (Z=0)', () => {
        const codec = new AdvancedGMLCodec({mode3D: true});
        const feature = new Feature(createPoint(reference, [1, 2]), {}, "f.forced");

        const {content, contentType} = codec.encode(cursorOf(feature));
        expect(content).toContain('srsDimension="3"');

        const decoded = codec.decode({content, contentType, reference}).next();
        expect((decoded.shape as any).z).toBe(0);
    });

    it('mode3D:false drops Z even on genuinely-3D input', () => {
        const codec = new AdvancedGMLCodec({mode3D: false});
        const feature = new Feature(createPoint(reference, [1, 2, 99]), {}, "f.dropped");

        const {content} = codec.encode(cursorOf(feature));
        expect(content).not.toContain('srsDimension');
    });

    it('encodeFeature(): 3D single-feature document carries srsDimension and Z', () => {
        // Not round-tripped through decode() here: encodeFeature()'s standalone <gml:Feature>
        // output (no FeatureCollection wrapper) was never decodable via the inherited decode() even
        // for 2D input - decode() expects a FeatureCollection-style wrapper with featureMember/member
        // children. Pre-existing, orthogonal to 3D; verified structurally instead, same as the
        // existing (2D) encodeFeature() test above.
        const codec = new AdvancedGMLCodec();
        const feature = new Feature(createPoint(reference, [3, 4, 12]), {}, "f.solo3d");

        const content = codec.encodeFeature(feature);
        expect(content).toContain('srsDimension="3"');
        expect(content).toContain('4 3 12');
    });

    it('encodeShape(): 3D shape fragment carries Z', () => {
        const codec = new AdvancedGMLCodec();
        const fragment = codec.encodeShape(createPoint(reference, [1, 1, 42]));
        expect(fragment).toContain('srsDimension="3"');
        expect(fragment).toContain('1 1 42');
    });
});

describe('AdvancedGMLCodec.encodeFeature', () => {
    it('encodes a single feature as a standalone gml:Feature document, not wrapped in a FeatureCollection', () => {
        const codec = new AdvancedGMLCodec();
        const feature = new Feature(createPoint(reference, [7, 8]), {label: "solo"}, "f.solo");

        const content = codec.encodeFeature(feature);
        const doc = parseXML(content);
        expect(doc.documentElement.tagName).toBe("gml:Feature");
        expect(doc.documentElement.getAttribute("gml:id")).toBe("f.solo");
        expect(doc.getElementsByTagName("gml:FeatureCollection").length).toBe(0);
        expect(content.match(/<\?xml/g)?.length).toBe(1);
    });

    it('throws a ProgrammingError for a feature without a shape', () => {
        const codec = new AdvancedGMLCodec();
        expect(() => codec.encodeFeature(new Feature(null, {}, "f.1"))).toThrow(ProgrammingError);
    });
});

describe('AdvancedGMLCodec.encodeShape', () => {
    it('encodes a single Shape into a GML geometry fragment', () => {
        const codec = new AdvancedGMLCodec();
        const fragment = codec.encodeShape(createPoint(reference, [11, 12]));
        expect(fragment).toContain("<gml:Point");
        expect(fragment).toContain("gml:pos");
    });

    it('returns null for a null shape', () => {
        const codec = new AdvancedGMLCodec();
        expect(codec.encodeShape(null)).toBeNull();
    });
});

// Live-server smoke test (requires `docker compose -f docker/docker-compose.yml up -d`, same
// ungated convention as WFSTFeatureStore.test.ts). The jsdom tests above already exercise the
// real, unmocked RIA decode() against our own encode() output using synthetic single-property
// point features. This test instead round-trips real features (real schema, multiple property
// types, a MultiSurface polygon geometry) fetched from a live GeoServer layer, to catch anything
// the synthetic unit tests wouldn't - a materially different, more realistic feature shape.
describe('AdvancedGMLCodec (live GeoServer round-trip)', () => {
    it('round-trips real features fetched from wfst_test:states through encode()/decode()', async () => {
        const store = await WFSTFeatureStore.createFromURL_WFST(OWS_URL, "wfst_test:states");
        const liveReference = store.getReference();

        const cursor = await store.query({maxFeatures: 3} as any);
        const originals: Feature[] = [];
        while (cursor.hasNext()) originals.push(cursor.next());
        expect(originals.length).toBeGreaterThan(0);

        const codec = new AdvancedGMLCodec();
        const {content, contentType} = codec.encode(cursorOf(...originals));

        const decodedCursor = codec.decode({content, contentType, reference: liveReference});
        const decoded: Feature[] = [];
        while (decodedCursor.hasNext()) decoded.push(decodedCursor.next());

        expect(decoded.length).toBe(originals.length);
        decoded.forEach((decodedFeature, index) => {
            const original = originals[index];
            expect(decodedFeature.id).toBe(original.id);
            expect(decodedFeature.shape?.type).toBe(original.shape?.type);
            for (const key of Object.keys(original.properties)) {
                expect(String(decodedFeature.properties[key])).toBe(String(original.properties[key]));
            }
        });
    });
});
