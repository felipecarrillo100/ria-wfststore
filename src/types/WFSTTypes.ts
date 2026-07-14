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
}
