import {describe, expect, it} from 'vitest';
import {GMLCodec} from "@luciad/ria/model/codec/GMLCodec";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {ShapeType} from "@luciad/ria/shape/ShapeType";
import {ProgrammingError} from "@luciad/ria/error/ProgrammingError";
import {Circle} from "@luciad/ria/shape/Circle";
import {Arc} from "@luciad/ria/shape/Arc";

// Prerequisite check for Phase 4 (direct GML encoding of shapes GeoJSON can't represent), run
// BEFORE attempting the encoder side. The original brainstorm assumed Circle, CircleByCenterPoint,
// Arc, Ellipse, ArcBand and Sector were all viable targets because "GMLCodec.decode() already
// understands them". That assumption only holds for three of the six: reading RIA's shipped
// GMLGeometryParser.js source shows SUPPORTED_CURVE_SEGMENTS is exactly
// ["GeodesicString","LineStringSegment","Circle","CircleByCenterPoint","ArcByCenterPoint"] - no
// Ellipse, ArcBand or Sector. That's not a RIA gap to work around, either: the OGC GML 3.2 spec
// itself has no Ellipse/ArcBand/Sector curve or surface segment type at all - only Circle,
// CircleByCenterPoint and Arc/ArcByCenterPoint exist as standard circular/elliptical segments.
// So Ellipse/ArcBand/Sector are excluded from Phase 4 on both counts: nothing decodes them today,
// and there is no standard GML 3.2 shape to encode them into in the first place.
//
// This file proves that empirically (not just by reading source) for both the "yes" and "no"
// cases, and documents two things the Phase 4 encoder needs to invert/account for:
// - The exact azimuth/angle conversion GMLGeometryParser.js applies for ArcByCenterPoint (math
//   convention, counterclockwise-from-east angles in the GML input -> RIA's compass convention,
//   clockwise-from-north azimuth/sweep on the decoded Arc).
// - Circle.radius/Arc.a/Arc.b are always in real-world meters (see Circle.d.ts/Arc.d.ts), even on
//   a geodetic reference whose native coordinate unit is degrees - CircleByCenterPoint/
//   ArcByCenterPoint's explicit <gml:radius> value is taken as meters directly (straightforward
//   to round-trip), but a 3-point Circle's implied radius is derived from the input coordinates'
//   own unit via an internal degrees->meters conversion, so it does NOT equal the geometric
//   distance between the input points when the reference is geodetic.

const reference = getReference("CRS:84");
const GML_NS = 'xmlns:gml="http://www.opengis.net/gml/3.2"';

function featureWithGeometry(geometryXML: string): string {
    return `<?xml version="1.0" encoding="UTF-8"?>
<gml:FeatureCollection ${GML_NS} gml:id="FC1">
  <gml:featureMember>
    <gml:Feature gml:id="f.1">
      <geometry>
        ${geometryXML}
      </geometry>
    </gml:Feature>
  </gml:featureMember>
</gml:FeatureCollection>`;
}

function decodeOne(geometryXML: string, options?: ConstructorParameters<typeof GMLCodec>[0]) {
    const codec = new GMLCodec(options);
    const content = featureWithGeometry(geometryXML);
    const cursor = codec.decode({content, contentType: "application/gml+xml; version=3.2", reference});
    return cursor.hasNext() ? cursor.next() : null;
}

