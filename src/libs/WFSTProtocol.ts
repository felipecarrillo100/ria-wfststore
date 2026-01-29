import { Feature } from "@luciad/ria/model/feature/Feature";
import { create } from "xmlbuilder2";
import { GMLFeatureEncoder } from "./GMLFeatureEncoder";
import { GMLGeometryTypeKey, GMLGeometryTypeToGeometry, WFSFeatureDescription } from "./ParseWFSFeatureDescription";
import { WFSTEditFeatureLockItem } from "../WFSTFeatureStore";

/**
 * Custom error for invalid geometry types in WFS-T operations.
 */
export class WFSTInvalidGeometry extends Error {
    constructor(message: string) {
        super(`Expected geometry: ${message}`);
        this.name = "WFSTInvalidGeometry";
    }
}

/**
 * Interface for WFS-T Add/Update request options.
 */
interface WFSTAddUpdateRequestOptions {
    typeName: string;
    feature: Feature;
    featureDescription: WFSFeatureDescription;
    onlyProperties?: boolean;
    prettyPrint?: boolean;
    invertAxes?: boolean;
}

/**
 * Interface for WFS-T Remove request options.
 */
interface WFSTRemoveRequestOptions {
    typeName: string;
    rid: number | string;
    prettyPrint?: boolean;
}

/**
 * Interface for GetFeatureWithLock options.
 */
interface WFSTGetFeatureWithLockOptions {
    typeName: string;
    rids: string[] | number[];
    expiry?: number;
    prettyPrint?: boolean;
}

/**
 * Interface for CommitLockTransaction options.
 */
interface WFSTCommitLockTransactionOptions {
    lockItem: WFSTEditFeatureLockItem;
    typeName: string;
    featureDescription: WFSFeatureDescription;
    prettyPrint?: boolean;
    invertAxes?: boolean;
}

/**
 * Standardizes WFS-T Protocol generation and parsing.
 * Uses xmlbuilder2 for robust XML creation.
 */
export class WFSTProtocol {

    // --- QUERY GENERATION ---

    /**
     * Generates a GetFeature request by IDs.
     */
    public static createGetFeatureByIdsQuery(options: { typeName: string, rids: string[], outputFormat?: string, prettyPrint?: boolean }) {
        const outputFormat = options.outputFormat || "application/gml+xml; version=3.2";
        const root = create({ version: '1.0', encoding: 'UTF-8' })
            .ele('wfs:GetFeature', {
                'xmlns:xsd': 'http://www.w3.org/2001/XMLSchema',
                'xmlns:wfs': 'http://www.opengis.net/wfs/2.0',
                'xmlns:fes': 'http://www.opengis.net/fes/2.0',
                'xmlns:gml': 'http://www.opengis.net/gml/3.2',
                'service': 'WFS',
                'version': '2.0.0',
                'outputFormat': outputFormat
            });

        const query = root.ele('wfs:Query', { typeNames: options.typeName });
        const filter = query.ele('fes:Filter').ele('fes:Or');

        options.rids.forEach(rid => {
            filter.ele('fes:ResourceId', { rid });
        });

        return root.end({ prettyPrint: options.prettyPrint });
    }

    /**
     * Generates a Transaction Delete request.
     */
    public static createDeleteQuery(options: WFSTRemoveRequestOptions) {
        const root = create({ version: '1.0' })
            .ele('wfs:Transaction', {
                'version': '2.0.0',
                'service': 'WFS',
                'xmlns:fes': 'http://www.opengis.net/fes/2.0',
                'xmlns:wfs': 'http://www.opengis.net/wfs/2.0'
            });

        root.ele('wfs:Delete', { typeName: options.typeName })
            .ele('fes:Filter')
            .ele('fes:ResourceId', { rid: options.rid });

        return root.end({ prettyPrint: options.prettyPrint });
    }

    /**
     * Generates a Transaction Insert request.
     */
    public static createInsertQuery(options: WFSTAddUpdateRequestOptions) {
        const root = create({ version: '1.0' })
            .ele('wfs:Transaction', {
                'xmlns:wfs': 'http://www.opengis.net/wfs/2.0',
                'xmlns:gml': 'http://www.opengis.net/gml/3.2',
                'service': 'WFS',
                'version': '2.0.0'
            });

        this.addInsertBlock(root, options);
        return root.end({ prettyPrint: options.prettyPrint });
    }

