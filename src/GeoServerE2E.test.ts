import { describe, expect, it } from '@jest/globals';
import "isomorphic-fetch";
import { WFSTFeatureStore } from "./WFSTFeatureStore";
import { WFSCapabilitiesExtended } from "./WFSCapabilitiesExtended";
import { getReference, ReferenceProvider, parseWellKnownText, isValidReferenceIdentifier, addReference } from "@luciad/ria/reference/ReferenceProvider";
import { createPoint, createPolygon } from "@luciad/ria/shape/ShapeFactory";
import { Feature } from "@luciad/ria/model/feature/Feature";
import { GeoJsonCodec } from "@luciad/ria/model/codec/GeoJsonCodec";

// Configuration from user
const GS_URL = "http://leu-gsp-vrndp06.ingrnet.com:8080/geoserver/ows";

// Add EPSG:2240 definition (NAD83 / Georgia West)
const WKT_2240 = `PROJCS["NAD83 / Georgia West (ftUS)",GEOGCS["NAD83",DATUM["North American Datum 1983",SPHEROID["GRS 1980",6378137.0,298.257222101],TOWGS84[0.0,0.0,0.0]],PRIMEM["Greenwich",0.0],UNIT["degree",0.017453292519943295],AXIS["Geodetic latitude",NORTH],AXIS["Geodetic longitude",EAST],AUTHORITY["EPSG",4269]],PROJECTION["Transverse Mercator"],PARAMETER["Latitude of natural origin",30.0],PARAMETER["central_meridian",-84.16666666666667],PARAMETER["Scale factor at natural origin",0.9999],PARAMETER["False easting",2296583.333],PARAMETER["False northing",0.0],UNIT["US survey foot",0.30480060960121924],AXIS["Easting",EAST],AXIS["Northing",NORTH],AUTHORITY["EPSG",2240]]`;

const ref2240 = parseWellKnownText(WKT_2240);
if (ref2240 && ref2240.identifier) {
    if (!isValidReferenceIdentifier(ref2240.identifier)) {
        addReference(ref2240);
    }
}

/**
 * E2E High-Fidelity Validation Suite.
 * This suite uses the verified working PostGIS layer 'luciad:europe_untouched'
 * to test Multi-EPSG and varied world coordinate handling.
 */
describe('GeoServer E2E Logic Validation', () => {

    it('should perform E2E Transaction in EPSG:4326 (WGS84)', async () => {
        const { store, reference } = await CreateGeoserverStore("luciad:europe_untouched", "EPSG:4326");

        const shape = createPolygon(reference, [
            [10, 50], [11, 50], [11, 51], [10, 51], [10, 50]
        ]);
        const feature = new Feature(shape, { country: "E2E_4326_Test", abbrf: "E1" });

        const featureId = await store.add(feature);
        console.log(`[E2E-PASSED] result 4326: ${featureId}`);
        expect(featureId).not.toBeNull();

        await store.remove(featureId!);
    }, 120000);

    it('should perform E2E Transaction in EPSG:3857 (Web Mercator)', async () => {
        const { store, reference } = await CreateGeoserverStore("luciad:europe_untouched", "EPSG:3857");

        // Coordinates in meters (approx London area)
        const shape = createPolygon(reference, [
            [0, 6600000], [100000, 6600000], [100000, 6700000], [0, 6700000], [0, 6600000]
        ]);
        const feature = new Feature(shape, { country: "E2E_3857_Test", abbrf: "E2" });

        const featureId = await store.add(feature);
        console.log(`[E2E-PASSED] result 3857: ${featureId}`);
        expect(featureId).not.toBeNull();

        await store.remove(featureId!);
    }, 120000);

    it('should perform E2E Transaction with Extreme Global Coordinates (EPSG:4326)', async () => {
        const { store, reference } = await CreateGeoserverStore("luciad:europe_untouched", "EPSG:4326");

        // Polygon at extreme location (near date line and poles)
        const shape = createPolygon(reference, [
            [170, 70], [175, 70], [175, 75], [170, 75], [170, 70]
        ]);
        const feature = new Feature(shape, { country: "Extreme_Coords", abbrf: "EX" });

        const featureId = await store.add(feature);
        console.log(`[E2E-PASSED] result Extreme: ${featureId}`);
        expect(featureId).not.toBeNull();

        await store.remove(featureId!);
    }, 120000);

    it('should perform E2E Transaction in EPSG:2240 (NAD83 / Georgia West)', async () => {
        const { store, reference } = await CreateGeoserverStore("luciad:europe_untouched", "EPSG:2240");

        // Coordinates in Feet (Georgia West region)
        const shape = createPolygon(reference, [
            [2200000, 1300000], [2210000, 1300000], [2210000, 1310000], [2200000, 1310000], [2200000, 1300000]
        ]);
        const feature = new Feature(shape, { country: "E2E_2240_Test", abbrf: "GA" });

        const featureId = await store.add(feature);
        console.log(`[E2E-PASSED] result 2240: ${featureId}`);
        expect(featureId).not.toBeNull();

        await store.remove(featureId!);
    }, 120000);
});

async function CreateGeoserverStore(requestedFeatureType: string, crs: string) {
    const { wfsCapabilities, wfstCapabilities } = await WFSCapabilitiesExtended.fromURL(GS_URL);
    const featureOperation = WFSCapabilitiesExtended.getServiceOperation(wfsCapabilities, "GetFeature");
    const serviceURL = WFSCapabilitiesExtended.getServiceUrl(featureOperation, "GET");

    const ft = wfsCapabilities.featureTypes.find(f => f.name === requestedFeatureType);
    if (!ft) throw new Error(`FeatureType ${requestedFeatureType} not found`);

    const reference = getReference(crs);
    const outputFormat = "application/json";

    const options: any = {
        wfst: wfstCapabilities.WFSTCapable ? wfstCapabilities.WFSTOperations : undefined,
        generateIDs: false,
        outputFormat,
        codec: new GeoJsonCodec({ generateIDs: false }),
        swapAxes: false,
        swapQueryAxes: false,
        serviceURL: serviceURL,
        postServiceURL: serviceURL,
        reference,
        typeName: ft.name,
        versions: [wfsCapabilities.version],
        credentials: false,
        requestHeaders: { "Accept": outputFormat },
        methods: ["POST", "GET"]
    };

    return {
        store: new WFSTFeatureStore(options),
        reference
    };
}