describe('GMLCodec.decode() support for standard GML 3.2 circular/elliptical curve segments', () => {

    it('decodes a 3-point gml:Circle curve segment into a Circle shape - radius always comes back in meters, even on a geodetic reference', () => {
        // Circle.radius is documented as "in meters" unconditionally (see Circle.d.ts) - on a
        // geodetic reference like CRS:84, whose native coordinate unit is degrees, that means the
        // 3-point circumcircle fit (done in the reference's own degree-based coordinates) gets its
        // resulting radius converted through a degrees->meters factor. At this near-equatorial
        // point that factor is ~111320 m/deg, so a 0.001deg-radius circle reports radius ~111.32 -
        // NOT 0.001. This matters directly for Phase 4's encoder: a Circle's `radius` property is
        // never in the reference's native unit, only ever meters.
        const feature = decodeOne(`
            <gml:Curve>
                <gml:segments>
                    <gml:Circle>
                        <gml:pos>0.001 0</gml:pos>
                        <gml:pos>0 0.001</gml:pos>
                        <gml:pos>-0.001 0</gml:pos>
                    </gml:Circle>
                </gml:segments>
            </gml:Curve>`);

        const shape = feature.shape as Circle;
        const degreeRadius = 0.001;
        const approxMetersPerDegreeAtEquator = 111320;
        expect(ShapeType.contains(shape.type, ShapeType.CIRCLE)).toBe(true);
        expect(Math.abs(shape.center.x)).toBeLessThan(degreeRadius * 0.05);
        expect(Math.abs(shape.center.y)).toBeLessThan(degreeRadius * 0.05);
        expect(shape.radius).toBeGreaterThan(degreeRadius * approxMetersPerDegreeAtEquator * 0.9);
        expect(shape.radius).toBeLessThan(degreeRadius * approxMetersPerDegreeAtEquator * 1.1);
    });

    it('decodes a gml:CircleByCenterPoint curve segment into a Circle shape', () => {
        const feature = decodeOne(`
            <gml:Curve>
                <gml:segments>
                    <gml:CircleByCenterPoint>
                        <gml:pos>5 5</gml:pos>
                        <gml:radius uom="m">20</gml:radius>
                    </gml:CircleByCenterPoint>
                </gml:segments>
            </gml:Curve>`);

        const shape = feature.shape as Circle;
        expect(ShapeType.contains(shape.type, ShapeType.CIRCLE)).toBe(true);
        expect(shape.center.x).toBeCloseTo(5, 6);
        expect(shape.center.y).toBeCloseTo(5, 6);
        expect(shape.radius).toBeCloseTo(20, 6);
    });

    it('decodes a gml:ArcByCenterPoint curve segment into an Arc shape, converting math angles to compass azimuth/sweep', () => {
        // startAngle=0, endAngle=90 in GML's math convention (degrees, counterclockwise from east)
        // becomes startAzimuth=90, sweepAngle=-90 in RIA's Arc (degrees, clockwise from north).
        const feature = decodeOne(`
            <gml:Curve>
                <gml:segments>
                    <gml:ArcByCenterPoint>
                        <gml:pos>0 0</gml:pos>
                        <gml:radius uom="m">10</gml:radius>
                        <gml:startAngle uom="deg">0</gml:startAngle>
                        <gml:endAngle uom="deg">90</gml:endAngle>
                    </gml:ArcByCenterPoint>
                </gml:segments>
            </gml:Curve>`);

        const shape = feature.shape as Arc;
        expect(ShapeType.contains(shape.type, ShapeType.ARC)).toBe(true);
        expect(shape.center.x).toBeCloseTo(0, 6);
        expect(shape.center.y).toBeCloseTo(0, 6);
        expect(shape.a).toBeCloseTo(10, 6);
        expect(shape.b).toBeCloseTo(10, 6);
        expect(shape.startAzimuth).toBeCloseTo(90, 6);
        expect(shape.sweepAngle).toBeCloseTo(-90, 6);
    });

    it('decodes a gml:ArcByCenterPoint with no endAngle as a full-circle sweep (-360)', () => {
        const feature = decodeOne(`
            <gml:Curve>
                <gml:segments>
                    <gml:ArcByCenterPoint>
                        <gml:pos>0 0</gml:pos>
                        <gml:radius uom="m">10</gml:radius>
                        <gml:startAngle uom="deg">0</gml:startAngle>
                    </gml:ArcByCenterPoint>
                </gml:segments>
            </gml:Curve>`);

        const shape = feature.shape as Arc;
        expect(ShapeType.contains(shape.type, ShapeType.ARC)).toBe(true);
        expect(shape.sweepAngle).toBeCloseTo(-360, 6);
    });
});

describe('GMLCodec.decode() has no support for Ellipse/ArcBand/Sector (not standard GML 3.2 segments, out of scope for Phase 4)', () => {

    it('a bare, unsupported top-level geometry node (e.g. gml:Ellipse) decodes to an empty ShapeList by default', () => {
        const feature = decodeOne(`<gml:Ellipse><gml:pos>0 0</gml:pos></gml:Ellipse>`);

        const shape = feature.shape as any;
        expect(ShapeType.contains(shape.type, ShapeType.SHAPE_LIST)).toBe(true);
        expect(shape.shapeCount).toBe(0);
    });

    it('a bare, unsupported top-level geometry node throws ProgrammingError when failOnUnsupportedGeometry is set', () => {
        expect(() => decodeOne(
            `<gml:Ellipse><gml:pos>0 0</gml:pos></gml:Ellipse>`,
            {failOnUnsupportedGeometry: true}
        )).toThrow(ProgrammingError);
    });

    it('an unsupported curve segment (e.g. gml:Ellipse inside gml:Curve) never throws, but yields a feature with shape===null - a third, different failure mode from the bare top-level case', () => {
        // Unlike the bare top-level case above: failOnUnsupportedGeometry is only checked for
        // top-level geometry NODE types, not for individual curve segments inside gml:segments -
        // an unrecognized segment is just skipped. Here the *Curve* node itself IS recognized, so
        // the empty-ShapeList fallback (which only fires when no geometry node is recognized at
        // all) never kicks in: 0 recognized segments makes the Curve resolve to a null shape, and
        // the feature IS still included in the cursor, but with feature.shape === null (not an
        // empty ShapeList). Confirmed with failOnUnsupportedGeometry both on and off - neither
        // throws nor changes this outcome, since the flag plays no role on the curve-segment path.
        const withFlag = decodeOne(`
            <gml:Curve>
                <gml:segments>
                    <gml:Ellipse>
                        <gml:pos>0 0</gml:pos>
                    </gml:Ellipse>
                </gml:segments>
            </gml:Curve>`,
            {failOnUnsupportedGeometry: true}
        );
        expect(withFlag).not.toBeNull();
        expect(withFlag.shape).toBeNull();

        const withoutFlag = decodeOne(`
            <gml:Curve>
                <gml:segments>
                    <gml:Ellipse>
                        <gml:pos>0 0</gml:pos>
                    </gml:Ellipse>
                </gml:segments>
            </gml:Curve>`,
            {failOnUnsupportedGeometry: false}
        );
        expect(withoutFlag).not.toBeNull();
        expect(withoutFlag.shape).toBeNull();
    });
});
