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
import {assertGeometryRoundTrip, shouldVerifyRoundTrip} from "./libs/verifyGeometryRoundTrip";
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

/** Shape accepted by {@link WFSTFeatureStore.fetchSettingsOptions}/{@link WFSTFeatureStore.request}. */
interface FetchSettingsOptions {
    method?: string;
    body?: BodyInit | null;
    headers?: HttpRequestHeaders;
}

/**
 * A LuciadRIA {@link WFSFeatureStore} extended with WFS-T (Web Feature Service - Transactional)
 * support: {@link add}/{@link put}/{@link remove} translate to real WFS-T Insert/Update/Delete
 * transactions against the underlying service, and {@link lockFeatures}/{@link getFeatureWithLock}/
 * {@link commitLockTransaction} add feature-locking for coordinating concurrent edits across
 * multiple clients.
 *
 * Most consumers construct this via {@link WFSTFeatureStore.createFromURL_WFST} or
 * {@link WFSTFeatureStore.createFromCapabilities_WFST} rather than the constructor directly,
 * since those two derive most of the required {@link WFSTFeatureStoreConstructorOptions} (service
 * URLs, output format, supported methods, CRS) from the service's own WFS capabilities document.
 *
 * See {@link WFSTFeatureLockStore} for a store dedicated purely to lock lifecycle management
 * (e.g. for a "who's editing what" UI) without the feature CRUD operations this class adds.
 */
export class WFSTFeatureStore extends WFSFeatureStore {
    /**
     * The WFS-T operations (Insert/Update/Delete/Lock support) this store's service advertised in
     * its capabilities - see {@link wfstCapable} and {@link wfst}.
     */
    private _wfst: WFSTOperationsKeys;
    /**
     * The parsed `DescribeFeatureType` schema for this store's feature type, lazily loaded on the
     * first {@link add}/{@link put}/{@link putProperties} call and cached - see
     * {@link loadFeatureDescription}, {@link getFeatureTemplate}.
     */
    private featureTemplate: WFSFeatureDescription;
    /** The exact options this store was constructed with - retained for later use (e.g. {@link cleanOptions}, {@link getWFSStoreidentity}). */
    private options: WFSTFeatureStoreConstructorOptions;
    /** The WFS protocol version this store's requests are encoded for (the first entry in `options.versions`, or 2.0.0 if none was given). */
    private version: WFSVersion;
    /** User-facing notifications (toasts/confirmations) for transaction outcomes - swappable via {@link setScreenHelper}. */
    private delegateScreen: WFSTDelegateScreenHelper;
    /** Whether X/Y axis order must be swapped when encoding outgoing geometry for this store's reference - derived in the constructor. */
    private invertAxes: boolean;
    /** Explicit 2D/3D override for outgoing geometry encoding; undefined auto-detects per feature - see the constructor. */
    private mode3D?: boolean;

    /**
     * @param options constructor options - see {@link WFSTFeatureStoreConstructorOptions}. Prefer
     *                {@link WFSTFeatureStore.createFromURL_WFST} or
     *                {@link WFSTFeatureStore.createFromCapabilities_WFST} over calling this
     *                directly, unless every required field (service URLs, output format,
     *                reference, etc.) is already derived yourself.
     */
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

    /**
     * @returns true if the service's capabilities actually advertise WFS-T `Transaction` support -
     *          check this before calling {@link add}/{@link put}/{@link remove} against a store
     *          that might be backed by a read-only WFS.
     */
    public wfstCapable(): boolean {
        return !!(this._wfst && this._wfst.Transaction);
    }

    /**
     * Fetches the WFS capabilities document at `url` and builds a {@link WFSTFeatureStore} for
     * `typeName` from it - the most common way to construct this class.
     *
     * @param url      the WFS service's base URL.
     * @param typeName the feature type name to build a store for, as it appears in the
     *                 capabilities document's `FeatureTypeList`.
     * @param options  merges creation options ({@link WFSFeatureStoreCreateOptions}), URL-fetch
     *                 options ({@link WFSCapabilitiesFromUrlOptions}), and this store's own
     *                 `verifyCircularGeometryRoundTrip` option.
     * @returns a Promise resolving to the constructed store.
     */
    public static async createFromURL_WFST(url, typeName: string, options?: WFSFeatureStoreCreateOptions & WFSCapabilitiesFromUrlOptions & Pick<WFSTFeatureStoreConstructorOptions, 'verifyCircularGeometryRoundTrip'>) {
        const s = await WFSCapabilitiesExtended.fromURL(url, options);
        return WFSTFeatureStore.createFromCapabilities_WFST(s, typeName, options);
    }

