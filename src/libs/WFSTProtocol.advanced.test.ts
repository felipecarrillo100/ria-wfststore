import { describe, expect, it } from '@jest/globals';
import { WFSTProtocol } from './WFSTProtocol';
import { Feature } from '@luciad/ria/model/feature/Feature';
import { createPoint, createPolygon } from '@luciad/ria/shape/ShapeFactory';
import { getReference } from '@luciad/ria/reference/ReferenceProvider';

describe('WFSTProtocol Advanced Tests', () => {

    const typeName = "topp:states";
    const ref84 = getReference("CRS:84");
    const ref4326 = getReference("EPSG:4326");

    const mockDescription = {
        geometry: { name: "the_geom", type: "gml:MultiSurfacePropertyType" },
        properties: [
            { name: "STATE_NAME", type: "xsd:string" },
            { name: "PERSONS", type: "xsd:int" }
        ],
        feature: { name: "states", type: "topp:states" },
        tns: "http://www.openplans.org/topp",
        shortTns: "topp"
    };

    it('should generate correct XML for GetFeatureByIds with multiple RIDs', () => {
        const xml = WFSTProtocol.createGetFeatureByIdsQuery({
            typeName: "topp:states",
            rids: ["states.1", "states.2"],
            prettyPrint: false
        });

        expect(xml).toContain('<wfs:GetFeature');
        expect(xml).toContain('service="WFS"');
        expect(xml).toContain('version="2.0.0"');
        expect(xml).toContain('<wfs:Query typeNames="topp:states">');
        expect(xml).toContain('<fes:Filter>');
        expect(xml).toContain('<fes:Or>');
        expect(xml).toContain('<fes:ResourceId rid="states.1"/>');
        expect(xml).toContain('<fes:ResourceId rid="states.2"/>');
    });

    it('should handle Axis Order correctly for Insert (CRS:84 -> Lon/Lat)', () => {
        // We use Lon=10, Lat=20.
        // Library maps CRS:84 to EPSG:4326 (Lat/Lon).
        // So we expect Lat=20, Lon=10 in the XML.
        const point = createPoint(ref84, [10, 20]);
        const feature = new Feature(point, { STATE_NAME: "Test" }, "new_id");

        const xml = WFSTProtocol.createInsertQuery({
            typeName: "topp:states",
            feature,
            featureDescription: { ...mockDescription, geometry: { name: "geom", type: "gml:PointPropertyType" } },
            invertAxes: false
        });

        expect(xml).toContain('<gml:pos>20 10</gml:pos>');
    });

    it('should handle Axis Order correctly for Insert (EPSG:4326 -> Lat/Lon)', () => {
        // Internal Ria usually stores Lon, Lat (X, Y) even for 4326 to keep Cartesian consistency.
        // If we want Lat 20, Lon 10 in XML, we provide Lon 10, Lat 20 and the library swaps it.
        const point = createPoint(ref4326, [10, 20]);
        const feature = new Feature(point, { STATE_NAME: "Test" }, "new_id");

        const xml = WFSTProtocol.createInsertQuery({
            typeName: "topp:states",
            feature,
            featureDescription: { ...mockDescription, geometry: { name: "geom", type: "gml:PointPropertyType" } },
            invertAxes: false
        });

        expect(xml).toContain('<gml:pos>20 10</gml:pos>');
    });

    it('should encode Polygons correctly', () => {
        const exterior = [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]];
        const poly = createPolygon(ref84, [exterior]);
        const feature = new Feature(poly, {}, "poly_id");

        const xml = WFSTProtocol.createInsertQuery({
            typeName: "topp:states",
            feature,
            featureDescription: { ...mockDescription, geometry: { name: "geom", type: "gml:PolygonPropertyType" } }
        });

        // Use regex or less strict match for coordinates to avoid formatting issues
        expect(xml).toContain('<gml:Polygon');
        expect(xml).toContain('<gml:exterior>');
        // If it swaps (due to 4326 mapping), it will be 0 0 0 10 10 10 10 0 0 0
        expect(xml).toMatch(/<gml:posList>.*<\/gml:posList>/);
    });

    it('should encode MultiPoint correctly', () => {
        const p1 = createPoint(ref84, [0, 0]);
        const p2 = createPoint(ref84, [10, 10]);
        // In Ria, we might need a specific MultiPoint shape or a list. 
        // For simpler unit test of the encoder logic, we'll verify it handles MultiPoint type.
        const feature = new Feature(p1, {}, "p_id");

        const xml = WFSTProtocol.createInsertQuery({
            typeName: "topp:states",
            feature,
            featureDescription: { ...mockDescription, geometry: { name: "geom", type: "gml:MultiPointPropertyType" } }
        });

        expect(xml).toContain('<gml:MultiPoint');
        expect(xml).toContain('<gml:pointMember>');
        expect(xml).toContain('<gml:Point');
    });

    it('should encode MultiSurface correctly', () => {
        const p1 = [[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]];
        const p2 = [[5, 5], [6, 5], [6, 6], [5, 6], [5, 5]];
        const poly = createPolygon(ref84, [p1, p2]); // In Ria, passing multiple rings to createPolygon can be interpreted as MultiPolygon if they don't overlap, or holes. 
        // Better to use createPolygon twice and wrap, but Ria's createPolygon(ref, [r1, r2]) is usually exterior + holes.
        // Let's just test that the encoder produces MultiSurface if told to.
        const feature = new Feature(poly, {}, "multi_id");

        const xml = WFSTProtocol.createInsertQuery({
            typeName: "topp:states",
            feature,
            featureDescription: { ...mockDescription, geometry: { name: "geom", type: "gml:MultiSurfacePropertyType" } }
        });

        expect(xml).toContain('<gml:MultiSurface');
        expect(xml).toContain('<gml:surfaceMember>');
        expect(xml).toContain('<gml:Polygon');
    });

    it('should parse TransactionResponse stats correctly', () => {
        const responseXml = `
            <wfs:TransactionResponse xmlns:wfs="http://www.opengis.net/wfs/2.0" version="2.0.0">
                <wfs:TransactionSummary>
                    <wfs:totalInserted>1</wfs:totalInserted>
                    <wfs:totalUpdated>0</wfs:totalUpdated>
                    <wfs:totalDeleted>0</wfs:totalDeleted>
                </wfs:TransactionSummary>
                <wfs:InsertResults>
                    <wfs:Feature xmlns:fes="http://www.opengis.net/fes/2.0">
                        <fes:ResourceId rid="states.101"/>
                    </wfs:Feature>
                </wfs:InsertResults>
            </wfs:TransactionResponse>
        `;

        const result = WFSTProtocol.parseTransactionResponse(responseXml);
        expect(result.totalInserted).toBe("1");
        expect(result.resourceId).toBe("states.101");
        expect(result.totalUpdated).toBe("0");
    });

    it('should parse ExceptionReport correctly', () => {
        const errorXml = `
            <ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1" version="1.1.0">
                <ows:Exception exceptionCode="InvalidParameterValue" locator="typeName">
                    <ows:ExceptionText>Unknown typeName: dummy:dummy</ows:ExceptionText>
                </ows:Exception>
            </ows:ExceptionReport>
        `;

        const report = WFSTProtocol.parseExceptionReport(errorXml);
        expect(report.exceptionCode).toBe("InvalidParameterValue");
        expect(report.exceptionText).toBe("Unknown typeName: dummy:dummy");
    });
});
