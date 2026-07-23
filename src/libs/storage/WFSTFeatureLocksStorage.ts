import {uniqueId} from "lodash";
import {WFSTEditFeatureLockItem} from "../../types/WFSTTypes";

/** A lightweight pointer to a persisted {@link WFSTEditFeatureLockItem} - enough to list/search locks without loading each one's full (potentially large) content. */
export interface WFSTEditFeatureLockIndexItem {
    id: string;
    eol: number;
    lockName: string;
    lockId: string;
}

/** The persisted index mapping every stored lock's id to its {@link WFSTEditFeatureLockIndexItem} pointer. */
type WFSTEditFeatureLockIndexItemMap = {[key:string] : WFSTEditFeatureLockIndexItem};

/** Result of {@link WFSTFeatureLocksStorage.queryTimeouts}. */
interface QueryTimeoutsFromLocalStorageResult {
    expired: WFSTEditFeatureLockIndexItem[]
}
/** Options for {@link WFSTFeatureLocksStorage.query}. */
interface WFSTEditFeatureLockQueryOptions {
    search: string;
    pageSize: number;
    pageNumber: number;
    order?: "ASC" | "DESC",
    sortBy?: string;
}


/** `localStorage` key under which the {@link WFSTEditFeatureLockIndexItemMap} index is stored. */
const WFSTEditFeatureLockItemIndex = "WFSTEditFeatureLockItemIndex";
/** Prefix used when generating a new lock's storage id - see {@link WFSTFeatureLocksStorage.generateID}. */
const WFSTEditFeatureLockItemPrefix = "WFSTFeatureLock";

/** A change-notification callback registered via {@link WFSTFeatureLocksStorage.subscribe}. */
type Observer = (extra?:any) => void;

/** Result of {@link WFSTFeatureLocksStorage.query}. */
interface QueryResult {
    rows: WFSTEditFeatureLockIndexItem[];
    matches: number;
    total: number;
}

/**
 * Persists {@link WFSTEditFeatureLockItem}s (the pending-edit state behind a
 * {@link WFSTFeatureLockStore}) in the browser's `localStorage`, so an in-progress lock survives
 * page reloads, plus an index for listing/searching active locks and a background loop for
 * cleaning up expired ones.
 *
 * All members are static - this class is a namespaced singleton, not something to instantiate.
 *
 * Side effect on import: {@link startExpiredLocksLoop} is called once at the bottom of this
 * module, starting a recurring `setTimeout` loop that deletes expired locks automatically for the
 * lifetime of the page. Call {@link stopExpiredLocksLoop} to stop it (mainly useful for tests
 * controlling the cadence explicitly rather than a real background interval).
 */
export class WFSTFeatureLocksStorage {
    /** Registered change-notification callbacks - see {@link subscribe}/{@link unsubscribe}/{@link notify}. */
    private static observers: Set<Observer> = new Set();
    /** Temporarily suppresses {@link notify} while {@link deleteExpiredLocks} deletes several locks in a batch, so subscribers get one notification instead of one per lock. */
    private static disableNotifications: boolean = false;
    /** Handle for the recurring expired-locks cleanup timer - see {@link startExpiredLocksLoop}/{@link stopExpiredLocksLoop}. */
    private static expiredLocksTimer: ReturnType<typeof setTimeout> | null = null;

    // Started automatically at the bottom of this file so existing consumers see no behavior
    // change. Exposed as start/stop so tests can control the cadence explicitly instead of a
    // real background interval running for the lifetime of the test process.
    /**
     * Starts (if not already running) a recurring loop that calls {@link deleteExpiredLocks}
     * every `intervalMs`. Called automatically once when this module is first imported, so
     * consumers don't need to call this themselves under normal use.
     *
     * @param intervalMs how often to check for expired locks, in milliseconds (default 1 minute).
     */
    public static startExpiredLocksLoop(intervalMs: number = 60 * 1000): void {
        if (this.expiredLocksTimer !== null) return; // already running
        this.expiredLocksTimer = setTimeout(() => {
            this.expiredLocksTimer = null;
            WFSTFeatureLocksStorage.deleteExpiredLocks();
            this.startExpiredLocksLoop(intervalMs);
        }, intervalMs);
    }

