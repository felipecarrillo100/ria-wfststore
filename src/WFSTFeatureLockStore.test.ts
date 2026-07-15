import {describe, expect, it, vi} from 'vitest';
import {WFSTFeatureStore} from "./WFSTFeatureStore";
import {WFSTFeatureLockStore} from "./WFSTFeatureLockStore";
import {WFSTFeatureLocksStorage} from "./libs/storage/WFSTFeatureLocksStorage";
import {WFSTDelegateScreenHelper} from "./libs/screen/WFSTDelegateScreenHelper";
import {AdvancedGMLCodec} from "./libs/gml/gml32/AdvancedGMLCodec";
import {createCircularArcByCenterPoint, createPoint} from "@luciad/ria/shape/ShapeFactory";
import {ShapeType} from "@luciad/ria/shape/ShapeType";
import {Feature} from "@luciad/ria/model/feature/Feature";

// Mirrors the exact pipeline MainMapPanel.tsx -> EditWFSTFeaturesWithLockForm.tsx ->
// EditCurrentLockForm.tsx drives: acquire a lock via WFSTFeatureStore.getFeatureWithLock,
// persist it (stripping the non-serializable "bounds" field, exactly like the demo does),
// reload it, build a WFSTFeatureLockStore from it, edit through the lock store, then commit
// or cancel. A src/ refactor must keep every one of these calls working exactly as today.

const OWS_URL = "http://localhost:8092/geoserver/ows";
const TYPE_NAME = "wfst_test:lock_features";

async function waitFor(predicate: () => boolean, timeoutMs = 5000, intervalMs = 50): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
        if (Date.now() - start > timeoutMs) {
            throw new Error("waitFor: timed out");
        }
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
}

async function acquireLock(label: string) {
    const store = await WFSTFeatureStore.createFromURL_WFST(OWS_URL, TYPE_NAME);
    const reference = store.getReference();
    const feature = new Feature(createPoint(reference, [6, 6]), {label}, 1);
    const id = await store.add(feature);
    expect(id).toBeTruthy();

    const lockItem = await store.getFeatureWithLock({rids: [id as string], expiry: 5});
    // EditWFSTFeaturesWithLockForm.tsx:63 - strip the non-JSON-serializable bounds before persisting.
    (lockItem as any).storeSettings = {...(lockItem.storeSettings as any), bounds: undefined};
    lockItem.lockName = `${label} lock`.trim();

    await WFSTFeatureLocksStorage.addLock(lockItem); // mutates lockItem.id in place
    const retrieved = await WFSTFeatureLocksStorage.getLock(lockItem.id);
    return {store, id: id as string, storageId: lockItem.id, retrieved};
}