    /**
     * Builds a {@link WFSTFeatureStore} for `typeName` from an already-fetched
     * {@link WFSCapabilitiesExtendedResult} (see {@link WFSCapabilitiesExtended.fromURL}) - use
     * this instead of {@link WFSTFeatureStore.createFromURL_WFST} when building stores for several
     * feature types from one capabilities fetch, or when the capabilities were already fetched
     * for another reason.
     *
     * Derives the service URLs, output format, supported HTTP methods, working CRS, and model
     * bounds from the feature type's own capabilities entry, applying any explicit overrides in
     * `options`.
     *
     * @param extended the previously-fetched capabilities.
     * @param typeName the feature type name to build a store for.
     * @param options  creation overrides - anything left unset is derived from capabilities.
     * @throws {ProgrammingError} if `typeName` doesn't match any feature type in the capabilities.
     * @returns the constructed store.
     */
    public static createFromCapabilities_WFST(extended: WFSCapabilitiesExtendedResult, typeName:string, options: WFSFeatureStoreCreateOptions & Pick<WFSTFeatureStoreConstructorOptions, 'verifyCircularGeometryRoundTrip'> = {}) {
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
            bounds: getModelBoundsFromCapabilities(match, reference),
            verifyCircularGeometryRoundTrip: options.verifyCircularGeometryRoundTrip
        };
        return new WFSTFeatureStore({...constructorOptions, wfst})
    }


    /**
     * Updates only `feature`'s properties (not its geometry) via a WFS-T Update transaction -
     * unlike {@link put}, this never prompts for a geometry-update confirmation, since none is
     * happening.
     *
     * @param feature the feature whose properties should be persisted; its geometry is sent
     *                 as-is, but the request is built with `onlyProperties: true`.
     * @returns a Promise resolving to the updated feature's id, or null if the update failed or
     *          the service reported zero updated features.
     */
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
     /**
      * Updates `feature` (geometry and properties) via a WFS-T Update transaction, after
      * confirming the change through {@link WFSTDelegateScreenHelper.confirmGeometryUpdate}.
      *
      * If {@link WFSTFeatureStoreConstructorOptions.verifyCircularGeometryRoundTrip} isn't
      * disabled and the shape is a Circle/Arc, re-queries the feature after the update and
      * asserts the server didn't silently degrade the geometry before reporting success - see
      * {@link assertGeometryRoundTrip}.
      *
      * @param feature the feature to persist (must already have a valid `id`).
      * @param options unused by this implementation.
      * @returns a Promise resolving to the updated feature's id, or null if the confirmation was
      *          declined, the update failed, the server reported zero updated features, or the
      *          round-trip check failed.
      */
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
                             return;
                         }
                         // Workaround removed
                         if (frozenFeature.id !== resourceId) console.warn(`Invalid ID response to put. Expected: ${frozenFeature.id} but got ${resourceId}`);
                         const finalizePutSuccess = () => {
                             eventSupport.emit("StoreChanged", "update", frozenFeature, frozenFeature.id);
                             resolve(feature.id);
                             this.delegateScreen.MessageSuccess(`[WFS-T] Total updated: ${totalUpdated}`);
                         };
                         // See add()'s matching comment - same silent-degradation risk applies to
                         // an edited Circle/Arc being re-saved.
                         if (this.options.verifyCircularGeometryRoundTrip !== false && shouldVerifyRoundTrip(frozenFeature.shape)) {
                             this.queryByRids([frozenFeature.id as string]).then(cursor => {
                                 try {
                                     assertGeometryRoundTrip(frozenFeature.shape, cursor && cursor.hasNext() ? cursor.next().shape : null);
                                     finalizePutSuccess();
                                 } catch (error) {
                                     resolve(null);
                                     this.delegateScreen.MessageError(`[WFS-T] Error: ${error.message}`);
                                 }
                             });
                         } else {
                             finalizePutSuccess();
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

    /**
     * Inserts `feature` via a WFS-T Insert transaction.
     *
     * Validates the feature's geometry type against the feature type's own schema
     * ({@link areCompatibleGeometries}) and its properties against the schema's required fields
     * ({@link standardizeProperties}) before sending anything - an incompatible geometry fails
     * immediately, and incomplete properties trigger
     * {@link WFSTDelegateScreenHelper.EditNewFeatureProperties} instead of a request.
     *
     * If {@link WFSTFeatureStoreConstructorOptions.verifyCircularGeometryRoundTrip} isn't disabled
     * and the shape is a Circle/Arc, re-queries the newly-inserted feature and asserts the server
     * didn't silently degrade the geometry (confirmed to happen against at least one real
     * LuciadFusion deployment) before reporting success.
     *
     * @param feature the feature to insert (its `id`, if any, is ignored - the server assigns one).
     * @param options unused by this implementation.
     * @returns a Promise resolving to the newly-assigned feature id, or null if validation failed,
     *          the insert failed, the server reported zero inserted features, or the round-trip
     *          check failed.
     */
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
                        return;
                    }
                    newFeature.id = resourceId;
                    const finalizeAddSuccess = () => {
                        eventSupport.emit("StoreChanged",  "add", newFeature, resourceId);
                        resolve(resourceId)
                        this.delegateScreen.MessageSuccess(`[WFS-T] Total inserted: ${totalInserted}`);
                    };
                    // Some servers (confirmed against a live LuciadFusion instance) accept a
                    // Circle/Arc Insert but silently degrade it into something unreadable on the
                    // very next GetFeature - re-query and bounds-check before reporting success,
                    // so that failure is loud and immediate rather than surfacing later, on
                    // reload, disconnected from this save.
                    if (this.options.verifyCircularGeometryRoundTrip !== false && shouldVerifyRoundTrip(feature.shape)) {
                        this.queryByRids([resourceId as string]).then(cursor => {
                            try {
                                assertGeometryRoundTrip(feature.shape, cursor && cursor.hasNext() ? cursor.next().shape : null);
                                finalizeAddSuccess();
                            } catch (error) {
                                resolve(null);
                                this.delegateScreen.MessageError(`[WFS-T] Error: ${error.message}`);
                            }
                        });
                    } else {
                        finalizeAddSuccess();
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

    /**
     * Delegates to {@link WFSFeatureStore.query} unchanged - overridden only so this subclass has
     * its own declared method (and return type) visible to consumers typed against it.
     */
    query(query?: WFSQueryOptions, options?: QueryOptions): Promise<Cursor<Feature>> {
        return super.query(query, options);
    }

    /**
     * Fetches a single feature by id.
     *
     * @param id      the feature id (as returned by e.g. {@link add}).
     * @param options unused by this implementation.
     * @returns a Promise resolving to the feature, or rejecting if no feature with that id exists.
     */
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

    /**
     * Fetches multiple features by id in one request (a WFS-T `GetFeature` query filtered by
     * resource id, not a Transaction).
     *
     * @param rids the feature ids to fetch.
     * @returns a Promise resolving to a cursor over the matched features (empty, not rejected, if
     *          none matched or the response couldn't be decoded).
     */
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

    /** Reports an HTTP 401 (Unauthorized) response via the screen helper. */
    private error401() {
        this.delegateScreen.MessageError(`WFS-T:\r\nUnauthorized`);
    }
    /** Reports an HTTP 500 (Internal Server Error) response via the screen helper. */
    private error500() {
        this.delegateScreen.MessageError(`WFS-T:\r\nInternal Server Error`);
    }

    /** Reports any HTTP error status not otherwise handled specifically ({@link error401}, {@link error500}, {@link error400}) via the screen helper. */
    private errorOther(response: Response) {
        this.delegateScreen.MessageError(`WFS-T:\r\nError Code ${response.status}`);
    }

    // Parameter kept error for future use:
    /**
     * Reports an unexpected/uncaught error via the screen helper. `error` is only logged to the
     * console today - kept as a parameter for a future, more specific message.
     */
    private errorUnknown(error?:any) {
        console.log(error);
        this.delegateScreen.MessageError(`WFS-T: Unknown Error`);
    }

    /**
     * Reports an HTTP 400 (Bad Request) response via the screen helper, parsing the response
     * body as a WFS `ExceptionReport` for a more specific message.
     */
    private error400(response: Response) {
        response.text().then(xmlText=>{
            const {exceptionCode, exceptionText} = WFSTResponses.parseExceptionReport(xmlText);
            this.delegateScreen.MessageError(`${exceptionCode}:\r\n${exceptionText}`);
        });
    }

    /**
     * Deletes a feature via a WFS-T Delete transaction.
     *
     * @param rid the id of the feature to delete.
     * @returns a Promise resolving to true once the server responds 200 (this does not check
     *          `totalDeleted` - unlike {@link add}/{@link put}, a zero-deleted response still
     *          resolves true), null if the server responds with a non-200 HTTP status, or false
     *          specifically on a network error (this method's only path that resolves false
     *          instead of null).
     */
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

    /**
     * Commits a set of locked edits (replaces the placeholder-owned features referenced by
     * `lockItem` with the caller's final versions) via a single combined WFS-T Insert/Update/
     * Delete transaction - the counterpart operation to {@link lockFeatures}.
     *
     * @param lockItem the lock item describing which features to replace, update, or delete - see
     *                 {@link WFSTEditFeatureLockItem}.
     * @returns a Promise resolving to a {@link CommitLockTransactionResult} summarizing how many
     *          features were inserted/updated/deleted/replaced.
     */
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

    /**
     * Fetches and parses this store's `DescribeFeatureType` schema, caching it on this instance
     * (see {@link getFeatureTemplate}) - called automatically by {@link add}/{@link put}/
     * {@link putProperties} the first time any of them runs, but callable directly to warm the
     * cache earlier.
     *
     * @returns a Promise resolving to the parsed {@link WFSFeatureDescription}. Note: unlike every
     *          other network call in this class, this one does not resolve on a network error -
     *          the returned Promise is left pending in that case (a pre-existing behavior,
     *          preserved as-is).
     */
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

    /**
     * Subscribes to this store's change events.
     *
     * @param event    currently only `"StoreChanged"` is supported.
     * @param callback invoked as `(type, feature, id)` where `type` is `"add"`/`"update"`/`"remove"`.
     * @returns a {@link Handle} - call `.remove()` on it to unsubscribe.
     */
    on(event: "StoreChanged", callback: any): Handle {
        return super.on(event, callback);
    }

    /**
     * Reaches into this store's own (and RIA's superclass's) private/untyped internal fields to
     * expose the handful this class's methods actually need - typeName, the POST endpoint,
     * output format, preferred WFS version, the event bus, axis-swap settings, and the working
     * reference. Centralizing the `as any` casts here keeps them out of every individual method.
     */
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
    /** The WFS-T operations this store's underlying service advertised in its capabilities. */
    get wfst(): WFSTOperationsKeys {
        return this._wfst;
    }

    /**
     * Builds a `fetch` `RequestInit` from this store's own configured headers/credentials merged
     * with a call-specific `Accept`/method/body.
     *
     * @param options method, body, and any call-specific headers (merged with, not replacing,
     *                this store's own `requestHeaders`).
     * @returns a `RequestInit` ready to pass to `fetch`.
     */
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

    /** @returns the cached {@link WFSFeatureDescription}, or null if {@link loadFeatureDescription} hasn't resolved yet. */
    getFeatureTemplate() {
        return this.featureTemplate;
    }

    /** Caches the parsed feature-type schema - see {@link getFeatureTemplate}, {@link loadFeatureDescription}. */
    private setFeatureTemplate(featureTemplate:  WFSFeatureDescription) {
        this.featureTemplate = featureTemplate;
    }

    /** @returns this store's WFS feature type name. */
    getTypeName() {
        const {typeName} = this.extractUtils();
        return typeName;
    }

    // RIA's own WFSFeatureStore has a working getReference() at runtime but never declares it in
    // its own public API (WFSFeatureStore.d.ts) - callers relying on it were silently depending on
    // an undocumented implementation detail, untyped and unchecked. Declaring it here shadows that
    // and gives it a real, typed, public contract - also brings this class into parity with
    // WFSTFeatureLockStore, which already has its own getReference().
    /**
     * RIA's own {@link WFSFeatureStore} has a working `getReference()` at runtime but never
     * declares it in its own public API (`WFSFeatureStore.d.ts`) - callers relying on it were
     * silently depending on an undocumented implementation detail, untyped and unchecked.
     * Declaring it here shadows that and gives it a real, typed, public contract - also brings
     * this class into parity with {@link WFSTFeatureLockStore}, which already has its own
     * `getReference()`.
     *
     * @returns the {@link CoordinateReference} this store's geometry is encoded/decoded in.
     */
    getReference(): CoordinateReference {
        return this.extractUtils().reference;
    }


    /**
     * Requests a temporary lock on `options.rids` and returns them as a single combined feature
     * for editing - the read-side counterpart to {@link lockFeatures}, returning richer
     * bookkeeping (matched/returned counts, timestamp) alongside the lock itself.
     *
     * @param options `rids` to lock, and an optional `expiry` in minutes (defaults to 5 in the
     *                returned item if omitted).
     * @returns a Promise resolving to a {@link WFSTEditGetFeatureWithLockItem} describing the lock
     *          and the locked features' ids, or rejecting if the lock request itself fails.
     */
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

    /**
     * Requests a lock on `options.rids` without fetching their data - use
     * {@link getFeatureWithLock} instead if the features' current content is also needed.
     *
     * @param options `rids` to lock, and an optional `expiry` in minutes (defaults to 5 in the
     *                returned item if omitted).
     * @returns a Promise resolving to a {@link WFSTEditFeatureLockItem} describing the lock, or
     *          rejecting if the lock request fails.
     */
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

    /**
     * @returns this store's constructor options with the non-serializable `codec` and `reference`
     *          fields stripped, e.g. for embedding into a {@link WFSTEditFeatureLockItem}'s
     *          `storeSettings` so a lock can later be resolved back to compatible store settings.
     */
    private cleanOptions():  WFSTFeatureStoreConstructorOptions {
        return {...this.options, codec: undefined, reference: undefined};
    }

    /**
     * Routes a non-200 HTTP response to the matching error reporter (401/500/400, or
     * {@link errorOther} for anything else) and resolves the caller's Promise with null.
     *
     * @param response the non-200 response.
     * @param resolve  the caller's Promise resolver, always called with null.
     * @param on400    an extra hook run only for 400 responses, after the default 400 handling
     *                 (e.g. {@link add} uses this to prompt for corrected properties).
     */
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
    /**
     * Shared by every network call in this class: fetches `url`, branches on HTTP 200 vs any
     * other status (defaulting to {@link handleOtherHttpErrors}), and catches network errors
     * (defaulting to resolving null and calling {@link errorUnknown}). Call-site-specific
     * behavior - a custom 400 handler, a different resolve value on network error, or no resolve
     * at all - is expressed via `overrides` rather than duplicating this whole shape at each call
     * site.
     *
     * @param url          the request URL.
     * @param fetchOptions method/body/headers - passed through {@link fetchSettingsOptions}.
     * @param resolve      the caller's Promise resolver, used by the default error paths.
     * @param onSuccess    called with the response body text on HTTP 200.
     * @param overrides    optional per-call overrides for the non-200 and network-error paths.
     */
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
    /**
     * Convenience wrapper over {@link request} for the common case: a WFS-T POST request with an
     * XML transaction body - every fetch call site in this class except
     * {@link loadFeatureDescription}'s GET goes through this.
     *
     * @param urlEndpoint the WFS-T POST endpoint.
     * @param postData    the transaction XML body.
     * @param resolve     the caller's Promise resolver.
     * @param onSuccess   called with the response body text on HTTP 200.
     * @param overrides   see {@link request}.
     */
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

    /** @returns a stable identity string for this store instance - see the static {@link WFSTFeatureStore.getWFSStoreIdentity} for the derivation. */
    public getWFSStoreidentity() {
      return WFSTFeatureStore.getWFSStoreIdentity(this.options);
    }

    /**
     * Derives a stable identity string for a store from its construction options, suitable as a
     * cache/registry key for "the same underlying WFS-T endpoint+feature type" (e.g. used by
     * {@link WFSTFeatureLocksStorage} to associate locks with the store that created them).
     *
     * @param store the constructor options to derive an identity from (typically `this.options`
     *              from an existing instance, via {@link WFSTFeatureStore.getWFSStoreidentity}).
     * @returns `"<beforeProxy or serviceURL>|<typeName>"`, trimmed.
     */
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

    /** @returns the {@link WFSTDelegateScreenHelper} currently handling this store's user-facing notifications. */
    public getScreenHelper() {
        return this.delegateScreen;
    }

    /** Replaces this store's {@link WFSTDelegateScreenHelper}, e.g. to route notifications into a custom UI instead of the default one. */
    public setScreenHelper(screenHelper: WFSTDelegateScreenHelper) {
        this.delegateScreen = screenHelper;
    }
}


