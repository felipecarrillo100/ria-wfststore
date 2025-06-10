import {describe, expect, it} from '@jest/globals';
import "isomorphic-fetch";
import {WFSCapabilitiesExtended} from "./WFSCapabilitiesExtended";
import {WFSTFeatureStore} from "./WFSTFeatureStore";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {GeoJsonCodec} from "@luciad/ria/model/codec/GeoJsonCodec";
import {bbox} from "@luciad/ria/ogc/filter/FilterFactory";
import {createBounds, createPoint, createPolygon} from "@luciad/ria/shape/ShapeFactory";
import {Feature} from "@luciad/ria/model/feature/Feature";

// Real timers are required for this test
// jest.useFakeTimers();


describe('WFSTFeatureStore ',   () => {

    let targetID = null;
    let newFeature = null;

    it('WFSTFeatureStore.query features', async () => {
        const {store} = await CreateGeoserverStore();
        const bounds = createBounds(getReference("CRS:84"), [-180, 360, -90, 180]);
        const query = {
            "filter": bbox(bounds),
            "maxFeatures": 500,
        }

        return store.query(query).then(cursor => {
            if (cursor.hasNext()) {
                const feature = cursor.next();
                expect(feature.id).toBe("boundary_lines.1");
            } else {
                expect(2).toBe(3);
            }
        }, () => {
            expect(2).toBe(3);
        })
    });

    it('WFSTFeatureStore.querybyId', async () => {
        const {store} = await CreateGeoserverStore();

        return store.queryByRids(["boundary_lines.1"]).then(cursor => {
            if (cursor.hasNext()) {
                const feature = cursor.next();
                expect(feature.id).toBe("boundary_lines.1");
            } else {
                expect(2).toBe(3);
            }
        }, () => {
            expect(2).toBe(3);
        })
    });

    it('WFSTFeatureStore.add', async () => {
        const {store, reference} = await CreateGeoserverStore("luciad:europe_untouched");

        const shape = createPolygon(reference, [
            [9.80319279537696 ,37.449454109042925 ],
            [7.636453512280132 ,34.14847153056388 ],
            [9.695560662841046 ,30.09402069877914 ] ,
            [11.838673271155946 , 33.31466236650649],
            [9.80319279537696,37.449454109042925 ]
        ]);

        newFeature = new Feature(shape, {
            country: "Tunisia",
            abbrf: "TU"
        }, 1);

        return store.add(newFeature).then(featureId => {
            if (featureId) {
                const prefix = "europe_untouched";
                console.log(featureId);
                targetID = featureId;
                expect(featureId).toMatch(new RegExp(`^${prefix}?`));
            } else {
                expect(2).toBe(3);
            }
        }, () => {
            expect(2).toBe(3);
        })
    });

    it('WFSTFeatureStore.putProperties', async () => {
        const {store, reference} = await CreateGeoserverStore("luciad:europe_untouched");
        if (newFeature) {
            const shape = createPoint(newFeature.shape.reference, [0,0]);
            const updatedFeature = new Feature(shape, {...newFeature.properties, country:"Carthage"}, targetID);
            return store.putProperties(updatedFeature).then(result => {
                expect(result).toBe(targetID);
            }, () => {
                expect(2).toBe(3);
            })
        } else {
            expect(2).toBe(3);
        }
    });

    it('WFSTFeatureStore.put (Geometry)', async () => {
        const {store, reference} = await CreateGeoserverStore("luciad:europe_untouched");
        if (newFeature) {
            const shape = createPolygon(reference, [
                [9.80319279537696 + 20 , 37.449454109042925 ],
                [7.636453512280132 + 20, 34.14847153056388 ],
                [9.695560662841046 + 20, 30.09402069877914 ] ,
                [11.838673271155946 + 20, 33.31466236650649],
                [9.80319279537696 + 20, 37.449454109042925 ]
            ]);

            const updatedFeature = new Feature(shape, newFeature.properties, targetID);
            return store.put(updatedFeature).then(result => {
                expect(result).toBe(targetID);
            }, () => {
                expect(2).toBe(3);
            })
        } else {
            expect(2).toBe(3);
        }
    });

    it('WFSTFeatureStore.remove', async () => {
        const {store, reference} = await CreateGeoserverStore("luciad:europe_untouched");

        return store.remove(targetID).then(result => {
            expect(result).toBe(true);
        }, () => {
            expect(2).toBe(3);
        })
    });
})

async function CreateGeoserverStore(requestedFeatureType?:string) {
    const {wfsCapabilities, wfstCapabilities} = await WFSCapabilitiesExtended.fromURL("http://leu-gsp-vrndp06:8080/geoserver/ows");
    const featureOperation = WFSCapabilitiesExtended.getServiceOperation(wfsCapabilities, "GetFeature");

    const serviceURL = WFSCapabilitiesExtended.getServiceUrl(featureOperation, "GET");

    const index = wfsCapabilities.featureTypes.findIndex(f=>f.name === requestedFeatureType);
    const featureType = index > -1 ? wfsCapabilities.featureTypes[index] : wfsCapabilities.featureTypes[0];

    const formats = featureType.outputFormats ? featureType.outputFormats : [];
    let format = "json";
    const favoriteFormatIndex = formats.findIndex((formatName: string) => formatName === "json");
    if (favoriteFormatIndex > -1) {
        format = formats[favoriteFormatIndex];
    }

    const outputFormat = "application/json";
    const reference = getReference(featureType.defaultReference);
    const options: any = {
        wfst: wfstCapabilities.WFSTCapable ? wfstCapabilities.WFSTOperations : undefined,
        generateIDs: false,
        outputFormat,
        codec: new GeoJsonCodec({generateIDs: false}),
        swapAxes: false,
        swapQueryAxes: false,
        serviceURL: serviceURL,
        postServiceURL: serviceURL,
        reference,
        typeName: featureType.name,
        versions: [wfsCapabilities.version],
        credentials: false,
        requestHeaders: {"Accept": outputFormat},
        methods: ["POST", "GET"]
    }

    return {
        store: new WFSTFeatureStore(options),
        reference
    };
}