    private static addInsertBlock(parent: any, options: WFSTAddUpdateRequestOptions) {
        const targetGeometry = options.featureDescription.geometry.type as GMLGeometryTypeKey;
        const gmlEncoder = new GMLFeatureEncoder({ targetGeometry, gmlVersion: "3.2", invert: options.invertAxes });
        const { geometry, geometryType } = gmlEncoder.encodeFeature(options.feature);

        this.verifyGeometryCompatibilityOrThrowError(geometryType, targetGeometry);

        const split = options.typeName.split(":");
        const typeNameMin = split.length > 1 ? split[1] : split[0];
        const tns = options.featureDescription.tns || (split.length > 1 ? split[0] : null);
        const geometryName = options.featureDescription.geometry.name;

        const insert = parent.ele('wfs:Insert', { handle: 'AddHandle' });
        const featureNode = insert.ele(`tns:${typeNameMin}`, tns ? { 'xmlns:tns': tns } : {});

        featureNode.ele(`tns:${geometryName}`).import(create(geometry));

        for (const key in options.feature.properties) {
            featureNode.ele(`tns:${key}`).txt(options.feature.properties[key]);
        }
    }

    /**
     * Generates a Transaction Update request.
     */
    public static createUpdateQuery(options: WFSTAddUpdateRequestOptions) {
        const root = create({ version: '1.0' })
            .ele('wfs:Transaction', {
                'version': '2.0.0',
                'service': 'WFS',
                'xmlns:fes': 'http://www.opengis.net/fes/2.0',
                'xmlns:gml': 'http://www.opengis.net/gml/3.2',
                'xmlns:wfs': 'http://www.opengis.net/wfs/2.0'
            });

        this.addUpdateBlock(root, options);
        return root.end({ prettyPrint: options.prettyPrint });
    }

    private static addUpdateBlock(parent: any, options: WFSTAddUpdateRequestOptions) {
        const update = parent.ele('wfs:Update', { typeName: options.typeName });

        // Properties
        for (const key in options.feature.properties) {
            const prop = update.ele('wfs:Property');
            prop.ele('wfs:ValueReference').txt(key);
            prop.ele('wfs:Value').txt(options.feature.properties[key]);
        }

        // Geometry
        if (!options.onlyProperties) {
            const targetGeometry = options.featureDescription.geometry.type as GMLGeometryTypeKey;
            const gmlEncoder = new GMLFeatureEncoder({ targetGeometry, gmlVersion: "3.2", invert: options.invertAxes });
            const { geometry, geometryType } = gmlEncoder.encodeFeature(options.feature);
            this.verifyGeometryCompatibilityOrThrowError(geometryType, targetGeometry);

            const geometryName = options.featureDescription.geometry.name;
            const prop = update.ele('wfs:Property');
            prop.ele('wfs:ValueReference').txt(geometryName);
            prop.ele('wfs:Value').import(create(geometry));
        }

        update.ele('fes:Filter').ele('fes:ResourceId', { rid: options.feature.id });
    }

    /**
     * Generates a GetFeatureWithLock request.
     */
    public static createGetFeatureWithLockQuery(options: WFSTGetFeatureWithLockOptions) {
        const expiry = options.expiry !== undefined ? `${options.expiry * 60}` : "300";
        const root = create({ version: '1.0' })
            .ele('wfs:GetFeatureWithLock', {
                'service': 'WFS',
                'version': '2.0.0',
                'xmlns:wfs': 'http://www.opengis.net/wfs/2.0',
                'xmlns:fes': 'http://www.opengis.net/fes/2.0',
                'xmlns:gml': 'http://www.opengis.net/gml/3.2',
                'outputFormat': 'application/gml+xml; version=3.2',
                'expiry': expiry,
                'lockAction': 'ALL'
            });

        const query = root.ele('wfs:Query', { typeNames: options.typeName });
        const filter = query.ele('fes:Filter').ele('fes:Or');
        options.rids.forEach(rid => filter.ele('fes:ResourceId', { rid }));

        return root.end({ prettyPrint: options.prettyPrint });
    }

    /**
     * Generates a LockFeature request.
     */
    public static createLockFeatureQuery(options: WFSTGetFeatureWithLockOptions) {
        const expiry = options.expiry !== undefined ? `${options.expiry * 60}` : "300";
        const root = create({ version: '1.0' })
            .ele('wfs:LockFeature', {
                'service': 'WFS',
                'version': '2.0.0',
                'xmlns:wfs': 'http://www.opengis.net/wfs/2.0',
                'xmlns:fes': 'http://www.opengis.net/fes/2.0',
                'expiry': expiry,
                'lockAction': 'ALL'
            });

        const query = root.ele('wfs:Query', { typeNames: options.typeName });
        const filter = query.ele('fes:Filter').ele('fes:Or');
        options.rids.forEach(rid => filter.ele('fes:ResourceId', { rid }));

        return root.end({ prettyPrint: options.prettyPrint });
    }