/** A resolved {@link CoordinateReference} paired with the exact srsName string it came from - needed verbatim later when encoding outgoing GML. See {@link getReferenceForWFS}. */
interface ReferenceAndSrsName {
    reference: CoordinateReference;
    srsName?: string;
}

/**
 * Picks which {@link CoordinateReference} a new {@link WFSTFeatureStore} should use for
 * `featureType`, and the exact srsName string that reference came from (see
 * {@link ReferenceAndSrsName}), by comparing the WFS capabilities' advertised default/other
 * references against an optional caller-requested one.
 *
 * @param featureType   the feature type's capabilities entry, whose `defaultReference` and
 *                       `otherReferences` are used to build the candidate list.
 * @param userReference an explicit caller-requested reference, if any - honored only if the
 *                       service's capabilities actually support it (a warning is logged and the
 *                       raw user reference is used anyway, without a resolved srsName, if not).
 * @throws {ProgrammingError} if capabilities advertise no usable reference at all and no
 *                            `userReference` was given.
 * @returns the resolved reference and its srsName.
 */
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

/**
 * Resolves a capabilities-advertised CRS string to a {@link CoordinateReference}, trying it first
 * as a plain identifier (EPSG code, URN, etc.) and falling back to parsing it as Well-Known Text.
 *
 * @param referenceIdentifierOrWKT the string to resolve.
 * @returns the resolved reference, or undefined (with a logged warning) if neither
 *          interpretation succeeds.
 */
