import {
    WFSFeatureStore,
    WFSFeatureStoreConstructorOptions, WFSFeatureStoreCreateOptions, WFSQueryOptions,
} from "@luciad/ria/model/store/WFSFeatureStore";
import { Feature, FeatureId } from "@luciad/ria/model/feature/Feature";
import { Handle } from "@luciad/ria/util/Evented";
import { EventedSupport } from "@luciad/ria/util/EventedSupport";
import { areCompatibleGeometries, parseWFSFeatureDescription, standardizeProperties, WFSFeatureDescription } from "./libs/ParseWFSFeatureDescription";
import { HttpRequestHeaders } from "@luciad/ria/util/HttpRequestOptions";
import { WFSTProtocol } from "./libs/WFSTProtocol";
import { WFSVersion } from "@luciad/ria/ogc/WFSVersion";
import { CoordinateReference } from "@luciad/ria/reference/CoordinateReference";
import { Cursor } from "@luciad/ria/model/Cursor";
import { GMLFeatureEncoder } from "./libs/GMLFeatureEncoder";
import { WFSCapabilitiesExtended, WFSCapabilitiesExtendedResult, WFSTOperationsKeys } from "./WFSCapabilitiesExtended";
import { WFSTDelegateScreenHelper } from "./libs/screen/WFSTDelegateScreenHelper";
import { ProgrammingError } from "@luciad/ria/error/ProgrammingError";
import { getReference, isValidReferenceIdentifier, parseWellKnownText } from "@luciad/ria/reference/ReferenceProvider";
import { WFSCapabilitiesFeatureType } from "@luciad/ria/model/capabilities/WFSCapabilitiesFeatureType";
import { createTransformation } from "@luciad/ria/transformation/TransformationFactory";
import { WFSCapabilitiesFromUrlOptions } from "@luciad/ria/model/capabilities/WFSCapabilities";
import { QueryOptions } from "@luciad/ria/model/store/Store";
import { WFSTService } from "./libs/WFSTService";
import { WFSTErrorHandler } from "./libs/WFSTErrorHandler";

export interface WFSEditedFeature { id: string, feature: string, onlyProperties?: boolean }

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
    postServiceURL?: string;
}

interface FetchSettingsOptions {
    method?: string;
    body?: BodyInit | null;
    headers?: HttpRequestHeaders;
}

export class WFSTFeatureStore extends WFSFeatureStore {
    private _wfst: WFSTOperationsKeys;
    private featureTemplate: WFSFeatureDescription;
    private options: WFSTFeatureStoreConstructorOptions;
    private version: WFSVersion;
    private delegateScreen: WFSTDelegateScreenHelper;
    private invertAxes: boolean;
    private service: WFSTService;
    private errorHandler: WFSTErrorHandler;

    constructor(options: WFSTFeatureStoreConstructorOptions) {
        super(options);
        this.options = options;
        this._wfst = options.wfst;
        this.setFeatureTemplate(null);
        this.version = options.versions && options.versions.length > 0 ? options.versions[0] : WFSVersion.V200;
        this.delegateScreen = new WFSTDelegateScreenHelper();
        this.invertAxes = !!options.swapAxes;

        this.service = new WFSTService({
            serviceURL: options.postServiceURL || options.serviceURL,
            requestHeaders: options.requestHeaders,
            credentials: !!options.credentials
        });
        this.errorHandler = new WFSTErrorHandler(this.delegateScreen);
    }

    public wfstCapable(): boolean {
        return !!(this._wfst && this._wfst.Transaction);
    }

    public static async createFromURL_WFST(url, typeName: string, options?: WFSFeatureStoreCreateOptions & WFSCapabilitiesFromUrlOptions) {
        const s = await WFSCapabilitiesExtended.fromURL(url, options);
        return WFSTFeatureStore.createFromCapabilities_WFST(s, typeName, options);
    }

