import { describe, expect, it, vi } from 'vitest';
import {WFSCapabilitiesExtended} from "./WFSCapabilitiesExtended";
import {WFSTFeatureStore} from "./WFSTFeatureStore";
import {WFSTDelegateScreenHelper} from "./libs/screen/WFSTDelegateScreenHelper";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {createTransformation} from "@luciad/ria/transformation/TransformationFactory";
import {GeoJsonCodec} from "@luciad/ria/model/codec/GeoJsonCodec";
import {AdvancedGMLCodec} from "./libs/gml/gml32/AdvancedGMLCodec";
import {bbox} from "@luciad/ria/ogc/filter/FilterFactory";
import {createBounds, createCircularArcByCenterPoint, createPoint, createPolygon, createPolyline, createShapeList} from "@luciad/ria/shape/ShapeFactory";
import {Feature} from "@luciad/ria/model/feature/Feature";
import {Polygon} from "@luciad/ria/shape/Polygon";
import {Cursor} from "@luciad/ria/model/Cursor";

// Real timers are required for this test
// jest.useFakeTimers();

const OWS_URL = "http://localhost:8092/geoserver/ows";


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

// Backfilled coverage: the transport/error-branching logic in WFSTFeatureStore.ts (401/500/400/
// network-error handling, and the two call-site-specific overrides - add()'s extra
// EditNewFeatureProperties call on 400, remove()'s network-error-resolves-false) was just
// centralized into a shared helper, but none of it was actually exercised by any existing test -
// every test above only reaches the happy (200) path against the real server. Mocking fetch here
// is the right tool for this specific concern: it's our own control-flow being tested, not real
// server behavior, which the rest of this file already covers thoroughly.
describe('WFSTFeatureStore transport error handling', () => {
    async function warmedUpStore() {
        const store = await WFSTFeatureStore.createFromURL_WFST(OWS_URL, "wfst_test:test_features");
        // Populates featureTemplate via a real request, so the mocked call below (added per-test)
        // is the only fetch call intercepted - add()/put()/remove() all skip straight past their
        // own internal loadFeatureDescription() once featureTemplate is already set.
        await store.loadFeatureDescription();
        return store;
    }

    it('401 response resolves null and reports via delegateScreen.MessageError', async () => {
        const store = await warmedUpStore();
        const messageError = vi.fn();
        class SpyScreenHelper extends WFSTDelegateScreenHelper {
            MessageError(s: string) { messageError(s); }
        }
        store.setScreenHelper(new SpyScreenHelper());

        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({status: 401} as Response);
        const feature = new Feature(createPoint(store.getReference(), [1, 1]), {label: "x"}, 1);
        const result = await store.put(feature);

        expect(result).toBeNull();
        expect(messageError).toHaveBeenCalledWith(expect.stringContaining('Unauthorized'));
        fetchSpy.mockRestore();
    });

    it('add(): a 400 response triggers EditNewFeatureProperties in addition to the standard error message', async () => {
        const store = await warmedUpStore();
        const messageError = vi.fn();
        const editNewFeatureHandler = vi.fn();
        class SpyScreenHelper extends WFSTDelegateScreenHelper {
            MessageError(s: string) { messageError(s); }
            EditNewFeatureProperties(feature: Feature, storeArg: WFSTFeatureStore) { editNewFeatureHandler(feature, storeArg); }
        }
        store.setScreenHelper(new SpyScreenHelper());

        const fakeResponse = {
            status: 400,
            text: () => Promise.resolve(
                '<ows:ExceptionReport xmlns:ows="http://www.opengis.net/ows/1.1">' +
                '<ows:Exception exceptionCode="InvalidParameterValue">' +
                '<ows:ExceptionText>bad request</ows:ExceptionText>' +
                '</ows:Exception></ows:ExceptionReport>'
            )
        };
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(fakeResponse as Response);
        const feature = new Feature(createPoint(store.getReference(), [1, 1]), {label: "x"}, 1);
        const result = await store.add(feature);

        expect(result).toBeNull();
        // EditNewFeatureProperties fires synchronously as part of resolve(); MessageError fires
        // from error400()'s own response.text().then() chain, a separate, later microtask - wait
        // for it rather than asserting immediately after the outer promise settles.
        expect(editNewFeatureHandler).toHaveBeenCalledTimes(1);
        expect(editNewFeatureHandler.mock.calls[0][1]).toBe(store);
        await vi.waitFor(() => expect(messageError).toHaveBeenCalledWith(expect.stringContaining('InvalidParameterValue')));
        fetchSpy.mockRestore();
    });

    it('remove(): a network error resolves false, not null (the one call site that intentionally differs)', async () => {
        const store = await warmedUpStore();
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));

        const result = await store.remove(1);

        expect(result).toBe(false);
        fetchSpy.mockRestore();
    });

    it('loadFeatureDescription(): a network error is logged but the call site never resolves/rejects (pre-existing, unchanged)', async () => {
        const store = await WFSTFeatureStore.createFromURL_WFST(OWS_URL, "wfst_test:test_features");
        const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('network down'));

        let settled = false;
        store.loadFeatureDescription().then(() => { settled = true; }, () => { settled = true; });
        await new Promise(resolve => setTimeout(resolve, 50));

        expect(settled).toBe(false);
        expect(consoleLog).toHaveBeenCalledWith('error', expect.any(Error));
        fetchSpy.mockRestore();
        consoleLog.mockRestore();
    });
});

