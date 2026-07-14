import {beforeEach, describe, expect, it, vi} from 'vitest';
import {WFSTFeatureLocksStorage} from "./WFSTFeatureLocksStorage";
import {WFSTEditFeatureLockItem} from "../../WFSTFeatureStore";

// Backs ListAvailableWFSTFeatureLocksForm.tsx and EditCurrentLockForm.tsx - pure
// localStorage-backed API, no network involved, so these run against jsdom directly.

function makeLockItem(overrides: Partial<WFSTEditFeatureLockItem> = {}): WFSTEditFeatureLockItem {
    return {
        lockId: "LOCK123",
        expiry: 5, // minutes
        lockName: "My Lock",
        storeSettings: {} as any,
        unchangedIds: ["a.1"],
        updatedIds: [],
        insertedIds: [],
        deletedIds: [],
        srsName: "EPSG:4326",
        ...overrides
    };
}

describe('WFSTFeatureLocksStorage (demo call-shape parity)', () => {

    beforeEach(() => {
        localStorage.clear();
    });

    it('addLock -> getLock round trip, mutating lockItem.id in place', async () => {
        const lockItem = makeLockItem();
        await WFSTFeatureLocksStorage.addLock(lockItem);

        expect(lockItem.id).toBeTruthy(); // addLockToLocalStorage sets this on the same object

        const retrieved = await WFSTFeatureLocksStorage.getLock(lockItem.id);
        expect(retrieved.lockId).toBe("LOCK123");
        expect(retrieved.lockName).toBe("My Lock");
        expect(retrieved.unchangedIds).toEqual(["a.1"]);
    });

    it('getLockPointer() eol matches expiry (EditCurrentLockForm.tsx countdown timer)', async () => {
        const lockItem = makeLockItem({expiry: 10});
        const before = Date.now();
        await WFSTFeatureLocksStorage.addLock(lockItem);
        const after = Date.now();

        const pointer = await WFSTFeatureLocksStorage.getLockPointer(lockItem.id);
        expect(pointer.lockName).toBe("My Lock");
        expect(pointer.eol).toBeGreaterThanOrEqual(before + 10 * 60 * 1000);
        expect(pointer.eol).toBeLessThanOrEqual(after + 10 * 60 * 1000);
    });

    it('query({search, pageSize, pageNumber}) matches ListAvailableWFSTFeatureLocksForm.tsx usage', async () => {
        const first = makeLockItem({lockId: "AAA", lockName: "First lock"});
        const second = makeLockItem({lockId: "BBB", lockName: "Second lock"});
        await WFSTFeatureLocksStorage.addLock(first);
        await WFSTFeatureLocksStorage.addLock(second);

        const all = await WFSTFeatureLocksStorage.query({search: '', pageSize: 100, pageNumber: 0});
        expect(all.total).toBe(2);
        expect(all.matches).toBe(2);
        expect(all.rows.map(r => r.lockId).sort()).toEqual(["AAA", "BBB"]);

        const filtered = await WFSTFeatureLocksStorage.query({search: 'first', pageSize: 100, pageNumber: 0});
        expect(filtered.matches).toBe(1);
        expect(filtered.rows[0].lockId).toBe("AAA");
    });

    it('subscribe fires on add/delete and stops firing after unsubscribe', async () => {
        const observer = vi.fn();
        const unsubscribe = WFSTFeatureLocksStorage.subscribe(observer);

        const lockItem = makeLockItem();
        await WFSTFeatureLocksStorage.addLock(lockItem);
        expect(observer).toHaveBeenCalledTimes(1);

        await WFSTFeatureLocksStorage.deleteLock(lockItem.id);
        expect(observer).toHaveBeenCalledTimes(2);

        unsubscribe();
        const secondLock = makeLockItem({lockId: "CCC"});
        await WFSTFeatureLocksStorage.addLock(secondLock);
        expect(observer).toHaveBeenCalledTimes(2); // unchanged - unsubscribed
    });

    it('deleteLock removes the entry; a subsequent getLock rejects', async () => {
        const lockItem = makeLockItem();
        await WFSTFeatureLocksStorage.addLock(lockItem);

        await WFSTFeatureLocksStorage.deleteLock(lockItem.id);

        await expect(WFSTFeatureLocksStorage.getLock(lockItem.id)).rejects.toBeUndefined();
    });

    it('deleteExpiredLocks removes locks whose eol has passed (backs the background cleanup loop)', async () => {
        const expired = makeLockItem({lockId: "EXPIRED", expiry: -1}); // eol already in the past
        const active = makeLockItem({lockId: "ACTIVE", expiry: 30});
        await WFSTFeatureLocksStorage.addLock(expired);
        await WFSTFeatureLocksStorage.addLock(active);

        await WFSTFeatureLocksStorage.deleteExpiredLocks();

        await expect(WFSTFeatureLocksStorage.getLock(expired.id)).rejects.toBeUndefined();
        const stillActive = await WFSTFeatureLocksStorage.getLock(active.id);
        expect(stillActive.lockId).toBe("ACTIVE");
    });
});