    public static createFromCapabilities_WFST(extended: WFSCapabilitiesExtendedResult, typeName: string, options: WFSFeatureStoreCreateOptions = {}) {
        const e = extended.wfsCapabilities;
        const wfst = extended.wfstCapabilities.WFSTOperations;
        const match = e.featureTypes.filter((e => e.name === typeName))[0];
        if (typeof match === "undefined") throw new ProgrammingError(`there is no feature type "${typeName}" in capabilities`);
        const { reference: i, srsName: o } = getReferenceForWFS(match, options.reference);
        const n = e.operations.filter((e => "GetFeature" === e.name))[0].supportedRequests;
        let a = "";
        let u = "";
        const c = [];
        n.forEach((e => {
            const r = processServiceUrl(e.url);
            if ("GET" === e.method) a = r; else if ("POST" === e.method) u = r;
            c.push(e.method)
        }));
        if (typeof options.serviceURL === "string") {
            a = options.serviceURL;
            u = options.serviceURL
        } else if (options.serviceURL) {
            if (typeof options.serviceURL.GET === "string") a = options.serviceURL.GET;
            if (typeof options.serviceURL.POST === "string") u = options.serviceURL.POST
        }
        const p = options.versions || [e.version];
        const f = options.outputFormat || getOutputFormat(p, match.outputFormats);
        const m = {
            typeName: match.name,
            serviceURL: a,
            postServiceURL: u,
            reference: i,
            srsName: o,
            codec: options.codec,
            outputFormat: f,
            versions: p,
            methods: mergeRequestMethods(c, options.methods),
            credentials: options.credentials,
            requestHeaders: options.requestHeaders,
            swapAxes: options.swapAxes,
            geometryName: options.geometryName,
            requestParameters: options.requestParameters,
            bounds: getModelBoundsFromCapabilities(match, i)
        };
        return new WFSTFeatureStore({ ...m, wfst })
    }


    putProperties(feature: Feature): Promise<FeatureId> {
        return new Promise<FeatureId>((resolve) => {
            const editFeature = () => {
                const frozenFeature = new Feature(feature.shape, feature.properties, feature.id);

                const { typeName, eventSupport } = this.extractUtils();
                let postData = "";
                try {
                    postData = WFSTProtocol.createUpdateQuery({ typeName, feature: frozenFeature, featureDescription: this.featureTemplate, onlyProperties: true });
                } catch (error) {
                    this.errorHandler.handleError(error, resolve);
                    return;
                }
                this.service.transaction(postData).then(xmlText => {
                    const { totalUpdated, resourceId } = WFSTProtocol.parseTransactionResponse(xmlText);
                    if (Number(totalUpdated) === 0) {
                        this.delegateScreen.MessageWarning(`[WFS-T] Total updated: ${totalUpdated}`);
                        resolve(null);
                    } else {
                        if (frozenFeature.id !== resourceId) console.warn(`Invalid ID response to put. Expected: ${frozenFeature.id} but got ${resourceId}`);
                        eventSupport.emit("StoreChanged", "update", frozenFeature, frozenFeature.id);
                        resolve(feature.id);
                        this.delegateScreen.MessageSuccess(`[WFS-T] Total updated: ${totalUpdated}`);
                    }
                }).catch(error => this.errorHandler.handleError(error, resolve));
            }
            // If feature template not available then load it!
            if (this.featureTemplate) {
                editFeature();
            } else {
                this.loadFeatureDescription().then(featureTemplate => {
                    if (featureTemplate) editFeature();
                })
            }
        })
    }
    put(feature: Feature, options?: any): Promise<FeatureId> {
        return new Promise<FeatureId>((resolve) => {
            this.delegateScreen.confirmGeometryUpdate(() => {
                const editFeature = () => {
                    const frozenFeature = new Feature(feature.shape, feature.properties, feature.id);

                    const { typeName, eventSupport } = this.extractUtils();
                    let postData = "";
                    try {
                        postData = WFSTProtocol.createUpdateQuery({ typeName, feature: frozenFeature, featureDescription: this.featureTemplate, invertAxes: this.invertAxes });
                    } catch (error) {
                        this.errorHandler.handleError(error, resolve);
                        return;
                    }
                    this.service.transaction(postData).then(xmlText => {
                        const { totalUpdated, resourceId } = WFSTProtocol.parseTransactionResponse(xmlText);
                        if (Number(totalUpdated) === 0) {
                            this.delegateScreen.MessageWarning(`[WFS-T] Total updated: ${totalUpdated}`);
                            resolve(null);
                        } else {
                            if (frozenFeature.id !== resourceId) console.warn(`Invalid ID response to put. Expected: ${frozenFeature.id} but got ${resourceId}`);
                            eventSupport.emit("StoreChanged", "update", frozenFeature, frozenFeature.id);
                            resolve(feature.id);
                            this.delegateScreen.MessageSuccess(`[WFS-T] Total updated: ${totalUpdated}`);
                        }
                    }).catch(error => this.errorHandler.handleError(error, resolve));
                }
                // If feature template not available then load it!
                if (this.featureTemplate) {
                    editFeature();
                } else {
                    this.loadFeatureDescription().then(featureTemplate => {
                        if (featureTemplate) editFeature();
                    })
                }
            },
                () => {
                    resolve(null);
                })
        })
    }