// Some servers (confirmed against a live LuciadFusion instance, documented in KNOWN_ISSUES.md)
// accept a Circle/Arc Insert/Update but silently degrade the geometry into something unreadable
// on the very next GetFeature. add()/put() re-query and bounds-check any Circle/Arc write before
// reporting success, so that failure is loud and immediate instead of surfacing later, on reload,
// disconnected from the save that caused it. Mocked here (no live server involved): the "verify"
// fetch response is built via AdvancedGMLCodec.encode() itself, the same proven encode/decode
// round trip AdvancedGMLCodec.test.ts already exercises directly.
describe('WFSTFeatureStore circular geometry round-trip verification', () => {
    function cursorOf(feature: Feature): Cursor<Feature> {
        let i = 0;
        const items = [feature];
        return {hasNext: () => i < items.length, next: () => items[i++]};
    }

    async function warmedUpGMLStore(options?: {verifyCircularGeometryRoundTrip?: boolean}) {
        const store = await WFSTFeatureStore.createFromURL_WFST(OWS_URL, "wfst_test:test_features", {
            codec: new AdvancedGMLCodec(),
            outputFormat: "application/gml+xml; version=3.2",
            ...options
        });
        // Same warm-up as the transport-error-handling describe block above: populates
        // featureTemplate via a real request, so every mocked fetch below is the only one add()/
        // put() actually issues.
        await store.loadFeatureDescription();
        return store;
    }

    function insertResponseXml(rid: string) {
        return `<wfs:TransactionResponse xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0">
            <wfs:TransactionSummary><wfs:totalInserted>1</wfs:totalInserted><wfs:totalUpdated>0</wfs:totalUpdated><wfs:totalDeleted>0</wfs:totalDeleted></wfs:TransactionSummary>
            <wfs:InsertResults><wfs:Feature><fes:ResourceId rid="${rid}"/></wfs:Feature></wfs:InsertResults>
        </wfs:TransactionResponse>`;
    }

    function updateResponseXml(rid: string) {
        return `<wfs:TransactionResponse xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0">
            <wfs:TransactionSummary><wfs:totalInserted>0</wfs:totalInserted><wfs:totalUpdated>1</wfs:totalUpdated><wfs:totalDeleted>0</wfs:totalDeleted></wfs:TransactionSummary>
        </wfs:TransactionResponse>`;
    }

    it('add(): a circular shape whose round trip matches resolves normally (one extra "verify" fetch)', async () => {
        const store = await warmedUpGMLStore();
        const codec = new AdvancedGMLCodec();
        const reference = store.getReference();
        const shape = createCircularArcByCenterPoint(reference, createPoint(reference, [0, 0]), 500, 30, 200);
        const verifyResponseXml = codec.encode(cursorOf(new Feature(shape, {}, "test_features.500"))).content;

        const fetchSpy = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce({status: 200, text: () => Promise.resolve(insertResponseXml("test_features.500"))} as Response)
            .mockResolvedValueOnce({status: 200, text: () => Promise.resolve(verifyResponseXml)} as Response);

        const feature = new Feature(shape, {label: "arc"});
        const result = await store.add(feature);

        expect(result).toBe("test_features.500");
        expect(fetchSpy).toHaveBeenCalledTimes(2);
        fetchSpy.mockRestore();
    });

    it('add(): a circular shape whose round trip does not match resolves null and reports MessageError', async () => {
        const store = await warmedUpGMLStore();
        const messageError = vi.fn();
        class SpyScreenHelper extends WFSTDelegateScreenHelper {
            MessageError(s: string) { messageError(s); }
        }
        store.setScreenHelper(new SpyScreenHelper());

        const codec = new AdvancedGMLCodec();
        const reference = store.getReference();
        const drawnShape = createCircularArcByCenterPoint(reference, createPoint(reference, [0, 0]), 500, 30, 200);
        // A server-degraded response: an empty geometry collection, matching what LuciadFusion
        // actually returns for a closed curve RIA can't decode - see KNOWN_ISSUES.md.
        const brokenFeature = new Feature(createShapeList(reference, []), {}, "test_features.501");
        const verifyResponseXml = codec.encode(cursorOf(brokenFeature)).content;

        const fetchSpy = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce({status: 200, text: () => Promise.resolve(insertResponseXml("test_features.501"))} as Response)
            .mockResolvedValueOnce({status: 200, text: () => Promise.resolve(verifyResponseXml)} as Response);

        const feature = new Feature(drawnShape, {label: "arc"});
        const result = await store.add(feature);

        expect(result).toBeNull();
        expect(messageError).toHaveBeenCalledWith(expect.stringContaining('Geometry round-trip verification failed'));
        fetchSpy.mockRestore();
    });

    it('add(): a non-circular shape (Polygon) skips verification entirely - no extra fetch', async () => {
        const store = await warmedUpGMLStore();
        const reference = store.getReference();
        const shape = createPolygon(reference, [[0, 0], [1, 0], [1, 1]]);

        const fetchSpy = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce({status: 200, text: () => Promise.resolve(insertResponseXml("test_features.502"))} as Response);

        const feature = new Feature(shape, {label: "polygon"});
        const result = await store.add(feature);

        expect(result).toBe("test_features.502");
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        fetchSpy.mockRestore();
    });

    it('add(): verifyCircularGeometryRoundTrip: false skips verification even for a circular shape', async () => {
        const store = await warmedUpGMLStore({verifyCircularGeometryRoundTrip: false});
        const reference = store.getReference();
        const shape = createCircularArcByCenterPoint(reference, createPoint(reference, [0, 0]), 500, 30, 200);

        const fetchSpy = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce({status: 200, text: () => Promise.resolve(insertResponseXml("test_features.503"))} as Response);

        const feature = new Feature(shape, {label: "arc"});
        const result = await store.add(feature);

        expect(result).toBe("test_features.503");
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        fetchSpy.mockRestore();
    });

    it('put(): a circular shape whose round trip does not match resolves null and reports MessageError', async () => {
        const store = await warmedUpGMLStore();
        const messageError = vi.fn();
        class SpyScreenHelper extends WFSTDelegateScreenHelper {
            MessageError(s: string) { messageError(s); }
        }
        store.setScreenHelper(new SpyScreenHelper());

        const codec = new AdvancedGMLCodec();
        const reference = store.getReference();
        const editedShape = createCircularArcByCenterPoint(reference, createPoint(reference, [0, 0]), 500, 30, 200);
        const brokenFeature = new Feature(createShapeList(reference, []), {}, "test_features.504");
        const verifyResponseXml = codec.encode(cursorOf(brokenFeature)).content;

        const fetchSpy = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce({status: 200, text: () => Promise.resolve(updateResponseXml("test_features.504"))} as Response)
            .mockResolvedValueOnce({status: 200, text: () => Promise.resolve(verifyResponseXml)} as Response);

        const feature = new Feature(editedShape, {label: "arc"}, "test_features.504");
        const result = await store.put(feature);

        expect(result).toBeNull();
        expect(messageError).toHaveBeenCalledWith(expect.stringContaining('Geometry round-trip verification failed'));
        fetchSpy.mockRestore();
    });

    // Live GeoServer regression guard, no mocking: GeoTools' WFS-T Transaction parser rejects
    // gml:ArcByCenterPoint/CircleByCenterPoint outright (confirmed this session via raw curl) -
    // the new verification code must never even run here, since the existing (correct) rejection
    // already resolves null before any "verify" query would happen. Guards against the new logic
    // accidentally changing this already-correct, pre-existing behavior.
    it('add(): a CircularArcByCenterPoint insert against real GeoServer is still rejected at the Transaction level (verification never runs)', async () => {
        const store = await warmedUpGMLStore();
        const reference = store.getReference();
        const shape = createCircularArcByCenterPoint(reference, createPoint(reference, [-90, 35]), 500, 30, 200);
        const feature = new Feature(shape, {label: "geoserver-arc-rejection-guard"});

        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const result = await store.add(feature);

        expect(result).toBeNull();
        // Exactly one fetch (the rejected Insert) - proves the verification step's own extra
        // "verify" query never fires, since there's no successful insert to verify.
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        fetchSpy.mockRestore();
    }, 15000);
});