function getDataReference(referenceIdentifierOrWKT: string): CoordinateReference | undefined {
    if (isValidReferenceIdentifier(referenceIdentifierOrWKT)) return getReference(referenceIdentifierOrWKT);
    try {
        return parseWellKnownText(referenceIdentifierOrWKT)
    } catch (error) {
        console.warn(`WFSFeatureStore: reference unsupported: ${referenceIdentifierOrWKT}`)
    }
}

/**
 * Scans a feature type's `otherReferences` (from WFS capabilities) for one matching
 * `userReference`, or, if no `userReference` was given, simply returns the first one that
 * resolves at all.
 *
 * @param otherReferences the candidate srsName strings from capabilities.
 * @param userReference   an explicit reference to match against, if any.
 * @returns the first matching (or, with no `userReference`, first resolvable) reference and its
 *          srsName, or undefined if none matched/resolved.
 */
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

/** Regexes used to categorize an output-format MIME string as `"json"` or `"gml"` - see {@link getOutputType}. */
const FORMATS = {json: [RegExp("json", "i")], gml: [RegExp("gml", "i"), RegExp("text/xml", "i")]};
/** The output-format categories {@link getOutputType} distinguishes between. */
type FormatCategory = keyof typeof FORMATS;

/** @returns true if any of `formats` matches any of `patterns`. */
function hasFormatType(patterns: RegExp[], formats: string[]): boolean {
    return formats.some((format => patterns.some((pattern => pattern.test(format)))))
}

