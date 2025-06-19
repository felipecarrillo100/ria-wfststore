import {
    WFSFeatureStore,
    WFSFeatureStoreConstructorOptions, WFSFeatureStoreCreateOptions, WFSQueryOptions,
} from "@luciad/ria/model/store/WFSFeatureStore";
import {Feature, FeatureId} from "@luciad/ria/model/feature/Feature";
import {Handle} from "@luciad/ria/util/Evented";
import {WFSTQueries} from "./libs/WFSTQueries";
import {EventedSupport} from "@luciad/ria/util/EventedSupport";
import {
    areCompatibleGeometries,
    parseWFSFeatureDescription,
    standardizeProperties,
    WFSFeatureDescription
} from "./libs/ParseWFSFeatureDescription";
import {HttpRequestHeaders} from "@luciad/ria/util/HttpRequestOptions";
import {WFSTResponses} from "./libs/WFSTResponses";
import {WFSVersion} from "@luciad/ria/ogc/WFSVersion";
import {CoordinateReference} from "@luciad/ria/reference/CoordinateReference";
import {Cursor} from "@luciad/ria/model/Cursor";
import {GMLFeatureEncoder} from "./libs/GMLFeatureEncoder";
import {WFSCapabilitiesExtended, WFSCapabilitiesExtendedResult, WFSTOperationsKeys} from "./WFSCapabilitiesExtended";
import {WFSTDelegateScreenHelper} from "./libs/screen/WFSTDelegateScreenHelper";
import {ProgrammingError} from "@luciad/ria/error/ProgrammingError";
import {getReference, isValidReferenceIdentifier, parseWellKnownText} from "@luciad/ria/reference/ReferenceProvider";
import {WFSCapabilitiesFeatureType} from "@luciad/ria/model/capabilities/WFSCapabilitiesFeatureType";
import {createTransformation} from "@luciad/ria/transformation/TransformationFactory";
import {WFSCapabilitiesFromUrlOptions} from "@luciad/ria/model/capabilities/WFSCapabilities";
import {QueryOptions} from "@luciad/ria/model/store/Store";

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

    constructor(options: WFSTFeatureStoreConstructorOptions) {
        super(options);
        this.options = options;
        this._wfst = options.wfst;
        this.setFeatureTemplate(null);
        this.version = options.versions && options.versions.length>0 ? options.versions[0] : WFSVersion.V200;
        this.delegateScreen = new WFSTDelegateScreenHelper();
        this.invertAxes = !!options.swapAxes;
    }

    public wfstCapable(): boolean {
        return !!(this._wfst && this._wfst.Transaction);
    }

    public static async createFromURL_WFST(url, typeName: string, options?: WFSFeatureStoreCreateOptions & WFSCapabilitiesFromUrlOptions) {
        const s = await WFSCapabilitiesExtended.fromURL(url, options);
        return WFSTFeatureStore.createFromCapabilities_WFST(s, typeName, options);
    }

    public static createFromCapabilities_WFST(extended: WFSCapabilitiesExtendedResult, typeName:string, options: WFSFeatureStoreCreateOptions = {}) {
        const e = extended.wfsCapabilities;
        const wfst = extended.wfstCapabilities.WFSTOperations;
        const match = e.featureTypes.filter((e => e.name === typeName))[0];
        if (typeof match === "undefined") throw new ProgrammingError(`there is no feature type "${typeName}" in capabilities`);
        const {reference: i, srsName: o} = getReferenceForWFS(match, options.reference);
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
        return new WFSTFeatureStore({...m, wfst})
    }


    putProperties(feature: Feature): Promise<FeatureId> {
        return new Promise<FeatureId>((resolve)=>{
            const editFeature = () => {
                const frozenFeature = new Feature(feature.shape, feature.properties, feature.id);

                const {typeName, urlEndpoint, eventSupport} = this.extractUtils();
                let postData = "";
                try {
                    postData = WFSTQueries.TransactionUpdateRequest2_0_0({typeName, feature: frozenFeature, featureDescription: this.featureTemplate, onlyProperties: true});
                } catch (error) {
                    resolve(null);
                    this.delegateScreen.MessageError(`[WFS-T] Error: ${error.message}`);
                    return;
                }
                fetch(urlEndpoint, this.fetchSettingsOptions({
                    method: 'POST',
                    headers: {
                        'Accept': 'text/xml',
                        'Content-Type': 'text/xml'
                    },
                    body: postData
                })).then(response=>{
                    if (response.status===200) {
                        response.text().then(xmlText=>{
                            const { totalUpdated, resourceId} = WFSTResponses.parseXMLTransactionResponseResourceId(xmlText);
                            if (Number(totalUpdated)===0) {
                                this.delegateScreen.MessageWarning(`[WFS-T] Total updated: ${totalUpdated}`);
                                resolve(null);
                            } else {
                                //  Workaround was removed
                                if (frozenFeature.id !== resourceId) console.warn(`Invalid ID response to put. Expected: ${frozenFeature.id} but got ${resourceId}`);
                                eventSupport.emit("StoreChanged", "update", frozenFeature, frozenFeature.id);
                                resolve(feature.id);
                                this.delegateScreen.MessageSuccess(`[WFS-T] Total updated: ${totalUpdated}`);
                            }
                        });
                    } else this.handleOtherHttpErrors(response, resolve)
                }).catch(error => {
                    resolve(null);
                    this.errorUnknown(error);
                });
            }
            // If feature template not available then load it!
            if (this.featureTemplate) {
                editFeature();
            } else {
                this.loadFeatureDescription().then(featureTemplate=>{
                    if (featureTemplate) editFeature();
                })
            }
        })
    }
     put(feature: Feature, options?: any): Promise<FeatureId> {
         return new Promise<FeatureId>((resolve)=>{
             this.delegateScreen.confirmGeometryUpdate(()=>{
                 const editFeature = () => {
                     const frozenFeature = new Feature(feature.shape, feature.properties, feature.id);

                     const {typeName, urlEndpoint, eventSupport} = this.extractUtils();
                     let postData = "";
                     try {
                         postData = WFSTQueries.TransactionUpdateRequest2_0_0({typeName, feature: frozenFeature, featureDescription: this.featureTemplate, invertAxes: this.invertAxes});
                     } catch (error) {
                         resolve(null);
                         this.delegateScreen.MessageError(`[WFS-T] Error: ${error.message}`);
                         return;
                     }
                     fetch(urlEndpoint, this.fetchSettingsOptions({
                         method: 'POST',
                         headers: {
                             'Accept': 'text/xml',
                             'Content-Type': 'text/xml'
                         },
                         body: postData
                     })).then(response=>{
                         if (response.status===200) {
                             response.text().then(xmlText=>{
                                 const { totalUpdated, resourceId} = WFSTResponses.parseXMLTransactionResponseResourceId(xmlText);
                                 if (Number(totalUpdated)===0) {
                                     this.delegateScreen.MessageWarning(`[WFS-T] Total updated: ${totalUpdated}`);
                                     resolve(null);
                                 } else {
                                     // Workaround removed
                                     if (frozenFeature.id !== resourceId) console.warn(`Invalid ID response to put. Expected: ${frozenFeature.id} but got ${resourceId}`);
                                     eventSupport.emit("StoreChanged", "update", frozenFeature, frozenFeature.id);
                                     resolve(feature.id);
                                     this.delegateScreen.MessageSuccess(`[WFS-T] Total updated: ${totalUpdated}`);
                                 }
                             });
                         } else this.handleOtherHttpErrors(response, resolve)
                     }).catch(error => {
                         resolve(null);
                         this.errorUnknown(error);
                     });
                 }
                 // If feature template not available then load it!
                 if (this.featureTemplate) {
                     editFeature();
                 } else {
                     this.loadFeatureDescription().then(featureTemplate=>{
                         if (featureTemplate) editFeature();
                     })
                 }},
                 ()=> {
                     resolve(null);
                 })
         })
     }

    add(feature: Feature, options?: any): Promise<FeatureId> {
        return new Promise<FeatureId>((resolve)=>{
            const {typeName, urlEndpoint, eventSupport} = this.extractUtils();
            const addFeature = () => {
                const {newFeature, validProperties} = standardizeProperties(this.featureTemplate, feature);
                const {geometryType} = GMLFeatureEncoder.encodeFeatureToGeoJSON(feature);

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
                    postData = WFSTQueries.TransactionAddRequest2_0_0({typeName, feature: newFeature, featureDescription: this.featureTemplate, invertAxes: this.invertAxes});
                } catch (error) {
                    resolve(null);
                    this.delegateScreen.MessageError(`[WFS-T] Error: ${error.message}`);
                    return;
                }
                fetch(urlEndpoint, this.fetchSettingsOptions({
                    method: 'POST',
                    headers: {
                        'Accept': 'text/xml',
                        'Content-Type': 'text/xml'
                    },
                    body: postData
                })).then(response=>{
                    if (response.status===200) {
                        response.text().then(xmlText=>{
                            const {resourceId, totalInserted} = WFSTResponses.parseXMLTransactionResponseResourceId(xmlText);
                            if (Number(totalInserted)===0) {
                                this.delegateScreen.MessageWarning(`[WFS-T] Total inserted: ${totalInserted}`);
                                resolve(null);
                            } else {
                                newFeature.id = resourceId;
                                eventSupport.emit("StoreChanged",  "add", newFeature, resourceId);
                                resolve(resourceId)
                                this.delegateScreen.MessageSuccess(`[WFS-T] Total inserted: ${totalInserted}`);
                            }
                        });
                    } else if (response.status === 401) {
                        resolve(null);
                        this.error401();
                    } else if (response.status === 500) {
                        resolve(null);
                        this.error500();
                    } else if (response.status === 400) {
                        resolve(null);
                        this.error400(response);
                        this.delegateScreen.EditNewFeatureProperties(newFeature, this);
                    } else {
                        resolve(null);
                        this.errorOther(response);
                    }
                }).catch(error => {
                    resolve(null);
                    this.errorUnknown(error);
                });
            }
            // If feature template not available then load it!
            if (this.featureTemplate) {
                addFeature();
            } else {
                this.loadFeatureDescription().then(featureTemplate=>{
                    if (featureTemplate) addFeature();
                })
            }
        })
    }

    query(query?: WFSQueryOptions, options?: QueryOptions): Promise<Cursor<Feature>> {
        return super.query(query, options);
    }

    queryByRids(rids: string[]): Promise<Cursor<Feature>> {
        return new Promise<Cursor<Feature>>((resolve)=>{
            const {typeName, urlEndpoint} = this.extractUtils();

            const postData = WFSTQueries.TransactionQueryByIds_2_0_0({typeName, rids, outputFormat: this.options.outputFormat});
            fetch(urlEndpoint, this.fetchSettingsOptions({
                method: 'POST',
                headers: {
                    'Accept': 'text/xml',
                    'Content-Type': 'text/xml'
                },
                body: postData
            })).then(response=>{
                if (response.status===200) {
                    response.text().then(textXml=>{
                        try {
                            const cursor = this.options.codec.decode({content: textXml});
                            resolve(cursor);
                        } catch (err) {
                            resolve(null);
                        }
                    });
                } else this.handleOtherHttpErrors(response, resolve);
            }).catch(error =>{
                resolve(null);
                this.errorUnknown(error);
            });
        })
    }

    private error401() {
        this.delegateScreen.MessageError(`WFS-T:\r\nUnauthorized`);
    }
    private error500() {
        this.delegateScreen.MessageError(`WFS-T:\r\nInternal Server Error`);
    }

    private errorOther(response: Response) {
        this.delegateScreen.MessageError(`WFS-T:\r\nError Code ${response.status}`);
    }

    // Parameter kept error for future use:
    private errorUnknown(error?:any) {
        console.log(error);
        this.delegateScreen.MessageError(`WFS-T: Unknown Error`);
    }

    private error400(response: Response) {
        response.text().then(xmlText=>{
            const {exceptionCode, exceptionText} = WFSTResponses.parseExceptionReport(xmlText);
            this.delegateScreen.MessageError(`${exceptionCode}:\r\n${exceptionText}`);
        });
    }

    public remove(rid: string | number): Promise<boolean>  {
        return new Promise<boolean>((resolve)=>{
            const {typeName, urlEndpoint, eventSupport} = this.extractUtils();

            const postData = WFSTQueries.TransactionDeleteRequest2_0_0({typeName, rid});

            fetch(urlEndpoint, this.fetchSettingsOptions({
                method: 'POST',
                headers: {
                    'Accept': 'text/xml',
                    'Content-Type': 'text/xml'
                },
                body: postData
            })).then(response=>{
                if (response.status===200) {
                    response.text().then(textXml=>{
                        const {totalDeleted} = WFSTResponses.parseXMLTransactionResponseResourceId(textXml);
                        eventSupport.emit("StoreChanged", "remove", undefined, rid);
                        resolve(true);
                        this.delegateScreen.MessageSuccess(`[WFS-T] Total deleted: ${totalDeleted}` );
                    });
                } else this.handleOtherHttpErrors(response, resolve);
        }).catch(error =>{
                resolve(false);
                this.errorUnknown(error);
            });
        })
    }

    public commitLockTransaction(lockItem: WFSTEditFeatureLockItem) {
        return new Promise<CommitLockTransactionResult>((resolve)=>{
            const {typeName, urlEndpoint} = this.extractUtils();

            const postData = WFSTQueries.TransactionCommitLock_2_0_0({
                typeName,
                lockItem, featureDescription:
                this.featureTemplate,
                invertAxes: this.invertAxes
            });

            fetch(urlEndpoint, this.fetchSettingsOptions({
                method: 'POST',
                headers: {
                    'Accept': 'text/xml',
                    'Content-Type': 'text/xml'
                },
                body: postData
            })).then(response=>{
                if (response.status===200) {
                    response.text().then(xmlText=>{
                        const {totalInserted, totalUpdated, totalDeleted, totalReplaced} = WFSTResponses.parseXMLTransactionResponseResourceId(xmlText);
                        const message = [];
                        const result : CommitLockTransactionResult = {
                            success: true,
                            totalInserted:0,
                            totalUpdated:0,
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
                        result.totalChanges = result.totalReplaced + result.totalInserted + result.totalDeleted+ result.totalUpdated;
                        const toastMessage = this.delegateScreen.createToastList("[WFS-T]", message);
                        this.delegateScreen.MessageInfo(toastMessage as any);
                        resolve(result);
                    });
                } else this.handleOtherHttpErrors(response, resolve);
            }).catch(error =>{
                resolve(null);
                this.errorUnknown(error);
            });
        })
    }

    loadFeatureDescription() {
        return new Promise<WFSFeatureDescription>((resolve) => {
            const {typeName, urlEndpoint, preferredVersion} = this.extractUtils();
            const request = `${urlEndpoint}?REQUEST=DescribeFeatureType&SERVICE=WFS&VERSION=${preferredVersion}&typeNames=${typeName}`;
            fetch(request, this.fetchSettingsOptions({
                method: 'GET',
                headers: {
                    'Accept': 'text/xml',
                }
            })).then(response=>{
                if (response.status===200) {
                    response.text().then((xmlText)=>{
                        const featureTemplate =  parseWFSFeatureDescription(xmlText);
                        this.setFeatureTemplate(featureTemplate);
                        resolve (featureTemplate);
                    });
                } else this.handleOtherHttpErrors(response, resolve);
            }).catch(error => {console.log('error', error)});
        })
    }

    on(event: "StoreChanged", callback: any): Handle {
        return super.on(event, callback);
    }

    private extractUtils() {
        const self = (this as any);
        return {
             typeName: self._typeName[0] as string,
             urlEndpoint: self._requestBuilder._postServiceURL  as string,
             outputFormat: self._outputFormat  as string,
             preferredVersion: self._requestBuilder._preferredVersion  as string,
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

    private fetchSettingsOptions(options: FetchSettingsOptions):  RequestInit {
        const headers = {...this.options.requestHeaders, ...options.headers};
        const Accept = this.options.requestHeaders ? this.options.requestHeaders.Accept : undefined;
        headers.Accept = (Accept && options.headers.Accept) ? Accept+";" + options.headers.Accept : options.headers.Accept;
        return {
            method: options.method,
            credentials: this.options?.credentials ? "same-origin" : "omit",
            headers,
            body: options.method === "POST" || options.method === "PUT"  || options.method === "PATCH" ? options.body : undefined
        }
    }

    getFeatureTemplate() {
        return this.featureTemplate;
    }

    private setFeatureTemplate(featureTemplate:  WFSFeatureDescription) {
        this.featureTemplate = featureTemplate;
    }

    getTypeName() {
        const {typeName} = this.extractUtils();
        return typeName;
    }


    public getFeatureWithLock(options: {rids: string[], expiry?: number}) {
        return new Promise<WFSTEditGetFeatureWithLockItem>((resolve, reject)=>{
            const {typeName, urlEndpoint, reference} = this.extractUtils();
            let postData= "";
            try {
                postData = WFSTQueries.GetFeatureWithLock2_0_0({typeName, rids: options.rids, expiry: options.expiry});
            } catch (error) {
                this.delegateScreen.MessageError(`[WFS-T] Error: ${error.message}`);
                reject();
                return;
            }
            fetch(urlEndpoint, this.fetchSettingsOptions({
                method: 'POST',
                headers: {
                    'Accept': 'text/xml',
                    'Content-Type': 'text/xml'
                },
                body: postData
            })).then(response=>{
                if (response.status===200) {
                    response.text().then(xmlText=>{
                        const info = WFSTResponses.parseXMLGetFeaturesWithLock(xmlText);
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
                    });
                } else this.handleOtherHttpErrors(response, resolve);
            }).catch(error => {
                resolve(null);
                this.errorUnknown(error);
            });
        })
    }

    public lockFeatures(options: {rids: string[], expiry?: number}) {
        return new Promise<WFSTEditFeatureLockItem>((resolve, reject)=>{
            const {typeName, urlEndpoint, reference} = this.extractUtils();
            let postData= "";
            try {
                postData = WFSTQueries.LockFeature2_0_0({typeName, rids: options.rids, expiry: options.expiry});
            } catch (error) {
                this.delegateScreen.MessageError(`[WFS-T] Error: ${error.message}`);
                reject();
                return;
            }
            fetch(urlEndpoint, this.fetchSettingsOptions({
                method: 'POST',
                headers: {
                    'Accept': 'text/xml',
                    'Content-Type': 'text/xml'
                },
                body: postData
            })).then(response=>{
                if (response.status===200) {
                    response.text().then(xmlText=>{
                        const info = WFSTResponses.parseXMLLockFeatures(xmlText);
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
                    });
                } else this.handleOtherHttpErrors(response, resolve);
            }).catch(error => {
                resolve(null);
                this.errorUnknown(error);
            });
        })
    }

    private cleanOptions():  WFSTFeatureStoreConstructorOptions {
        return {...this.options, codec: undefined, reference: undefined};
    }

    private handleOtherHttpErrors(response: Response, resolve: (value: (PromiseLike<unknown> | unknown)) => void) {
        if (response.status === 401) {
            resolve(null);
            this.error401();
        } else if (response.status === 500) {
            resolve(null);
            this.error500();
        } else if (response.status === 400) {
            resolve(null);
            this.error400(response);
        } else {
            resolve(null);
            this.errorOther(response);
        }
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
    if (t && !r) return {reference: t, srsName: e.defaultReference};
    if (r) {
        if (t && t.equals(r)) return {reference: t, srsName: e.defaultReference};
        const s = getOtherReferenceFromCapabilities(e.otherReferences, r);
        if (s) return s;
        console.warn(`WFSFeature: User reference '${r.identifier}' is not supported by WFS service`);
        return {reference: r}
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
            if (!r) return {reference: i, srsName: s};
            if (r.equals(i)) return {reference: r, srsName: s}
        }
    }
}

const FORMATS = {json: [RegExp("json", "i")], gml: [RegExp("gml", "i"), RegExp("text/xml", "i")]};

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