    /** Stops the recurring expired-locks cleanup loop started by {@link startExpiredLocksLoop}, if running. */
    public static stopExpiredLocksLoop(): void {
        if (this.expiredLocksTimer !== null) {
            clearTimeout(this.expiredLocksTimer);
            this.expiredLocksTimer = null;
        }
    }

    // Method to subscribe to notifications
    /**
     * Subscribes to change notifications (fired after {@link addLock}/{@link replaceLock}/
     * {@link deleteLock}/{@link deleteExpiredLocks}) - e.g. to refresh a "list of active locks" UI.
     *
     * @param observer called with no argument for most changes, or the affected
     *                 {@link WFSTEditFeatureLockItem} for {@link replaceLock}.
     * @returns a function that unsubscribes `observer` (equivalent to calling {@link unsubscribe}).
     */
    public static subscribe(observer: Observer): () => void {
        this.observers.add(observer);
        // Return an unsubscribe function
        return () => this.unsubscribe(observer);
    }

    // Method to unsubscribe from notifications
    /** Unsubscribes a previously-{@link subscribe}d observer. */
    public static unsubscribe(observer: Observer): void {
        this.observers.delete(observer);
    }

    // Method to notify all subscribed observers
    /** Calls every subscribed observer with `extra`, unless {@link disableNotifications} is set (used to batch multiple deletes in {@link deleteExpiredLocks} into one notification). */
    private static notify(extra?:any): void {
        if (WFSTFeatureLocksStorage.disableNotifications) return;
        for (const observer of this.observers) {
            observer(extra);
        }
    }

    /**
     * @param id a lock's storage id (see {@link WFSTEditFeatureLockItem.id}).
     * @returns a Promise resolving to the full persisted lock item, or rejecting if no lock with
     *          that id exists.
     */
    public static getLock(id: string) {
        return new Promise<WFSTEditFeatureLockItem>((resolve, reject)=>{
            const item = this.getLockFromLocalStorage(id);
            if (item) {
                resolve(item);
            } else {
                reject();
            }
        })
    }

    /**
     * Like {@link getLock}, but returns only the lightweight index pointer, not the full lock
     * content - cheaper when only the pointer (e.g. `eol`, `lockName`) is needed.
     *
     * @param id a lock's storage id.
     * @returns a Promise resolving to the index pointer, or rejecting if no lock with that id
     *          exists.
     */
    public static getLockPointer(id: string) {
        return new Promise<WFSTEditFeatureLockIndexItem>((resolve, reject)=>{
            const item = this.queryByIDFromLocalStorage(id);
            if (item) {
                resolve(item);
            } else {
                reject();
            }
        })
    }

    /**
     * Searches persisted locks by `lockName`/`lockId` substring match, with pagination.
     *
     * @param query search text, page size/number, and (currently unused) sort options.
     * @returns a Promise resolving to the matching page of index pointers, plus match/total counts.
     */
    public static query(query: WFSTEditFeatureLockQueryOptions) {
        return new Promise<QueryResult>((resolve, reject)=>{
            const items = this.queryLockFromLocalStorage(query);
            if (items) {
                resolve(items);
            } else {
                reject();
            }
        })
    }

    /** @returns a Promise resolving to every persisted lock whose `eol` (end-of-life) has already passed. */
    public static queryTimeouts() {
        return new Promise<QueryTimeoutsFromLocalStorageResult>((resolve, reject)=>{
            const items = this.queryTimeoutsFromLocalStorage();
            if (items) {
                resolve(items);
            } else {
                reject();
            }
        })
    }

