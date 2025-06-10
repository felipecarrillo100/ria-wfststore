import {uniqueId} from "lodash";
import {WFSTEditFeatureLockItem} from "../../WFSTFeatureStore";

export interface WFSTEditFeatureLockIndexItem {
    id: string;
    eol: number;
    lockName: string;
    lockId: string;
}

type WFSTEditFeatureLockIndexItemMap = {[key:string] : WFSTEditFeatureLockIndexItem};

interface QueryTimeoutsFromLocalStorageResult {
    expired: WFSTEditFeatureLockIndexItem[]
}
interface WFSTEditFeatureLockQueryOptions {
    search: string;
    pageSize: number;
    pageNumber: number;
    order?: "ASC" | "DESC",
    sortBy?: string;
}


const WFSTEditFeatureLockItemIndex = "WFSTEditFeatureLockItemIndex";
const WFSTEditFeatureLockItemPrefix = "WFSTFeatureLock";

type Observer = (extra?:any) => void;

interface QueryResult {
    rows: WFSTEditFeatureLockIndexItem[];
    matches: number;
    total: number;
}

export class WFSTFeatureLocksStorage {
    private static observers: Set<Observer> = new Set();
    private static disableNotifications: boolean = false;

    // Method to subscribe to notifications
    public static subscribe(observer: Observer): () => void {
        this.observers.add(observer);
        // Return an unsubscribe function
        return () => this.unsubscribe(observer);
    }

    // Method to unsubscribe from notifications
    public static unsubscribe(observer: Observer): void {
        this.observers.delete(observer);
    }

    // Method to notify all subscribed observers
    private static notify(extra?:any): void {
        if (WFSTFeatureLocksStorage.disableNotifications) return;
        for (const observer of this.observers) {
            observer(extra);
        }
    }

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

    private static generateID(lockId: string, startTime: number) {
        return uniqueId(`${WFSTEditFeatureLockItemPrefix}-${startTime}-${lockId}-`) as string;
    }

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


    private static getAllLocksFromLocalStorage() {
        const items = localStorage.getItem(WFSTEditFeatureLockItemIndex);
        if (items) {
            return JSON.parse(items) as WFSTEditFeatureLockIndexItemMap;
        } else return {} as WFSTEditFeatureLockIndexItemMap;
    }

    private static updateTable(map: WFSTEditFeatureLockIndexItemMap) {
        const content =  JSON.stringify(map);
        localStorage.setItem(WFSTEditFeatureLockItemIndex, content);
    }

    private static queryByIDFromLocalStorage(id: string) {
        const all = this.getAllLocksFromLocalStorage();
        const rows = Object.keys(all).map(k => all[k]);
        return rows.find(e => e.id === id);
    }
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



function loop(): void {
    setTimeout(() => {
        WFSTFeatureLocksStorage.deleteExpiredLocks();
        loop(); // Recursively call loop to continue the cycle
    }, 60 * 1000); // 5 minutes in milliseconds
}

loop();
