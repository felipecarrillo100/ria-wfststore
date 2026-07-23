import {WFSFeatureStoreConstructorOptions} from "@luciad/ria/model/store/WFSFeatureStore";
import {WFSTOperationsKeys} from "../WFSCapabilitiesExtended";

/** One feature's pending, not-yet-committed content in a {@link WFSTEditFeatureLockItem} - see {@link WFSTFeatureLockStore.encodePendingFeature}. */
export interface WFSEditedFeature {
    /** The feature's id. */
    id: string,
    /** The feature's serialized content (GML or GeoJSON, depending on the lock's own output format). */
    feature: string,
    /** True if only this feature's properties changed (not its geometry) - see {@link WFSTFeatureStore.putProperties}. */
    onlyProperties?: boolean
}

/** Summary of how many features were affected by a {@link WFSTFeatureStore.commitLockTransaction} call. */
export interface CommitLockTransactionResult {
    /** True once the transaction request completed and its response was parsed. */
    success: boolean;
    /** Number of features inserted by this transaction. */
    totalInserted: number;
    /** Number of features updated by this transaction. */
    totalUpdated: number;
    /** Number of features replaced by this transaction (an update where the feature id also changed). */
    totalReplaced: number;
    /** Number of features deleted by this transaction. */
    totalDeleted: number;
    /** `totalInserted + totalUpdated + totalReplaced + totalDeleted`. */
    totalChanges: number;
}

/**
 * A lock on a set of features, together with every edit accumulated against it so far - the
 * shape a {@link WFSTFeatureLockStore} is constructed from and persists via
 * `WFSTFeatureLocksStorage`, and what {@link WFSTFeatureStore.commitLockTransaction} eventually
 * sends as one combined WFS-T transaction.
 */
export interface WFSTEditFeatureLockItem {
    /** This lock's own id (assigned by `WFSTFeatureLocksStorage` once persisted; absent on a lock that hasn't been stored yet). */
    id?: string;
    /** The server-issued WFS-T lock id, as returned by {@link WFSTFeatureStore.lockFeatures}/{@link WFSTFeatureStore.getFeatureWithLock}. */
    lockId: string;
    /** How long (in minutes) the server-side lock is valid for. */
    expiry: number;
    /** A display name for this lock, for UIs listing active locks. */
    lockName: string;
    /** The originating store's construction options (minus its `codec`/`reference`, see `WFSTFeatureStore.cleanOptions`) - used to rebuild a compatible {@link WFSTFeatureLockStore} later. */
    storeSettings: WFSTFeatureStoreConstructorOptions;
    /** Ids of locked features that haven't been edited yet. */
    unchangedIds: string[];
    /** Locked features with pending property/geometry updates - see {@link WFSEditedFeature}. */
    updatedIds: WFSEditedFeature[];
    /** Locked features newly inserted while editing (not yet committed) - see {@link WFSEditedFeature}. */
    insertedIds: WFSEditedFeature[];
    /** Ids of locked features marked for deletion once committed. */
    deletedIds: string[];
    /** The CRS identifier features in this lock are encoded in. */
    srsName: string;
}

/** The result of {@link WFSTFeatureStore.getFeatureWithLock} - a {@link WFSTEditFeatureLockItem} plus the query metadata from the underlying `GetFeatureWithLock` response. */
export interface WFSTEditGetFeatureWithLockItem extends WFSTEditFeatureLockItem {
    /** The server's response timestamp. */
    timeStamp: string;
    /** Total number of features matching the lock request (may exceed `numberReturned` if the server paginates). */
    numberMatched: number;
    /** Number of features actually returned in this response. */
    numberReturned: number
    /** The raw response body, if retained (currently unused - not populated by {@link WFSTFeatureStore.getFeatureWithLock}). */
    rawData?: string;
}

/** Constructor options for {@link WFSTFeatureStore}, extending RIA's own `WFSFeatureStoreConstructorOptions` with WFS-T-specific settings. */
export interface WFSTFeatureStoreConstructorOptions extends WFSFeatureStoreConstructorOptions {
    /** The WFS-T operations this store's service advertises (from {@link WFSCapabilitiesExtended.getWFSTCapabilities}) - determines {@link WFSTFeatureStore.wfstCapable}. */
    wfst: WFSTOperationsKeys;
    /**
     * `true`/`false` forces 3D/2D GML output on writes; omitted (the default for every existing
     * caller) auto-detects per feature from its own geometry - see `encodeGeometryToGML.ts`'s
     * `mode3D` option.
     */
    mode3D?: boolean;
    /**
     * Default true. After a successful {@link WFSTFeatureStore.add}/{@link WFSTFeatureStore.put}
     * of a Circle/Arc, re-queries the feature and bounds-checks the decoded result against what
     * was sent - some servers (confirmed against a live LuciadFusion instance) accept the write
     * but silently degrade the geometry into something unreadable on the very next `GetFeature`.
     * Set to false to skip the extra round trip for a write-only pipeline, or one that doesn't
     * read circular geometry back through RIA.
     */
    verifyCircularGeometryRoundTrip?: boolean;
}