/**
 * @param formats the MIME strings a feature type's capabilities advertise as supported output
 *                formats.
 * @returns `"json"` if any advertised format looks JSON-like, else `"gml"` if any looks GML-like
 *          (checked in that order - json wins if both are present), else `"json"` as a fallback.
 */
function getOutputType(formats: string[] = []): FormatCategory {
    if (formats.length > 0) {
        if (hasFormatType(FORMATS.json, formats)) return "json";
        if (hasFormatType(FORMATS.gml, formats)) return "gml"
    }
    return "json"
}

/** @returns the first entry in `formats` matching `category`'s patterns, or undefined if none do. */
function getFirstFormatOfType(formats: string[], category: FormatCategory): string | undefined {
    return formats.find((format => FORMATS[category].some((pattern => pattern.test(format)))))
}

/** Default WFS 1.x GML output format MIME type, used when a service advertises no more specific one. */
const DEFAULT_OUTPUT_GML_WFS_1 = "text/xml; subtype=gml/3.1.1";
/** Default WFS 2.x GML output format MIME type, used when a service advertises no more specific one. */
const DEFAULT_OUTPUT_GML_WFS_2 = "application/gml+xml; version=3.2";
/** Default JSON output format MIME type, used when a service advertises no more specific one. */
const DEFAULT_OUTPUT_JSON = "application/json";