describe('WFSTFeatureLockStore (demo call-shape parity)', () => {

    it('full lock -> edit -> commit pipeline mirrors MainMapPanel/EditWFSTFeaturesWithLockForm/EditCurrentLockForm', async () => {
        const {id, storageId, retrieved} = await acquireLock("lock-flow");

        const lockStore = new WFSTFeatureLockStore(retrieved); // MainMapPanel.tsx:286

        // getReference() - EditWithLockHelper.ts:14
        expect(lockStore.getReference().identifier).toBe(retrieved.srsName);

        // Constructor kicks off an async load (loadFeatureDescription + loadLatestState);
        // wait for the locked feature to actually appear before touching the store.
        await waitFor(() => (lockStore as any).query().hasNext());

        // Inherited, unoverridden MemoryStore.query() - EditCurrentLockForm.tsx:57 calls this
        // synchronously with no args and immediately calls hasNext()/next() on the result.
        const cursor = (lockStore as any).query();
        expect(cursor).not.toBeInstanceOf(Promise);
        expect(cursor.hasNext()).toBe(true);
        expect(cursor.next().id).toBe(id);

        // putProperties() - MainMapPanel.tsx:315, called without .then/.catch: must be synchronous.
        const updated = new Feature(createPoint(lockStore.getReference(), [6, 6]), {label: "lock-flow-updated"}, id);
        const putResult = lockStore.putProperties(updated);
        expect(putResult).not.toBeInstanceOf(Promise);
        expect(putResult).toBe(id);

        // setScreenHelper() must propagate to the internal delegate WFSTFeatureStore too
        // (WFSTFeatureLockStore.setScreenHelper sets both) - verified via a commit below.
        const messageInfo = vi.fn();
        class SpyScreenHelper extends WFSTDelegateScreenHelper {
            MessageInfo(s: string) {
                messageInfo(s);
            }
        }
        lockStore.setScreenHelper(new SpyScreenHelper());

        // remove() - MainMapPanel.tsx:324, also called synchronously.
        const removeResult = lockStore.remove(id);
        expect(removeResult).not.toBeInstanceOf(Promise);

        // commitLockTransaction() real path - EditCurrentLockForm.tsx:237, fetching the
        // latest persisted lock item right before committing.
        const latest = await WFSTFeatureLocksStorage.getLock(storageId);
        const commitResult = await lockStore.commitLockTransaction(latest);
        expect(commitResult.success).toBe(true);
        expect(commitResult.totalChanges).toBeGreaterThan(0);
        expect(messageInfo).toHaveBeenCalledTimes(1); // proves setScreenHelper reached the delegate store

        await WFSTFeatureLocksStorage.deleteLock(storageId); // EditCurrentLockForm.tsx:241
    });

    it('commitLockTransaction with an emptied lock item releases the lock without changes (EditCurrentLockForm.tsx handleCancel)', async () => {
        const {storageId, retrieved} = await acquireLock("lock-cancel");
        const lockStore = new WFSTFeatureLockStore(retrieved);
        await waitFor(() => (lockStore as any).query().hasNext());

        const latest = await WFSTFeatureLocksStorage.getLock(storageId);
        const empty = {...latest, deletedIds: [], insertedIds: [], updatedIds: []};
        const cancelResult = await lockStore.commitLockTransaction(empty);
        expect(cancelResult.success).toBe(true);
        expect(cancelResult.totalChanges).toBe(0);

        await WFSTFeatureLocksStorage.deleteLock(storageId).catch(() => {}); // EditCurrentLockForm.tsx:278,281
    });

    // Two real bugs identified during architecture review, reproduced here before fixing.
    it('remove() splices insertedIds at the correct index, not the unrelated updatedIndex', async () => {
        const {storageId, retrieved} = await acquireLock("remove-bug");
        const lockStore = new WFSTFeatureLockStore(retrieved);
        await waitFor(() => (lockStore as any).query().hasNext());

        const featureA = new Feature(createPoint(lockStore.getReference(), [1, 1]), {label: "A"}, 101);
        const featureB = new Feature(createPoint(lockStore.getReference(), [2, 2]), {label: "B"}, 102);
        const idA = lockStore.add(featureA);
        const idB = lockStore.add(featureB);
        expect((lockStore as any).options.insertedIds.map((e: any) => e.id)).toEqual([idA, idB]);

        // idA sits at insertedIndex 0, with updatedIds empty (updatedIndex always -1 here). The bug
        // spliced insertedIds at updatedIndex (-1, i.e. the last element) instead of insertedIndex,
        // so removing A incorrectly deleted B and left A behind.
        lockStore.remove(idA);

        const remainingIds = (lockStore as any).options.insertedIds.map((e: any) => e.id);
        expect(remainingIds).toEqual([idB]);

        await WFSTFeatureLocksStorage.deleteLock(storageId).catch(() => {});
    });

    it('put() updates insertedIds even when the feature sits at index 0', async () => {
        const {storageId, retrieved} = await acquireLock("put-falsy-zero-bug");
        const lockStore = new WFSTFeatureLockStore(retrieved);
        await waitFor(() => (lockStore as any).query().hasNext());

        const feature = new Feature(createPoint(lockStore.getReference(), [3, 3]), {label: "original"}, 201);
        const id = lockStore.add(feature);
        expect((lockStore as any).options.insertedIds.findIndex((e: any) => e.id === id)).toBe(0);

        // insertedIndex is 0 here - "else if (insertedIndex)" treats 0 as falsy and skips the
        // assignment entirely, so the edit below never reaches insertedIds and would be silently
        // dropped from the eventual WFS-T commit despite super.put() updating the local MemoryStore.
        const editedFeature = new Feature(createPoint(lockStore.getReference(), [3, 3]), {label: "edited"}, id);
        lockStore.put(editedFeature);

        const trackedEntry = (lockStore as any).options.insertedIds.find((e: any) => e.id === id);
        expect(JSON.parse(trackedEntry.feature).properties.label).toBe("edited");

        await WFSTFeatureLocksStorage.deleteLock(storageId).catch(() => {});
    });
});