    /**
     * Persists a brand-new lock, assigning it a fresh storage id (see
     * {@link generateID}, written into `lockItem.id`) and adding it to the index.
     *
     * @param lockItem the lock to persist (mutated in place: `id` is assigned).
     * @returns a Promise resolving to the assigned id, or rejecting if persisting failed.
     */
    public static addLock(lockItem: WFSTEditFeatureLockItem) {
        return new Promise((resolve, reject)=>{
            const id = this.addLockToLocalStorage(lockItem);
            if (id) {
                this.disableNotifications = false;
                this.notify();
                resolve(id);
            } else reject();
        })
    }

    /**
     * Overwrites an already-persisted lock's content in place (`lockItem.id` must already exist
     * in the index) - called after every local edit in {@link WFSTFeatureLockStore} so the
     * persisted state always matches the in-memory working copy.
     *
     * @param lockItem the lock's new content.
     * @returns a Promise resolving to the lock's id, or rejecting if `lockItem.id` isn't a known
     *          persisted lock.
     */
    static replaceLock(lockItem: WFSTEditFeatureLockItem) {
        return new Promise((resolve, reject)=>{
            const id = this.replaceLockToLocalStorage(lockItem);
            if (id) {
                this.disableNotifications = false;
                this.notify(lockItem);
                resolve(id);
            } else reject();
        })
    }

    /**
     * Permanently removes a persisted lock and its index entry.
     *
     * @param id the lock's storage id.
     * @returns a Promise resolving to true, or rejecting if no lock with that id exists.
     */
    public static deleteLock(id: string) {
        return new Promise((resolve, reject)=>{
            const removed  = this.deleteLockFromLocalStorage(id);
            if (removed) {
                this.notify();
                resolve(true);
            } else {
                reject();
            }
        })
    }

    /** @returns the full persisted lock for `id`, or null if the index has no pointer for it. */
    private static getLockFromLocalStorage(id: string) {
        // Update pointer
        const locks = this.getAllLocksFromLocalStorage();
        const pointerToItem = locks[id];
        if (pointerToItem) {
            const id = pointerToItem.id;
            const item = localStorage.getItem(id);
            return JSON.parse(item) as WFSTEditFeatureLockItem;
        } else {
            return null;
        }
    }

    /** @returns a fresh, unique storage id for a new lock, derived from its server-issued `lockId` and the current time. */
    private static generateID(lockId: string, startTime: number) {
        return uniqueId(`${WFSTEditFeatureLockItemPrefix}-${startTime}-${lockId}-`) as string;
    }

    /**
     * Writes a brand-new lock's full content to `localStorage` and adds its pointer to the index,
     * computing its end-of-life from `lockItem.expiry` (minutes) from now.
     *
     * @param lockItem the lock to persist (mutated in place: `id` is assigned).
     * @returns the assigned id, or null if that id (extremely unlikely, given {@link generateID})
     *          already exists in the index.
     */
    private static addLockToLocalStorage(lockItem: WFSTEditFeatureLockItem) {
        const startTime = Date.now();
        const id = this.generateID(lockItem.lockId, startTime);
        lockItem.id = id;

        // Add to LocalStorage
        localStorage.setItem(id, JSON.stringify(lockItem));

        // Update pointer
        const locks = this.getAllLocksFromLocalStorage();
        if (locks[id]) {
            return null;
        }

        // Set an end of life
        const endTime = startTime + lockItem.expiry * 60 * 1000;
        locks[id] = {id, eol: endTime, lockName: lockItem.lockName, lockId: lockItem.lockId};

        this.updateTable(locks);
        return id;
    }

    /**
     * Overwrites an already-indexed lock's content in `localStorage` (index pointer itself is
     * unchanged - only the full content is rewritten).
     *
     * @param lockItem the lock's new content (`id` must already be in the index).
     * @returns the lock's id, or null if it isn't in the index.
     */
    private static replaceLockToLocalStorage(lockItem: WFSTEditFeatureLockItem) {
        const id = lockItem.id;
        // Find pointer pointer
        const locks = this.getAllLocksFromLocalStorage();
        if (typeof locks[id] !== "undefined") {
            // Add to LocalStorage
            localStorage.setItem(id, JSON.stringify(lockItem));
            return id;
        }
        return null;
    }

