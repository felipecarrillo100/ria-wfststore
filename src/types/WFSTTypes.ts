import {WFSFeatureStoreConstructorOptions} from "@luciad/ria/model/store/WFSFeatureStore";
import {WFSTOperationsKeys} from "../WFSCapabilitiesExtended";

export interface WFSEditedFeature {id: string,  feature: string, onlyProperties?: boolean}

export interface CommitLockTransactionResult {
    success: boolean;
    totalInserted: number;
    totalUpdated: number;
    totalReplaced: number;
    totalDeleted: number;
    totalChanges: number;
}

export interface WFSTEditFeatureLockItem {
    id?: string;
    lockId: string;
    expiry: number;
    lockName: string;
    storeSettings: WFSTFeatureStoreConstructorOptions;
    unchangedIds: string[];
    updatedIds: WFSEditedFeature[];
    insertedIds: WFSEditedFeature[];
    deletedIds: string[];
    srsName: string;
}

export interface WFSTEditGetFeatureWithLockItem extends WFSTEditFeatureLockItem {
    timeStamp: string;
    numberMatched: number;
    numberReturned: number
    rawData?: string;
}

export interface WFSTFeatureStoreConstructorOptions extends WFSFeatureStoreConstructorOptions {
    wfst: WFSTOperationsKeys;
    // true/false forces 3D/2D GML output on writes; omitted (the default for every existing caller)
    // auto-detects per feature from its own geometry - see encodeGeometryToGML.ts's mode3D option.
    mode3D?: boolean;
    // Default true. After a successful add()/put() of a Circle/Arc, re-queries the feature and
    // bounds-checks the decoded result against what was sent - some servers (confirmed against a
    // live LuciadFusion instance) accept the write but silently degrade the geometry into
    // something unreadable on the very next GetFeature. Set to false to skip the extra round trip
    // for a write-only pipeline, or one that doesn't read circular geometry back through RIA.
    verifyCircularGeometryRoundTrip?: boolean;
}