/**
 * Picks the actual output format string to request, preferring the service's own advertised
 * formats over these hardcoded defaults, and preferring GML over JSON only when the versions in
 * use are old enough that JSON support can't be assumed.
 *
 * @param versions the WFS protocol versions this store will use.
 * @param formats  the output formats the feature type's capabilities advertise as supported.
 * @returns the output format MIME string to request.
 */
function getOutputFormat(versions: WFSVersion[], formats: string[] = []): string {
    if ("json" === getOutputType(formats)) return formats.includes(DEFAULT_OUTPUT_JSON) ? DEFAULT_OUTPUT_JSON : getFirstFormatOfType(formats, "json") ?? DEFAULT_OUTPUT_JSON;
    if (versions.some((version => version === WFSVersion.V202 || version === WFSVersion.V200)) && formats.includes(DEFAULT_OUTPUT_GML_WFS_2)) return DEFAULT_OUTPUT_GML_WFS_2;
    if (versions.some((version => version === WFSVersion.V110 || version === WFSVersion.V100)) && formats.includes(DEFAULT_OUTPUT_GML_WFS_1)) return DEFAULT_OUTPUT_GML_WFS_1;
    return getFirstFormatOfType(formats, "gml") ?? DEFAULT_OUTPUT_GML_WFS_2
}