    /**
     * Removes a lock's content and index entry from `localStorage`.
     *
     * @param id the lock's storage id.
     * @returns true if a lock with that id existed and was removed, false otherwise.
     */
    private static deleteLockFromLocalStorage(id:string): boolean {
        // Update pointer
        const locks = this.getAllLocksFromLocalStorage();
        const pointerToItem = locks[id];
        if (pointerToItem) {
            delete locks[id];
            this.updateTable(locks);
            localStorage.removeItem(pointerToItem.id);
            return true;
        } else {
            return false;
        }
    }


    /** @returns the full lock index, or an empty map if nothing has been persisted yet. */
    private static getAllLocksFromLocalStorage() {
        const items = localStorage.getItem(WFSTEditFeatureLockItemIndex);
        if (items) {
            return JSON.parse(items) as WFSTEditFeatureLockIndexItemMap;
        } else return {} as WFSTEditFeatureLockIndexItemMap;
    }

    /** Persists the full lock index, replacing whatever was there before. */
    private static updateTable(map: WFSTEditFeatureLockIndexItemMap) {
        const content =  JSON.stringify(map);
        localStorage.setItem(WFSTEditFeatureLockItemIndex, content);
    }

    /** @returns the index pointer for `id`, or undefined if not found. */
    private static queryByIDFromLocalStorage(id: string) {
        const all = this.getAllLocksFromLocalStorage();
        const rows = Object.keys(all).map(k => all[k]);
        return rows.find(e => e.id === id);
    }
    /** @returns a case-insensitive `lockName`/`lockId` substring search over every persisted lock's index pointer, paginated per `query`. */
    private static queryLockFromLocalStorage(query: WFSTEditFeatureLockQueryOptions) {
        const all = this.getAllLocksFromLocalStorage();
        const rows = Object.keys(all).map(k => all[k]);
        const matches = rows.filter(r=>
            r.lockName.toLowerCase().indexOf(query.search.toLowerCase())!==-1 ||
            r.lockId.toLowerCase().indexOf(query.search.toLowerCase())!==-1
        );
        const pageNumber = Number(query.pageNumber);
        const pageSize = Number(query.pageSize);
        const paginated = matches.sort((a,b)=>a>b?1:a<b?-1:0).slice(pageNumber * pageSize, (pageNumber+1) * pageSize);
        return {
            rows: paginated,
            matches: matches.length,
            total: rows.length
        };
    }

    /** @returns every persisted lock's index pointer whose `eol` has already passed. */
    private static queryTimeoutsFromLocalStorage(): QueryTimeoutsFromLocalStorageResult {
        const all = this.getAllLocksFromLocalStorage();
        const rows = Object.keys(all).map(k => all[k]);
        const currentTime = Date.now();
        const matches = rows.filter(r=>
            r.eol < currentTime
        );
        return {
            expired: matches,
        };
    }

    /**
     * Finds and deletes every currently-expired lock (per {@link queryTimeouts}), notifying
     * subscribers at most once for the whole batch rather than once per deleted lock. Called
     * automatically by the loop {@link startExpiredLocksLoop} starts, but callable directly too.
     */
    static async deleteExpiredLocks() {
        // Your code to delete expired items
        let notify = false;
        try {
            const results = await WFSTFeatureLocksStorage.queryTimeouts();
            const expiredIds = results.expired.map(elem => elem.id);

            this.disableNotifications = true;

            for (const id of expiredIds) {
                await WFSTFeatureLocksStorage.deleteLock(id);
                notify = true;
            }
        } catch (error) {
            console.error("Error deleting expired locks:", error);
        }
        this.disableNotifications = false;
        if (notify) this.notify();
    }
}



WFSTFeatureLocksStorage.startExpiredLocksLoop();