// Verifies requestHeaders - the standard LuciadRIA mechanism for attaching custom HTTP headers to
// every request a store makes (as opposed to browser-native credentials:true/cookie auth) -
// actually reaches a real, password-protected WFS-T service end to end: both the initial
// GetCapabilities/DescribeFeatureType discovery inside createFromURL_WFST, and the later
// GetFeature/Transaction calls. wfst_secured:secured_features (see docker/bootstrap/bootstrap.sh)
// requires role WFST_SECURED_ROLE for both read and write; every other layer's ACL is untouched.
describe('WFSTFeatureStore custom request headers / basic auth (secured layer)', () => {
    const SECURED_URL = "http://localhost:8092/geoserver/wfst_secured/ows";
    const SECURED_TYPE_NAME = "wfst_secured:secured_features";

    function basicAuthHeader(username: string, password: string): string {
        return 'Basic ' + btoa(`${username}:${password}`);
    }

    it('reads and writes through a password-protected layer using requestHeaders (createFromURL_WFST)', async () => {
        const store = await WFSTFeatureStore.createFromURL_WFST(SECURED_URL, SECURED_TYPE_NAME, {
            requestHeaders: {Authorization: basicAuthHeader('wfst_secured_user', 'wfst_secured_pass')},
            codec: new GeoJsonCodec({generateIDs: false})
        });
        const reference = store.getReference();

        const feature = new Feature(createPoint(reference, [4, 4]), {label: "secured-round-trip"}, 1);
        const id = await store.add(feature);
        expect(id).toBeTruthy();

        const cursor = await store.queryByRids([id as string]);
        expect(cursor.hasNext()).toBe(true);
        expect(cursor.next().properties.label).toBe("secured-round-trip");

        const removed = await store.remove(id as string);
        expect(removed).toBe(true);
    });

    // createFromURL_WFST is a convenience wrapper: fetch capabilities (with requestHeaders) ->
    // resolve serviceURL/reference/etc from them -> construct WFSTFeatureStore internally. Building
    // the store directly via `new WFSTFeatureStore(...)` skips that capabilities-fetch step entirely,
    // so this proves requestHeaders is honored by the store's own per-request path (fetchSettingsOptions),
    // not merely forwarded through the capabilities convenience method.
    it('reads and writes through a password-protected layer using requestHeaders (direct constructor)', async () => {
        const reference = getReference("EPSG:4326");
        const store = new WFSTFeatureStore({
            wfst: {Transaction: true} as any,
            generateIDs: false,
            outputFormat: "application/json",
            codec: new GeoJsonCodec({generateIDs: false}),
            swapAxes: false,
            swapQueryAxes: false,
            serviceURL: "http://localhost:8092/geoserver/wfst_secured/wfs",
            postServiceURL: "http://localhost:8092/geoserver/wfst_secured/wfs",
            reference,
            typeName: SECURED_TYPE_NAME,
            versions: ["2.0.0" as any],
            credentials: false,
            requestHeaders: {Authorization: basicAuthHeader('wfst_secured_user', 'wfst_secured_pass')},
            methods: ["POST", "GET"]
        } as any);

        const feature = new Feature(createPoint(reference, [5, 5]), {label: "secured-round-trip-ctor"}, 1);
        const id = await store.add(feature);
        expect(id).toBeTruthy();

        const cursor = await store.queryByRids([id as string]);
        expect(cursor.hasNext()).toBe(true);
        expect(cursor.next().properties.label).toBe("secured-round-trip-ctor");

        const removed = await store.remove(id as string);
        expect(removed).toBe(true);
    });

    it('without any credentials, GetCapabilities succeeds but the secured layer is hidden - not discoverable at all', async () => {
        await expect(WFSTFeatureStore.createFromURL_WFST(SECURED_URL, SECURED_TYPE_NAME)).rejects.toThrow(
            /no feature type/i
        );
    });

    it('with wrong credentials, the GetCapabilities request itself is rejected (401)', async () => {
        await expect(WFSTFeatureStore.createFromURL_WFST(SECURED_URL, SECURED_TYPE_NAME, {
            requestHeaders: {Authorization: basicAuthHeader('wfst_secured_user', 'WRONG_PASSWORD')}
        })).rejects.toThrow();
    });
});