/**
 * Intersects the service's actually-supported HTTP methods with the caller's requested ones,
 * falling back to every supported method (with a warning) if the intersection is empty.
 *
 * @param supportedMethods the HTTP methods the service's capabilities advertise for GetFeature.
 * @param requestedMethods an optional caller preference to narrow down to.
 * @returns the methods to actually use.
 */
function mergeRequestMethods(supportedMethods: string[], requestedMethods?: string[]): string[] {
    if (!requestedMethods || !Array.isArray(requestedMethods) || !requestedMethods.length) return supportedMethods;
    const matched = supportedMethods.filter((method => requestedMethods.indexOf(method) > -1));
    if (0 === matched.length) {
        console.warn(`WFS service does not support request methods: ${requestedMethods.join(", ")}`);
        return supportedMethods
    }
    return matched
}

/**
 * @param featureType the feature type's capabilities entry, whose advertised WGS84 bounds (if
 *                     any) are reprojected into `reference`.
 * @param reference   the target reference to reproject into.
 * @returns the feature type's bounds in `reference`, or undefined if capabilities advertise none.
 */
function getModelBoundsFromCapabilities(featureType: WFSCapabilitiesFeatureType, reference: CoordinateReference) {
    const wgs84Bounds = featureType.getWGS84Bounds()[0];
    if (wgs84Bounds?.reference) return createTransformation(wgs84Bounds.reference, reference).transformBounds(wgs84Bounds)
}

/** Strips a single trailing `?` from a capabilities-advertised service URL, if present. */
function processServiceUrl(url: string): string {
    return "?" === url[url.length - 1] ? url.substring(0, url.length - 1) : url
}