    add(feature: Feature, options?: any): Promise<FeatureId> {
        return new Promise<FeatureId>((resolve) => {
            const { typeName, eventSupport } = this.extractUtils();
            const addFeature = () => {
                const { newFeature, validProperties } = standardizeProperties(this.featureTemplate, feature);
                const { geometryType } = GMLFeatureEncoder.encodeFeatureToGeoJSON(feature);

                const template = this.getFeatureTemplate();
                const isCompatibleGeometry = areCompatibleGeometries(geometryType as any, template.geometry.type);
                if (!isCompatibleGeometry) {
                    this.delegateScreen.MessageError(`[WFS-T] Error: Incompatible geometry. Expects ${template.geometry.type}`);
                    resolve(null);
                    return;
                }
                if (!validProperties) {
                    this.delegateScreen.EditNewFeatureProperties(newFeature, this);
                    resolve(null);
                    return;
                }
                let postData = "";
                try {
                    postData = WFSTProtocol.createInsertQuery({ typeName, feature: newFeature, featureDescription: this.featureTemplate, invertAxes: this.invertAxes });
                } catch (error) {
                    this.errorHandler.handleError(error, resolve);
                    return;
                }
                this.service.transaction(postData).then(xmlText => {
                    const { resourceId, totalInserted } = WFSTProtocol.parseTransactionResponse(xmlText);
                    if (Number(totalInserted) === 0) {
                        this.delegateScreen.MessageWarning(`[WFS-T] Total inserted: ${totalInserted}`);
                        resolve(null);
                    } else {
                        newFeature.id = resourceId;
                        eventSupport.emit("StoreChanged", "add", newFeature, resourceId);
                        resolve(resourceId)
                        this.delegateScreen.MessageSuccess(`[WFS-T] Total inserted: ${totalInserted}`);
                    }
                }).catch(error => {
                    if (error instanceof Response && error.status === 400) {
                        this.errorHandler.handleError(error, resolve);
                        this.delegateScreen.EditNewFeatureProperties(newFeature, this);
                    } else {
                        this.errorHandler.handleError(error, resolve);
                    }
                });
            }
            // If feature template not available then load it!
            if (this.featureTemplate) {
                addFeature();
            } else {
                this.loadFeatureDescription().then(featureTemplate => {
                    if (featureTemplate) addFeature();
                })
            }
        })
    }

    query(query?: WFSQueryOptions, options?: QueryOptions): Promise<Cursor<Feature>> {
        return super.query(query, options);
    }