// Closes the loop the unit tests structurally cannot: whether a real WFS-T server (GeoServer +
// PostGIS), not just our own codec/RIA's decode in isolation, actually accepts and round-trips 3D
// data through a live Transaction. Uses the dedicated wfst_test:test_features_3d layer (see
// docker/postgres/init/03-test-features-3d.sql) - PostGIS typed geometry columns are either
// strictly 2D or strictly 3D, never both (verified empirically: inserting a Z geometry into
// test_features.geom, which is geometry(Geometry, 4326), fails with "Geometry has Z dimension but
// column does not"), so 3D data needs its own table/featureType rather than widening the existing
// 2D one. mode3D:true is passed explicitly on the read-side codec here only (see
// CreateGeoserverStore) so the query-back step doesn't itself drop Z before we can assert on it -
// the write side (store.add) always auto-detects correctly regardless.
// Generic, tolerance-based "are these two features close enough" comparator - a real WFS-T round
// trip through GML/GeoJSON text serialization can introduce tiny floating-point drift that exact
// equality would flag as a false failure. Tolerance defaults tight (1e-6): no reprojection is
// happening in any of these tests (same reference in and out), unlike the circular-shape/3-point-
// circle cases elsewhere in this codebase that legitimately need a much looser, percentage-based
// tolerance for genuine geometric approximation error.
function expectFeaturesCloseEnough(original: Feature, decoded: Feature | null, tolerance = 1e-6) {
    expect(decoded).not.toBeNull();
    expect(decoded.properties).toEqual(original.properties);
    expectShapesCloseEnough(original.shape as any, decoded.shape as any, tolerance);
}

