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
import type {
    CommitLockTransactionResult,
    WFSEditedFeature,
    WFSTEditFeatureLockItem,
    WFSTEditGetFeatureWithLockItem,
    WFSTFeatureStoreConstructorOptions
} from "./types/WFSTTypes";

// Re-exported here for backwards compatibility: these types used to be declared in this file.
// `export type` matters: esbuild transpiles this file in isolation and can't tell a plain
// `export { X }` refers to an interface with no runtime existence, so it would emit a broken
// runtime re-export.
export type {
    CommitLockTransactionResult,
    WFSEditedFeature,
    WFSTEditFeatureLockItem,
    WFSTEditGetFeatureWithLockItem,
    WFSTFeatureStoreConstructorOptions
};

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
    private mode3D?: boolean;

    constructor(options: WFSTFeatureStoreConstructorOptions) {
        super(options);
        this.options = options;
        this._wfst = options.wfst;
        this.setFeatureTemplate(null);
        this.version = options.versions && options.versions.length>0 ? options.versions[0] : WFSVersion.V200;
        this.delegateScreen = new WFSTDelegateScreenHelper();
        // options.swapAxes is typed as string[] (RIA's own WFSFeatureStoreConstructorOptions),
        // but some real callers pass a plain boolean through a loosely-typed options object -
        // a blanket "swap for this whole store" toggle. Support both: a boolean means exactly
        // that; a real array is checked for membership against this store's own reference, so
        // e.g. swapAxes: ["EPSG:3857"] on a CRS:84 store correctly does nothing.
        this.invertAxes = Array.isArray(options.swapAxes)
            ? options.swapAxes.includes(options.reference.identifier)
            : !!options.swapAxes;
        // Unlike invertAxes above, this must NOT be coerced with !! - omitted (undefined) means
        // "auto-detect per feature", which is what every existing caller gets since none pass this.
        this.mode3D = options.mode3D;
    }

    public wfstCapable(): boolean {
        return !!(this._wfst && this._wfst.Transaction);
    }

    public static async createFromURL_WFST(url, typeName: string, options?: WFSFeatureStoreCreateOptions & WFSCapabilitiesFromUrlOptions) {
        const s = await WFSCapabilitiesExtended.fromURL(url, options);
        return WFSTFeatureStore.createFromCapabilities_WFST(s, typeName, options);
    }

    public static createFromCapabilities_WFST(extended: WFSCapabilitiesExtendedResult, typeName:string, options: WFSFeatureStoreCreateOptions = {}) {
        const wfsCapabilities = extended.wfsCapabilities;
        const wfst = extended.wfstCapabilities.WFSTOperations;
        // featureTypes is null (not []) when the capabilities document omits <FeatureTypeList>
        // entirely - which GeoServer does when the caller can see zero feature types (e.g. an
        // ACL-secured workspace requested anonymously), rather than emitting an empty list.
        const match = (wfsCapabilities.featureTypes || []).filter((featureType => featureType.name === typeName))[0];
        if (typeof match === "undefined") throw new ProgrammingError(`there is no feature type "${typeName}" in capabilities`);
        const {reference, srsName} = getReferenceForWFS(match, options.reference);
        const getFeatureRequests = wfsCapabilities.operations.filter((operation => "GetFeature" === operation.name))[0].supportedRequests;
        let getServiceURL = "";
        let postServiceURL = "";
        const supportedMethods: string[] = [];
        getFeatureRequests.forEach((request => {
            const url = processServiceUrl(request.url);
            if ("GET" === request.method) getServiceURL = url; else if ("POST" === request.method) postServiceURL = url;
            supportedMethods.push(request.method)
        }));
        if (typeof options.serviceURL === "string") {
            getServiceURL = options.serviceURL;
            postServiceURL = options.serviceURL
        } else if (options.serviceURL) {
            if (typeof options.serviceURL.GET === "string") getServiceURL = options.serviceURL.GET;
            if (typeof options.serviceURL.POST === "string") postServiceURL = options.serviceURL.POST
        }
        const versions = options.versions || [wfsCapabilities.version];
        const outputFormat = options.outputFormat || getOutputFormat(versions, match.outputFormats);
        const constructorOptions = {
            typeName: match.name,
            serviceURL: getServiceURL,
            postServiceURL: postServiceURL,
            reference,
            srsName,
            codec: options.codec,
            outputFormat,
            versions,
            methods: mergeRequestMethods(supportedMethods, options.methods),
            credentials: options.credentials,
            requestHeaders: options.requestHeaders,
            swapAxes: options.swapAxes,
            geometryName: options.geometryName,
            requestParameters: options.requestParameters,
            bounds: getModelBoundsFromCapabilities(match, reference)
        };
        return new WFSTFeatureStore({...constructorOptions, wfst})
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
                this.postXMLTransaction(urlEndpoint, postData, resolve, xmlText => {
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
                         postData = WFSTQueries.TransactionUpdateRequest2_0_0({typeName, feature: frozenFeature, featureDescription: this.featureTemplate, invertAxes: this.invertAxes, mode3D: this.mode3D});
                     } catch (error) {
                         resolve(null);
                         this.delegateScreen.MessageError(`[WFS-T] Error: ${error.message}`);
                         return;
                     }
                     this.postXMLTransaction(urlEndpoint, postData, resolve, xmlText => {
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
                const geometryType = GMLFeatureEncoder.getGeometryTypeName(feature);

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
                    postData = WFSTQueries.TransactionAddRequest2_0_0({typeName, feature: newFeature, featureDescription: this.featureTemplate, invertAxes: this.invertAxes, mode3D: this.mode3D});
                } catch (error) {
                    resolve(null);
                    this.delegateScreen.MessageError(`[WFS-T] Error: ${error.message}`);
                    return;
                }
                this.postXMLTransaction(urlEndpoint, postData, resolve, xmlText => {
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
                }, {
                    // 400 also needs the extra EditNewFeatureProperties call that the other
                    // non-OK statuses don't - handleOtherHttpErrors' on400 hook covers exactly this.
                    onNonOk: response => this.handleOtherHttpErrors(response, resolve, () => this.delegateScreen.EditNewFeatureProperties(newFeature, this))
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

    // Get method
    get(id: string | number, options: any): Promise<Feature> {
        return new Promise<Feature>((resolve, reject)=> {
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
        return new Promise<Cursor<Feature>>((resolve)=>{
            const {typeName, urlEndpoint} = this.extractUtils();

            const postData = WFSTQueries.TransactionQueryByIds_2_0_0({typeName, rids, outputFormat: this.options.outputFormat});
            this.postXMLTransaction(urlEndpoint, postData, resolve, textXml => {
                try {
                    const cursor = this.options.codec.decode({content: textXml});
                    resolve(cursor);
                } catch (err) {
                    resolve(null);
                }
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

            this.postXMLTransaction(urlEndpoint, postData, resolve, textXml => {
                const {totalDeleted} = WFSTResponses.parseXMLTransactionResponseResourceId(textXml);
                eventSupport.emit("StoreChanged", "remove", undefined, rid);
                resolve(true);
                this.delegateScreen.MessageSuccess(`[WFS-T] Total deleted: ${totalDeleted}` );
            }, {
                // Unlike every other call site, remove()'s network-error path resolves false, not null.
                onNetworkError: error => {
                    resolve(false);
                    this.errorUnknown(error);
                }
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
                invertAxes: this.invertAxes,
                mode3D: this.mode3D
            });

            this.postXMLTransaction(urlEndpoint, postData, resolve, xmlText => {
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
        })
    }

    loadFeatureDescription() {
        return new Promise<WFSFeatureDescription>((resolve) => {
            const {typeName, urlEndpoint, preferredVersion} = this.extractUtils();
            const request = `${urlEndpoint}?REQUEST=DescribeFeatureType&SERVICE=WFS&VERSION=${preferredVersion}&typeNames=${typeName}`;
            this.request(request, {method: 'GET', headers: {'Accept': 'text/xml'}}, resolve, xmlText => {
                const featureTemplate =  parseWFSFeatureDescription(xmlText);
                this.setFeatureTemplate(featureTemplate);
                resolve (featureTemplate);
            }, {
                // Unlike every other call site, this one never resolves on a network error - the
                // returned Promise is left pending. Preserved exactly as-is; not this slice's job to fix.
                onNetworkError: error => {console.log('error', error)}
            });
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
            this.postXMLTransaction(urlEndpoint, postData, resolve, xmlText => {
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
            this.postXMLTransaction(urlEndpoint, postData, resolve, xmlText => {
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
        })
    }

    private cleanOptions():  WFSTFeatureStoreConstructorOptions {
        return {...this.options, codec: undefined, reference: undefined};
    }

    private handleOtherHttpErrors(response: Response, resolve: (value: (PromiseLike<unknown> | unknown)) => void, on400?: (response: Response) => void) {
        if (response.status === 401) {
            resolve(null);
            this.error401();
        } else if (response.status === 500) {
            resolve(null);
            this.error500();
        } else if (response.status === 400) {
            resolve(null);
            this.error400(response);
            on400?.(response);
        } else {
            resolve(null);
            this.errorOther(response);
        }
    }

    // Shared by every method below: fetch, branch on status 200 vs other (defaulting to
    // handleOtherHttpErrors), and catch network errors (defaulting to resolve(null) + errorUnknown).
    // Call-site-specific behavior (a custom 400 handler, a different catch resolve value, or no
    // resolve at all on network error) is expressed via the optional overrides, not by duplicating
    // this whole shape again.
    private request(
        url: string,
        fetchOptions: FetchSettingsOptions,
        resolve: (value: (PromiseLike<unknown> | unknown)) => void,
        onSuccess: (xmlText: string) => void,
        overrides?: {
            onNonOk?: (response: Response) => void;
            onNetworkError?: (error: unknown) => void;
        }
    ): void {
        fetch(url, this.fetchSettingsOptions(fetchOptions)).then(response => {
            if (response.status === 200) {
                response.text().then(onSuccess);
            } else if (overrides?.onNonOk) {
                overrides.onNonOk(response);
            } else {
                this.handleOtherHttpErrors(response, resolve);
            }
        }).catch(error => {
            if (overrides?.onNetworkError) {
                overrides.onNetworkError(error);
            } else {
                resolve(null);
                this.errorUnknown(error);
            }
        });
    }

    // Convenience wrapper for the common case: a WFS-T POST request with an XML body, which is
    // every fetch call site in this class except loadFeatureDescription's GET.
    private postXMLTransaction(
        urlEndpoint: string,
        postData: string,
        resolve: (value: (PromiseLike<unknown> | unknown)) => void,
        onSuccess: (xmlText: string) => void,
        overrides?: {
            onNonOk?: (response: Response) => void;
            onNetworkError?: (error: unknown) => void;
        }
    ): void {
        this.request(urlEndpoint, {
            method: 'POST',
            headers: {
                'Accept': 'text/xml',
                'Content-Type': 'text/xml'
            },
            body: postData
        }, resolve, onSuccess, overrides);
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


interface ReferenceAndSrsName {
    reference: CoordinateReference;
    srsName?: string;
}

function getReferenceForWFS(featureType: WFSCapabilitiesFeatureType, userReference?: CoordinateReference): ReferenceAndSrsName {
    const defaultReference = getDataReference(featureType.defaultReference);
    if (defaultReference && !userReference) return {reference: defaultReference, srsName: featureType.defaultReference};
    if (userReference) {
        if (defaultReference && defaultReference.equals(userReference)) return {reference: defaultReference, srsName: featureType.defaultReference};
        const other = getOtherReferenceFromCapabilities(featureType.otherReferences, userReference);
        if (other) return other;
        console.warn(`WFSFeature: User reference '${userReference.identifier}' is not supported by WFS service`);
        return {reference: userReference}
    }
    const other = getOtherReferenceFromCapabilities(featureType.otherReferences, undefined);
    if (other) return other;
    throw new ProgrammingError("WFSFeature: No reference from WFS capabilities is supported")
}

function getDataReference(referenceIdentifierOrWKT: string): CoordinateReference | undefined {
    if (isValidReferenceIdentifier(referenceIdentifierOrWKT)) return getReference(referenceIdentifierOrWKT);
    try {
        return parseWellKnownText(referenceIdentifierOrWKT)
    } catch (error) {
        console.warn(`WFSFeatureStore: reference unsupported: ${referenceIdentifierOrWKT}`)
    }
}

function getOtherReferenceFromCapabilities(otherReferences: string[], userReference?: CoordinateReference): ReferenceAndSrsName | undefined {
    for (let index = 0; index < otherReferences.length; index++) {
        const srsName = otherReferences[index];
        const reference = getDataReference(srsName);
        if (reference) {
            if (!userReference) return {reference, srsName};
            if (userReference.equals(reference)) return {reference: userReference, srsName}
        }
    }
}

const FORMATS = {json: [RegExp("json", "i")], gml: [RegExp("gml", "i"), RegExp("text/xml", "i")]};
type FormatCategory = keyof typeof FORMATS;

function hasFormatType(patterns: RegExp[], formats: string[]): boolean {
    return formats.some((format => patterns.some((pattern => pattern.test(format)))))
}

function getOutputType(formats: string[] = []): FormatCategory {
    if (formats.length > 0) {
        if (hasFormatType(FORMATS.json, formats)) return "json";
        if (hasFormatType(FORMATS.gml, formats)) return "gml"
    }
    return "json"
}

function getFirstFormatOfType(formats: string[], category: FormatCategory): string | undefined {
    return formats.find((format => FORMATS[category].some((pattern => pattern.test(format)))))
}

const DEFAULT_OUTPUT_GML_WFS_1 = "text/xml; subtype=gml/3.1.1";
const DEFAULT_OUTPUT_GML_WFS_2 = "application/gml+xml; version=3.2";
const DEFAULT_OUTPUT_JSON = "application/json";

function getOutputFormat(versions: WFSVersion[], formats: string[] = []): string {
    if ("json" === getOutputType(formats)) return formats.includes(DEFAULT_OUTPUT_JSON) ? DEFAULT_OUTPUT_JSON : getFirstFormatOfType(formats, "json") ?? DEFAULT_OUTPUT_JSON;
    if (versions.some((version => version === WFSVersion.V202 || version === WFSVersion.V200)) && formats.includes(DEFAULT_OUTPUT_GML_WFS_2)) return DEFAULT_OUTPUT_GML_WFS_2;
    if (versions.some((version => version === WFSVersion.V110 || version === WFSVersion.V100)) && formats.includes(DEFAULT_OUTPUT_GML_WFS_1)) return DEFAULT_OUTPUT_GML_WFS_1;
    return getFirstFormatOfType(formats, "gml") ?? DEFAULT_OUTPUT_GML_WFS_2
}

function mergeRequestMethods(supportedMethods: string[], requestedMethods?: string[]): string[] {
    if (!requestedMethods || !Array.isArray(requestedMethods) || !requestedMethods.length) return supportedMethods;
    const matched = supportedMethods.filter((method => requestedMethods.indexOf(method) > -1));
    if (0 === matched.length) {
        console.warn(`WFS service does not support request methods: ${requestedMethods.join(", ")}`);
        return supportedMethods
    }
    return matched
}

function getModelBoundsFromCapabilities(featureType: WFSCapabilitiesFeatureType, reference: CoordinateReference) {
    const wgs84Bounds = featureType.getWGS84Bounds()[0];
    if (wgs84Bounds?.reference) return createTransformation(wgs84Bounds.reference, reference).transformBounds(wgs84Bounds)
}

function processServiceUrl(url: string): string {
    return "?" === url[url.length - 1] ? url.substring(0, url.length - 1) : url
}
