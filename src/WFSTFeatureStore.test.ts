import { describe, expect, it, vi } from 'vitest';
import {WFSCapabilitiesExtended} from "./WFSCapabilitiesExtended";
import {WFSTFeatureStore} from "./WFSTFeatureStore";
import {WFSTDelegateScreenHelper} from "./libs/screen/WFSTDelegateScreenHelper";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {GeoJsonCodec} from "@luciad/ria/model/codec/GeoJsonCodec";
import {bbox} from "@luciad/ria/ogc/filter/FilterFactory";
import {createBounds, createPoint, createPolygon} from "@luciad/ria/shape/ShapeFactory";
import {Feature} from "@luciad/ria/model/feature/Feature";

// Real timers are required for this test
// jest.useFakeTimers();

const OWS_URL = "http://localhost:8081/geoserver/ows";


describe('WFSTFeatureStore ',   () => {

    let targetID = null;
    let newFeature = null;

    it('WFSTFeatureStore.query features', async () => {
        const {store} = await CreateGeoserverStore("wfst_test:states");
        const bounds = createBounds(getReference("CRS:84"), [-180, 360, -90, 180]);
        const query = {
            "filter": bbox(bounds),
            "maxFeatures": 500,
        }

        return store.query(query).then(cursor => {
            if (cursor.hasNext()) {
                const feature = cursor.next();
                expect(feature.id).toBe("states.1");
            } else {
                expect(2).toBe(3);
            }
        }, () => {
            expect(2).toBe(3);
        })
    });

    it('WFSTFeatureStore.querybyId', async () => {
        const {store} = await CreateGeoserverStore("wfst_test:states");

        return store.queryByRids(["states.1"]).then(cursor => {
            if (cursor.hasNext()) {
                const feature = cursor.next();
                expect(feature.id).toBe("states.1");
            } else {
                expect(2).toBe(3);
            }
        }, () => {
            expect(2).toBe(3);
        })
    });

    it('WFSTFeatureStore.add', async () => {
        const {store, reference} = await CreateGeoserverStore("wfst_test:test_features");

        const shape = createPolygon(reference, [
            [9.80319279537696 ,37.449454109042925 ],
            [7.636453512280132 ,34.14847153056388 ],
            [9.695560662841046 ,30.09402069877914 ] ,
            [11.838673271155946 , 33.31466236650649],
            [9.80319279537696,37.449454109042925 ]
        ]);

        newFeature = new Feature(shape, {
            label: "Tunisia"
        }, 1);

        return store.add(newFeature).then(featureId => {
            if (featureId) {
                const prefix = "test_features";
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
        const {store, reference} = await CreateGeoserverStore("wfst_test:test_features");
        if (newFeature) {
            const shape = createPoint(newFeature.shape.reference, [0,0]);
            const updatedFeature = new Feature(shape, {...newFeature.properties, label:"Carthage"}, targetID);
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
        const {store, reference} = await CreateGeoserverStore("wfst_test:test_features");
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
        const {store, reference} = await CreateGeoserverStore("wfst_test:test_features");

        return store.remove(targetID).then(result => {
            expect(result).toBe(true);
        }, () => {
            expect(2).toBe(3);
        })
    });
})

// Mirrors the exact call shapes demo/src and demo-oldria/src use, so a src/ refactor that
// changes internals but keeps this contract passes, and one that doesn't, fails loudly.
describe('WFSTFeatureStore (demo call-shape parity)', () => {

    it('createFromURL_WFST(url, typeName) with no options (ModelFactory.ts exact call) - read-only layer', async () => {
        const store = await WFSTFeatureStore.createFromURL_WFST(OWS_URL, "wfst_test:states");
        expect(store).toBeInstanceOf(WFSTFeatureStore);
        expect(store.getTypeName()).toBe("wfst_test:states");
    });

    it('createFromURL_WFST(url, typeName) with no options - writable scratch layer', async () => {
        const store = await WFSTFeatureStore.createFromURL_WFST(OWS_URL, "wfst_test:test_features");
        expect(store).toBeInstanceOf(WFSTFeatureStore);
        expect(store.getTypeName()).toBe("wfst_test:test_features");
    });

    it('add/putProperties/remove single-arg calls mirror MainMapPanel.tsx', async () => {
        const store = await WFSTFeatureStore.createFromURL_WFST(OWS_URL, "wfst_test:test_features");
        const reference = store.getReference();

        const feature = new Feature(createPoint(reference, [10, 20]), {label: "demo-add"}, 1);
        const id = await store.add(feature); // MainMapPanel.tsx:94 - store.add(updated)
        expect(id).toBeTruthy();

        const updated = new Feature(createPoint(reference, [10, 20]), {label: "demo-update"}, id);
        const putResult = await store.putProperties(updated); // MainMapPanel.tsx:167 - store.putProperties(updated)
        expect(putResult).toBe(id);

        const removed = await store.remove(id); // MainMapPanel.tsx:134 - store.remove(f.id)
        expect(removed).toBe(true);
    });

    it('getFeatureWithLock({rids, expiry}) matches the shape EditWFSTFeaturesWithLockForm.tsx relies on', async () => {
        const store = await WFSTFeatureStore.createFromURL_WFST(OWS_URL, "wfst_test:test_features");
        const reference = store.getReference();

        const feature = new Feature(createPoint(reference, [3, 3]), {label: "lock-me"}, 1);
        const id = await store.add(feature);
        expect(id).toBeTruthy();

        const lockItem = await store.getFeatureWithLock({rids: [id as string], expiry: 5});
        expect(lockItem.lockId).toBeTruthy();
        expect(lockItem.unchangedIds).toContain(id);
        expect(lockItem.srsName).toBeTruthy();
        expect(lockItem.storeSettings).toBeTruthy();
        expect(lockItem.storeSettings.typeName).toBe("wfst_test:test_features");

        // EditCurrentLockForm.tsx:209,215 compares these two identities to associate a
        // persisted lock with the live layer/store it belongs to.
        const staticIdentity = WFSTFeatureStore.getWFSStoreIdentity(lockItem.storeSettings);
        const instanceIdentity = store.getWFSStoreidentity();
        expect(staticIdentity).toBe(instanceIdentity);

        // A plain store.remove() would be rejected by GeoServer while the feature is
        // locked ("Transaction does not have authorization"). Releasing the lock and
        // deleting in one commit - the same commitLockTransaction path EditCurrentLockForm.tsx
        // uses - is the correct way to clean up a locked feature.
        const commitResult = await store.commitLockTransaction({
            ...lockItem,
            unchangedIds: [],
            deletedIds: [id as string]
        });
        expect(commitResult.success).toBe(true);
        expect(commitResult.totalDeleted).toBe(1);
    });

    it('routes incomplete-properties add() through a custom screenHelper.EditNewFeatureProperties (MainMapPanel wiring)', async () => {
        const store = await WFSTFeatureStore.createFromURL_WFST(OWS_URL, "wfst_test:test_features");
        const editNewFeatureHandler = vi.fn();

        class TestScreenHelper extends WFSTDelegateScreenHelper {
            EditNewFeatureProperties(feature: Feature, storeArg: WFSTFeatureStore, newFeature = true) {
                editNewFeatureHandler(feature, storeArg, newFeature);
            }
        }
        store.setScreenHelper(new TestScreenHelper());

        // "label" is required by the layer's schema but intentionally omitted here.
        const incompleteFeature = new Feature(createPoint(store.getReference(), [0, 0]), {}, 1);
        const result = await store.add(incompleteFeature);

        expect(result).toBeNull();
        expect(editNewFeatureHandler).toHaveBeenCalledTimes(1);
        expect(editNewFeatureHandler.mock.calls[0][1]).toBe(store);
    });

    it('routes put() through a custom screenHelper.confirmGeometryUpdate, honoring cancel (MainMapPanel wiring)', async () => {
        const store = await WFSTFeatureStore.createFromURL_WFST(OWS_URL, "wfst_test:test_features");
        const reference = store.getReference();

        const feature = new Feature(createPoint(reference, [1, 1]), {label: "cancel-me"}, 1);
        const id = await store.add(feature);
        expect(id).toBeTruthy();

        class CancelingScreenHelper extends WFSTDelegateScreenHelper {
            confirmGeometryUpdate(onOK: () => void, onCancel?: () => void) {
                onCancel();
            }
        }
        store.setScreenHelper(new CancelingScreenHelper());

        const updated = new Feature(createPoint(reference, [2, 2]), {label: "cancel-me"}, id);
        const result = await store.put(updated);
        expect(result).toBeNull();

        store.setScreenHelper(new WFSTDelegateScreenHelper());
        await store.remove(id);
    });
})

async function CreateGeoserverStore(requestedFeatureType?:string) {
    const {wfsCapabilities, wfstCapabilities} = await WFSCapabilitiesExtended.fromURL(OWS_URL);
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