function expectShapesCloseEnough(original: any, decoded: any, tolerance: number) {
    expect(decoded).not.toBeNull();
    if (typeof original.shapeCount === "number") {
        expect(decoded.shapeCount).toBe(original.shapeCount);
        for (let i = 0; i < original.shapeCount; i++) {
            expectShapesCloseEnough(original.getShape(i), decoded.getShape(i), tolerance);
        }
        return;
    }
    if (typeof original.pointCount === "number") {
        expect(decoded.pointCount).toBe(original.pointCount);
        for (let i = 0; i < original.pointCount; i++) {
            expectPointsCloseEnough(original.getPoint(i), decoded.getPoint(i), tolerance);
        }
        return;
    }
    expectPointsCloseEnough(original, decoded, tolerance);
}

function expectPointsCloseEnough(a: any, b: any, tolerance: number) {
    expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(tolerance);
    expect(Math.abs((a.z ?? 0) - (b.z ?? 0))).toBeLessThanOrEqual(tolerance);
}

describe('WFSTFeatureStore 3D support (live GeoServer round-trip)', () => {
    it('adds a 3D point and reads back the Z value through a real WFS-T Transaction', async () => {
        const {store, reference} = await CreateGeoserverStore("wfst_test:test_features_3d", {mode3D: true});

        const feature = new Feature(createPoint(reference, [50, 60, 123]), {label: "3d-point"}, 1);
        const id = await store.add(feature);
        expect(id).toBeTruthy();

        const cursor = await store.queryByRids([id as string]);
        expect(cursor.hasNext()).toBe(true);
        const readBack = cursor.next();
        expect((readBack.shape as any).z).toBe(123);

        await store.remove(id);
    });

    // Live GeoServer regression guard, no mocking, real encoder - confirmed via this exact test:
    // this library never reprojects a feature's geometry before encoding it, and sets srsName to
    // literally describe whatever reference the shape already carries (see GMLFeatureEncoder.ts /
    // AdvancedGMLCodec.ts, both pull srsName from `shape.reference.identifier`). That's fine as
    // long as the shape's reference matches the target layer's own reference - which every other
    // test in this describe block deliberately arranges via CreateGeoserverStore's own `reference`
    // (the layer's advertised default, geographic). This test is the one exception: it builds the
    // exact same point converted to EPSG:4978 (geocentric) - the reference ria-3d-shape-editor's
    // demo-3d integration always uses, since a 3D map's own reference must be EPSG:4978 for the
    // height handle to work at all - and sends it as-is. GeoServer's own GeoTools CRS engine
    // rejects the Transaction outright with "No transformation available from system
    // CartesianCS[...geocentric...] to CartesianCS[Geocentric]" (confirmed via the raw GML/JSON
    // wire response in manual testing this session) - so `store.add()` resolves null, exactly like
    // the CircularArcByCenterPoint-rejection guard above. See KNOWN_ISSUES.md for the full writeup
    // and the two candidate fixes (reproject client-side before encoding, in this library or in
    // the consuming app).
    it('add(): a shape whose reference is EPSG:4978 (geocentric) is rejected at the Transaction level - this library never reprojects before encoding', async () => {
        const {store, reference} = await CreateGeoserverStore("wfst_test:test_features_3d", {mode3D: true});

        const epsg4978 = getReference("EPSG:4978");
        const pointInLayerRef = createPoint(reference, [50, 60, 123]);
        const pointInEpsg4978 = createTransformation(reference, epsg4978).transform(pointInLayerRef);
        const feature = new Feature(pointInEpsg4978, {label: "3d-point-geocentric"}, 1);

        const id = await store.add(feature);

        expect(id).toBeNull();
    }, 15000);

    it('adds a 3D polygon and reads back Z on every vertex through a real WFS-T Transaction', async () => {
        const {store, reference} = await CreateGeoserverStore("wfst_test:test_features_3d", {mode3D: true});

        const ring = [
            [60, 60, 15], [60, 70, 15], [70, 70, 15], [70, 60, 15], [60, 60, 15]
        ] as any;
        const feature = new Feature(createPolygon(reference, ring), {label: "3d-polygon"}, 1);
        const id = await store.add(feature);
        expect(id).toBeTruthy();

        const cursor = await store.queryByRids([id as string]);
        expect(cursor.hasNext()).toBe(true);
        const readBack = cursor.next();
        const polygon = readBack.shape as Polygon;
        for (let i = 0; i < polygon.pointCount; i++) {
            expect(polygon.getPoint(i).z).toBe(15);
        }

        await store.remove(id);
    });

    it('adds a 3D LineString (distinct X/Y/Z per vertex) and reads back a close-enough feature', async () => {
        const {store, reference} = await CreateGeoserverStore("wfst_test:test_features_3d", {mode3D: true});

        const points = [[10, 10, 5], [20, 15, 25], [30, 5, 8]] as any;
        const feature = new Feature(createPolyline(reference, points), {label: "3d-line"}, 1);
        const id = await store.add(feature);
        expect(id).toBeTruthy();

        const cursor = await store.queryByRids([id as string]);
        expect(cursor.hasNext()).toBe(true);
        expectFeaturesCloseEnough(feature, cursor.next());

        await store.remove(id);
    });

    it('adds a 3D MultiPoint (ShapeList of Points, distinct Z each) and reads back a close-enough feature', async () => {
        const {store, reference} = await CreateGeoserverStore("wfst_test:test_features_3d", {mode3D: true});

        const shapeList = createShapeList(reference, [
            createPoint(reference, [40, 40, 2]),
            createPoint(reference, [41, 41, 9]),
            createPoint(reference, [42, 40, 17]),
        ]);
        const feature = new Feature(shapeList, {label: "3d-multipoint"}, 1);
        const id = await store.add(feature);
        expect(id).toBeTruthy();

        const cursor = await store.queryByRids([id as string]);
        expect(cursor.hasNext()).toBe(true);
        expectFeaturesCloseEnough(feature, cursor.next());

        await store.remove(id);
    });

    it('adds a 3D MultiCurve (ShapeList of Polylines, distinct Z per vertex) and reads back a close-enough feature', async () => {
        const {store, reference} = await CreateGeoserverStore("wfst_test:test_features_3d", {mode3D: true});

        const shapeList = createShapeList(reference, [
            createPolyline(reference, [[50, 50, 3], [51, 51, 6]] as any),
            createPolyline(reference, [[55, 55, 11], [56, 56, 14], [57, 55, 20]] as any),
        ]);
        const feature = new Feature(shapeList, {label: "3d-multicurve"}, 1);
        const id = await store.add(feature);
        expect(id).toBeTruthy();

        const cursor = await store.queryByRids([id as string]);
        expect(cursor.hasNext()).toBe(true);
        expectFeaturesCloseEnough(feature, cursor.next());

        await store.remove(id);
    });

    // Tilted-plane case: 2 adjacent vertices at Z=A, the other 2 at Z=B - a valid inclined plane
    // (Z = A + (B-A)*y/10 here), not just the flat/horizontal case the existing polygon test
    // above already covers. Genuinely unverified going in (per the user's own framing) - not an
    // assumed-safe case.
    it('adds a 3D Polygon on a tilted (non-horizontal) plane and reads back a close-enough feature', async () => {
        const {store, reference} = await CreateGeoserverStore("wfst_test:test_features_3d", {mode3D: true});

        // No repeated closing coordinate: RIA's Polygon implicitly closes the ring, and a
        // round-tripped feature comes back de-duplicated - feeding a redundant closing point in
        // here would just make the *original* (never touching the network) report a pointCount
        // one higher than any decoded feature ever would, which isn't a real discrepancy to catch.
        const ring = [
            [80, 80, 100], [90, 80, 100], [90, 90, 140], [80, 90, 140]
        ] as any;
        const feature = new Feature(createPolygon(reference, ring), {label: "3d-tilted-polygon"}, 1);
        const id = await store.add(feature);
        expect(id).toBeTruthy();

        const cursor = await store.queryByRids([id as string]);
        expect(cursor.hasNext()).toBe(true);
        expectFeaturesCloseEnough(feature, cursor.next());

        await store.remove(id);
    });

    // Coplanar within each polygon (flat/horizontal), but distinct heights between the two
    // polygons in the collection - more coverage than the single-polygon, single-height test
    // above, without attempting a shape LuciadRIA's own model doesn't support.
    it('adds a 3D MultiSurface (two flat polygons at different heights) and reads back a close-enough feature', async () => {
        const {store, reference} = await CreateGeoserverStore("wfst_test:test_features_3d", {mode3D: true});

        // Y (latitude, geodetic reference) must stay within [-90, 90] - RIA's own Polygon clamps
        // out-of-range latitude silently (documented in Polygon.d.ts), which would otherwise
        // collapse adjacent vertices together and masquerade as a "lost vertex" round-trip bug.
        const shapeList = createShapeList(reference, [
            createPolygon(reference, [[10, 10, 10], [20, 10, 10], [20, 20, 10], [10, 20, 10]] as any),
            createPolygon(reference, [[30, 10, 50], [40, 10, 50], [40, 20, 50], [30, 20, 50]] as any),
        ]);
        const feature = new Feature(shapeList, {label: "3d-multisurface"}, 1);
        const id = await store.add(feature);
        expect(id).toBeTruthy();

        const cursor = await store.queryByRids([id as string]);
        expect(cursor.hasNext()).toBe(true);
        expectFeaturesCloseEnough(feature, cursor.next());

        await store.remove(id);
    });
});