    /**
     * Generates a Transaction CommitLock request.
     */
    public static createCommitLockQuery(options: WFSTCommitLockTransactionOptions) {
        const root = create({ version: '1.0' })
            .ele('wfs:Transaction', {
                'version': '2.0.0',
                'lockId': options.lockItem.lockId,
                'service': 'WFS',
                'xmlns:fes': 'http://www.opengis.net/fes/2.0',
                'xmlns:gml': 'http://www.opengis.net/gml/3.2',
                'xmlns:wfs': 'http://www.opengis.net/wfs/2.0'
            });

        options.lockItem.insertedIds.forEach(item => {
            const feature = this.decodeJSONFeatureHelper(item.feature, options.lockItem.srsName);
            this.addInsertBlock(root, { ...options, feature });
        });

        options.lockItem.updatedIds.forEach(item => {
            const feature = this.decodeJSONFeatureHelper(item.feature, options.lockItem.srsName);
            this.addUpdateBlock(root, { ...options, feature, onlyProperties: item.onlyProperties });
        });

        options.lockItem.deletedIds.forEach(id => {
            this.addDeleteBlock(root, { typeName: options.typeName, rid: id });
        });

        return root.end({ prettyPrint: options.prettyPrint });
    }

    private static addDeleteBlock(parent: any, options: { typeName: string, rid: string | number }) {
        parent.ele('wfs:Delete', { typeName: options.typeName })
            .ele('fes:Filter')
            .ele('fes:ResourceId', { rid: options.rid });
    }

    /**
     * Generates a ReleaseLock request.
     */
    public static createReleaseLockQuery(options: { lockId: string, prettyPrint?: boolean }) {
        const root = create({ version: '1.0' })
            .ele('wfs:ReleaseLock', {
                'service': 'WFS',
                'version': '2.0.0',
                'lockId': options.lockId,
                'xmlns:wfs': 'http://www.opengis.net/wfs/2.0'
            });

        return root.end({ prettyPrint: options.prettyPrint });
    }

    // --- RESPONSE PARSING ---

    /**
     * Parses a Transaction response to extract stats, ResourceID, or LockID.
     */
    public static parseTransactionResponse(xmlContent: string) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, "application/xml");

        const getNS = (ns: string, tag: string) => xmlDoc.getElementsByTagNameNS(ns, tag)[0];
        const wfsNS = "http://www.opengis.net/wfs/2.0";
        const fesNS = "http://www.opengis.net/fes/2.0";

        const totalInserted = getNS(wfsNS, "totalInserted")?.textContent || null;
        const totalUpdated = getNS(wfsNS, "totalUpdated")?.textContent || null;
        const totalDeleted = getNS(wfsNS, "totalDeleted")?.textContent || null;
        const totalReplaced = getNS(wfsNS, "totalReplaced")?.textContent || null;
        const resourceId = getNS(fesNS, "ResourceId")?.getAttribute("rid") || null;

        const releaseLockResponse = getNS(wfsNS, "ReleaseLockResponse");
        const lockId = releaseLockResponse?.getAttribute("lockId") || null;

        return { totalInserted, totalUpdated, totalDeleted, totalReplaced, resourceId, lockId };
    }

    /**
     * Parses a GetFeatureWithLock or LockFeature response.
     */
    public static parseLockResponse(xmlContent: string) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, "application/xml");

        const featureCollection = xmlDoc.getElementsByTagName("wfs:FeatureCollection")[0] ||
            xmlDoc.getElementsByTagNameNS("http://www.opengis.net/wfs/2.0", "FeatureCollection")[0];

        const lockFeatureResponse = xmlDoc.getElementsByTagName("wfs:LockFeatureResponse")[0] ||
            xmlDoc.getElementsByTagNameNS("http://www.opengis.net/wfs/2.0", "LockFeatureResponse")[0];

        const target = featureCollection || lockFeatureResponse;

        return {
            lockId: target?.getAttribute("lockId") || null,
            numberMatched: target?.getAttribute("numberMatched") || null,
            numberReturned: target?.getAttribute("numberReturned") || null,
            timeStamp: target?.getAttribute("timeStamp") || null,
        };
    }

    /**
     * Parses a WFS ExceptionReport.
     */
    public static parseExceptionReport(xmlContent: string) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlContent, "application/xml");
        const owsNS = "http://www.opengis.net/ows/1.1";

        const exception = xmlDoc.getElementsByTagNameNS(owsNS, "Exception")[0];
        const exceptionText = xmlDoc.getElementsByTagNameNS(owsNS, "ExceptionText")[0];

        return {
            exceptionCode: exception?.getAttribute("exceptionCode") || null,
            exceptionText: exceptionText?.textContent || null
        };
    }

    // --- UTILS ---

    private static verifyGeometryCompatibilityOrThrowError(geometry: string, targetGeometry: GMLGeometryTypeKey) {
        if (GMLGeometryTypeToGeometry(targetGeometry) === "Geometry") return;
        if (geometry !== GMLGeometryTypeToGeometry(targetGeometry)) throw new WFSTInvalidGeometry(`${targetGeometry}`);
    }

    private static decodeJSONFeatureHelper(jsonFeature: string, srsName: string): Feature {
        return GMLFeatureEncoder.decodeFeatureFromGeoJSON(jsonFeature, srsName);
    }
}