    // Get method
    get(id: string | number, options: any): Promise<Feature> {
        return new Promise<Feature>((resolve, reject) => {
            this.queryByRids([id as string]).then((cursor: Cursor<Feature>) => {
                if (cursor.hasNext()) {
                    resolve(cursor.next());
                } else {
                    reject();
                }
            }).catch(reject)
        })
    }

    queryByRids(rids: string[]): Promise<Cursor<Feature>> {
        return new Promise<Cursor<Feature>>((resolve) => {
            const { typeName } = this.extractUtils();
            this.service.getFeaturesById(typeName, rids, this.options.outputFormat).then(textXml => {
                try {
                    const cursor = this.options.codec.decode({ content: textXml });
                    resolve(cursor);
                } catch (err) {
                    resolve(null);
                }
            }).catch(error => this.errorHandler.handleError(error, resolve));
        })
    }

    public remove(rid: string | number): Promise<boolean> {
        return new Promise<boolean>((resolve) => {
            const { typeName, eventSupport } = this.extractUtils();

            const postData = WFSTProtocol.createDeleteQuery({ typeName, rid });

            this.service.transaction(postData).then(textXml => {
                const { totalDeleted } = WFSTProtocol.parseTransactionResponse(textXml);
                eventSupport.emit("StoreChanged", "remove", undefined, rid);
                resolve(true);
                this.delegateScreen.MessageSuccess(`[WFS-T] Total deleted: ${totalDeleted}`);
            }).catch(error => this.errorHandler.handleError(error, resolve));
        })
    }

    public commitLockTransaction(lockItem: WFSTEditFeatureLockItem) {
        return new Promise<CommitLockTransactionResult>((resolve) => {
            const { typeName } = this.extractUtils();

            const postData = WFSTProtocol.createCommitLockQuery({
                typeName,
                lockItem, featureDescription:
                    this.featureTemplate,
                invertAxes: this.invertAxes
            });

            this.service.transaction(postData).then(xmlText => {
                const { totalInserted, totalUpdated, totalDeleted, totalReplaced } = WFSTProtocol.parseTransactionResponse(xmlText);
                const message = [];
                const result: CommitLockTransactionResult = {
                    success: true,
                    totalInserted: 0,
                    totalUpdated: 0,
                    totalDeleted: 0,
                    totalReplaced: 0,
                    totalChanges: 0,
                }
                if (totalInserted) {
                    message.push(`Total inserted: ${totalInserted}.`);
                    result.totalInserted = Number(totalInserted);
                }
                if (totalUpdated) {
                    message.push(`Total updated: ${totalUpdated}.`);
                    result.totalUpdated = Number(totalUpdated);
                }
                if (totalReplaced) {
                    message.push(`Total replaced: ${totalReplaced}.`);
                    result.totalReplaced = Number(totalReplaced);
                }
                if (totalDeleted) {
                    message.push(`Total deleted: ${totalDeleted}.`);
                    result.totalDeleted = Number(totalDeleted);
                }
                result.totalChanges = result.totalReplaced + result.totalInserted + result.totalDeleted + result.totalUpdated;
                const toastMessage = this.delegateScreen.createToastList("[WFS-T]", message);
                this.delegateScreen.MessageInfo(toastMessage as any);
                resolve(result);
            }).catch(error => this.errorHandler.handleError(error, resolve));
        })
    }

    loadFeatureDescription() {
        return new Promise<WFSFeatureDescription>((resolve) => {
            const { typeName, preferredVersion } = this.extractUtils();
            this.service.describeFeatureType(typeName, preferredVersion).then(xmlText => {
                const featureTemplate = parseWFSFeatureDescription(xmlText);
                this.setFeatureTemplate(featureTemplate);
                resolve(featureTemplate);
            }).catch(error => this.errorHandler.handleError(error, resolve));
        })
    }

    on(event: "StoreChanged", callback: any): Handle {
        return super.on(event, callback);
    }