// Pure constructor logic, no network involved: minimalConstructorOptions below only needs to be
// enough for `new WFSTFeatureStore(...)` to not throw, since nothing here calls a method that
// performs a real request.
function minimalConstructorOptions(overrides: {swapAxes?: boolean | string[], referenceIdentifier?: string} = {}) {
    const reference = getReference(overrides.referenceIdentifier ?? "CRS:84");
    return {
        wfst: {Transaction: true} as any,
        outputFormat: "application/json",
        codec: new GeoJsonCodec({generateIDs: false}),
        swapAxes: overrides.swapAxes,
        serviceURL: "http://localhost:8092/geoserver/wfst_test/wfs",
        postServiceURL: "http://localhost:8092/geoserver/wfst_test/wfs",
        reference,
        typeName: "wfst_test:test_features",
        versions: ["2.0.0" as any],
        methods: ["POST", "GET"]
    } as any;
}

describe('WFSTFeatureStore swapAxes (invertAxes) handling', () => {
    it('swapAxes: true forces axis inversion (Catalog-Explorer-style blanket boolean toggle)', () => {
        const store = new WFSTFeatureStore(minimalConstructorOptions({swapAxes: true}));
        expect((store as any).invertAxes).toBe(true);
    });

    it('swapAxes: false / omitted means no forced inversion', () => {
        const storeFalse = new WFSTFeatureStore(minimalConstructorOptions({swapAxes: false}));
        expect((storeFalse as any).invertAxes).toBe(false);

        const storeOmitted = new WFSTFeatureStore(minimalConstructorOptions());
        expect((storeOmitted as any).invertAxes).toBe(false);
    });

    it('swapAxes: [<this store\'s own reference identifier>] forces inversion - the array form actually works', () => {
        const store = new WFSTFeatureStore(minimalConstructorOptions({
            referenceIdentifier: "CRS:84",
            swapAxes: ["CRS:84"]
        }));
        expect((store as any).invertAxes).toBe(true);
    });

    it('swapAxes: [<an unrelated identifier>] does NOT force inversion - the actual bug fix', () => {
        const store = new WFSTFeatureStore(minimalConstructorOptions({
            referenceIdentifier: "CRS:84",
            swapAxes: ["EPSG:3857"]
        }));
        expect((store as any).invertAxes).toBe(false);
    });
});

async function CreateGeoserverStore(requestedFeatureType?:string, overrides?: {mode3D?: boolean}) {
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
        codec: new GeoJsonCodec({generateIDs: false, mode3D: overrides?.mode3D}),
        mode3D: overrides?.mode3D,
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