// The lock-editing helper builds its own internal delegate WFSTFeatureStore
// (initializeDelegateStore) rather than reusing whatever store/codec the main WFS-T layer was
// actually configured with - storeSettings deliberately strips the codec instance (it isn't
// serializable), so the lock store re-derives one from the outputFormat string alone. Before this
// fix it always picked RIA's own plain GMLCodec for non-JSON output, which has none of the
// Circle/Arc fixes (ellipse-drift normalization, ShapeList(1) unwrap, or encode support at all) -
// so a feature edited through the lock helper showed a different, unsafe shape than the same
// feature edited through the main layer. These tests target the GML branch specifically; the
// existing tests above (unmodified) already prove the JSON branch is untouched.
describe('WFSTFeatureLockStore GML branch (Circle/Arc parity with the main WFS-T layer)', () => {
    async function acquireLockGML(label: string) {
        const store = await WFSTFeatureStore.createFromURL_WFST(OWS_URL, "wfst_test:test_features", {
            codec: new AdvancedGMLCodec(),
            outputFormat: "application/gml+xml; version=3.2",
        });
        const reference = store.getReference();
        // The feature being locked is a plain Point, not a circular shape: GeoServer's WFS-T
        // Transaction parser rejects gml:ArcByCenterPoint/CircleByCenterPoint outright (confirmed
        // elsewhere in this codebase), so a real circular Insert can't be acquired against it at
        // all. The fix under test only concerns the LOCAL edit/pending-cache round trip (put() and
        // loadLatestState()), which never touches the network - editing the locked feature to a
        // CircularArcByCenterPoint entirely client-side is enough to exercise it.
        const feature = new Feature(createPoint(reference, [6, 6]), {label});
        const id = await store.add(feature);
        expect(id).toBeTruthy();

        const lockItem = await store.getFeatureWithLock({rids: [id as string], expiry: 5});
        (lockItem as any).storeSettings = {...(lockItem.storeSettings as any), bounds: undefined};
        lockItem.lockName = `${label} lock`.trim();

        await WFSTFeatureLocksStorage.addLock(lockItem);
        const retrieved = await WFSTFeatureLocksStorage.getLock(lockItem.id);
        return {storageId: lockItem.id, retrieved};
    }

    it('put(): editing to a CircularArcByCenterPoint does not crash, and the pending edit is GML- not GeoJSON-serialized', async () => {
        const {storageId, retrieved} = await acquireLockGML("gml-lock-put");
        const lockStore = new WFSTFeatureLockStore(retrieved);
        await waitFor(() => (lockStore as any).query().hasNext());
        const existingId = (lockStore as any).query().next().id;

        const arcShape = createCircularArcByCenterPoint(lockStore.getReference(), createPoint(lockStore.getReference(), [6, 6]), 500, 30, 200);
        const putResult = lockStore.put(new Feature(arcShape, {label: "edited-to-arc"}, existingId));

        expect(putResult).toBe(existingId);
        const tracked = (lockStore as any).options.updatedIds.find((e: any) => e.id === existingId);
        expect(tracked).toBeTruthy();
        // GML, not GeoJSON: JSON.parse would throw on GML/XML text.
        expect(() => JSON.parse(tracked.feature)).toThrow();
        expect(tracked.feature).toContain("gml:ArcByCenterPoint");

        await WFSTFeatureLocksStorage.deleteLock(storageId).catch(() => {});
    });

    it('loadLatestState(): a pending CircularArcByCenterPoint edit reloads as the same safe shape, not the elliptical Arc', async () => {
        const {storageId, retrieved} = await acquireLockGML("gml-lock-reload");
        const lockStore = new WFSTFeatureLockStore(retrieved);
        await waitFor(() => (lockStore as any).query().hasNext());
        const existingId = (lockStore as any).query().next().id;

        const arcShape = createCircularArcByCenterPoint(lockStore.getReference(), createPoint(lockStore.getReference(), [6, 6]), 500, 30, 200);
        lockStore.put(new Feature(arcShape, {label: "edited-to-arc"}, existingId));

        // Simulate reloading the page: a fresh WFSTFeatureLockStore built from the same persisted
        // lock item, exercising loadLatestState()'s decodePendingFeature path from scratch.
        const latest = await WFSTFeatureLocksStorage.getLock(storageId);
        const reloadedLockStore = new WFSTFeatureLockStore(latest);
        await waitFor(() => (reloadedLockStore as any).query().hasNext());

        const reloadedShape: any = (reloadedLockStore as any).query().next().shape;
        expect(ShapeType.contains(reloadedShape.type, ShapeType.CIRCULAR_ARC)).toBe(true);
        expect(ShapeType.contains(reloadedShape.type, ShapeType.ARC)).toBe(false);

        await WFSTFeatureLocksStorage.deleteLock(storageId).catch(() => {});
    });
});