    private extractUtils() {
        const self = (this as any);
        return {
            typeName: self._typeName[0] as string,
            urlEndpoint: self._requestBuilder._postServiceURL as string,
            outputFormat: self._outputFormat as string,
            preferredVersion: self._requestBuilder._preferredVersion as string,
            eventSupport: self._eventSupport as EventedSupport,
            swapAxes: self.options.swapAxes,
            swapQueryAxes: self.options.swapQueryAxes,
            reference: self._reference as CoordinateReference
        };
    }

    // Setters and getters
    get wfst(): WFSTOperationsKeys {
        return this._wfst;
    }

    // Removed fetchSettingsOptions as logic moved to WFSTService

    getFeatureTemplate() {
        return this.featureTemplate;
    }

    private setFeatureTemplate(featureTemplate: WFSFeatureDescription) {
        this.featureTemplate = featureTemplate;
    }

    getTypeName() {
        const { typeName } = this.extractUtils();
        return typeName;
    }


    public getFeatureWithLock(options: { rids: string[], expiry?: number }) {
        return new Promise<WFSTEditGetFeatureWithLockItem>((resolve, reject) => {
            const { typeName, reference } = this.extractUtils();
            let postData = "";
            try {
                postData = WFSTProtocol.createGetFeatureWithLockQuery({ typeName, rids: options.rids, expiry: options.expiry });
            } catch (error) {
                this.errorHandler.handleError(error, () => reject());
                return;
            }
            this.service.transaction(postData).then(xmlText => {
                const info = WFSTProtocol.parseLockResponse(xmlText);
                resolve({
                    lockId: info.lockId,
                    numberMatched: Number(info.numberMatched),
                    numberReturned: Number(info.numberReturned),
                    timeStamp: info.timeStamp,
                    expiry: options.expiry ? options.expiry : 5,
                    lockName: "",
                    srsName: reference.identifier,
                    //   rawData: xmlText,
                    unchangedIds: options.rids,
                    updatedIds: [],
                    insertedIds: [],
                    deletedIds: [],
                    storeSettings: this.cleanOptions()
                });
            }).catch(error => this.errorHandler.handleError(error, resolve));
        })
    }

    public lockFeatures(options: { rids: string[], expiry?: number }) {
        return new Promise<WFSTEditFeatureLockItem>((resolve, reject) => {
            const { typeName, reference } = this.extractUtils();
            let postData = "";
            try {
                postData = WFSTProtocol.createLockFeatureQuery({ typeName, rids: options.rids, expiry: options.expiry });
            } catch (error) {
                this.errorHandler.handleError(error, () => reject());
                return;
            }
            this.service.transaction(postData).then(xmlText => {
                const info = WFSTProtocol.parseLockResponse(xmlText);
                resolve({
                    lockId: info.lockId,
                    expiry: options.expiry ? options.expiry : 5,
                    lockName: "",
                    srsName: reference.identifier,
                    unchangedIds: options.rids,
                    updatedIds: [],
                    insertedIds: [],
                    deletedIds: [],
                    storeSettings: this.cleanOptions()
                });
            }).catch(error => this.errorHandler.handleError(error, resolve));
        })
    }

    private cleanOptions(): WFSTFeatureStoreConstructorOptions {
        return { ...this.options, codec: undefined, reference: undefined };
    }

    private handleOtherHttpErrors(response: Response, resolve: (value: (PromiseLike<unknown> | unknown)) => void) {
        this.errorHandler.handleError(response, resolve);
    }

    public getWFSStoreidentity() {
        return WFSTFeatureStore.getWFSStoreIdentity(this.options);
    }

    public static getWFSStoreIdentity(store: WFSTFeatureStoreConstructorOptions) {
        const storeExtended = store as any;
        let indentity;
        if (storeExtended.beforeProxy) {
            indentity = `${storeExtended.beforeProxy.trim()}|${storeExtended.typeName.trim()}`;
        } else {
            indentity = `${storeExtended.serviceURL.trim()}|${storeExtended.typeName.trim()}`;
        }
        return indentity;
    }

