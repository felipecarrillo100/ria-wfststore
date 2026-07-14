import {describe, expect, it, vi} from 'vitest';
import {WFSTFeatureStore} from "./WFSTFeatureStore";
import {WFSTFeatureLockStore} from "./WFSTFeatureLockStore";
import {WFSTFeatureLocksStorage} from "./libs/storage/WFSTFeatureLocksStorage";
import {WFSTDelegateScreenHelper} from "./libs/screen/WFSTDelegateScreenHelper";
import {createPoint} from "@luciad/ria/shape/ShapeFactory";
import {Feature} from "@luciad/ria/model/feature/Feature";

// Mirrors the exact pipeline MainMapPanel.tsx -> EditWFSTFeaturesWithLockForm.tsx ->
// EditCurrentLockForm.tsx drives: acquire a lock via WFSTFeatureStore.getFeatureWithLock,
// persist it (stripping the non-serializable "bounds" field, exactly like the demo does),
// reload it, build a WFSTFeatureLockStore from it, edit through the lock store, then commit
// or cancel. A src/ refactor must keep every one of these calls working exactly as today.

const OWS_URL = "http://localhost:8081/geoserver/ows";
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
});