    public getScreenHelper() {
        return this.delegateScreen;
    }

    public setScreenHelper(screenHelper: WFSTDelegateScreenHelper) {
        this.delegateScreen = screenHelper;
    }
}


function getReferenceForWFS(e: WFSCapabilitiesFeatureType, r): any {
    const t = getDataReference(e.defaultReference);
    if (t && !r) return { reference: t, srsName: e.defaultReference };
    if (r) {
        if (t && t.equals(r)) return { reference: t, srsName: e.defaultReference };
        const s = getOtherReferenceFromCapabilities(e.otherReferences, r);
        if (s) return s;
        console.warn(`WFSFeature: User reference '${r.identifier}' is not supported by WFS service`);
        return { reference: r }
    }
    const s = getOtherReferenceFromCapabilities(e.otherReferences, undefined);
    if (s) return s;
    throw new ProgrammingError("WFSFeature: No reference from WFS capabilities is supported")
}

function getDataReference(e) {
    if (isValidReferenceIdentifier(e)) return getReference(e);
    try {
        return parseWellKnownText(e)
    } catch (r) {
        console.warn(`WFSFeatureStore: reference unsupported: ${e}`)
    }
}

function getOtherReferenceFromCapabilities(e, r) {
    for (let t = 0; t < e.length; t++) {
        const s = e[t];
        const i = getDataReference(s);
        if (i) {
            if (!r) return { reference: i, srsName: s };
            if (r.equals(i)) return { reference: r, srsName: s }
        }
    }
}

const FORMATS = { json: [RegExp("json", "i")], gml: [RegExp("gml", "i"), RegExp("text/xml", "i")] };

function hasFormatType(e, t) {
    return t.some((t => e.some((e => e.test(t)))))
}

function getOutputType(e = []) {
    if (e.length > 0) {
        if (hasFormatType(FORMATS.json, e)) return "json";
        if (hasFormatType(FORMATS.gml, e)) return "gml"
    }
    return "json"
}

function getFirstFormatOfType(e, t) {
    return e.find((e => FORMATS[t].some((t => t.test(e)))))
}

const DEFAULT_OUTPUT_GML_WFS_1 = "text/xml; subtype=gml/3.1.1";
const DEFAULT_OUTPUT_GML_WFS_2 = "application/gml+xml; version=3.2";
const DEFAULT_OUTPUT_JSON = "application/json";

function getOutputFormat(e, t = []) {
    if ("json" === getOutputType(t)) return t.includes(DEFAULT_OUTPUT_JSON) ? DEFAULT_OUTPUT_JSON : getFirstFormatOfType(t, "json") ?? DEFAULT_OUTPUT_JSON;
    if (e.some((e => e === WFSVersion.V202 || e === WFSVersion.V200)) && t.includes(DEFAULT_OUTPUT_GML_WFS_2)) return DEFAULT_OUTPUT_GML_WFS_2;
    if (e.some((e => e === WFSVersion.V110 || e === WFSVersion.V100)) && t.includes(DEFAULT_OUTPUT_GML_WFS_1)) return DEFAULT_OUTPUT_GML_WFS_1;
    return getFirstFormatOfType(t, "gml") ?? DEFAULT_OUTPUT_GML_WFS_2
}

function mergeRequestMethods(e, t) {
    if (!t || !Array.isArray(t) || !t.length) return e;
    const o = e.filter((e => t.indexOf(e) > -1));
    if (0 === o.length) {
        console.warn(`WFS service does not support request methods: ${t.join(", ")}`);
        return e
    }
    return o
}

function getModelBoundsFromCapabilities(e, r) {
    const t = e.getWGS84Bounds()[0];
    if (t?.reference) return createTransformation(t.reference, r).transformBounds(t)
}

function processServiceUrl(e) {
    return "?" === e[e.length - 1] ? e.substring(0, e.length - 1) : e
}
