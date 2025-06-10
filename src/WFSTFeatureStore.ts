import {WFSFeatureStore, WFSFeatureStoreConstructorOptions} from "@luciad/ria/model/store/WFSFeatureStore";
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
import {WFSTOperationsKeys} from "./WFSCapabilitiesExtended";
import {WFSTDelegateScreenHelper} from "./libs/screen/WFSTDelegateScreenHelper";

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
                                //  Temporarily workaround: This should be removed once LuciadRIA fixes bug with labels February/2025
                                eventSupport.emit("StoreChanged", "remove", undefined, frozenFeature.id);
                                setTimeout(()=>{
                                    //  Temporarily workaround: This should be removed once LuciadFusion fixes the issue auto-generated id incremented on update
                                    frozenFeature.id = resourceId;
                                    // eventSupport.emit("StoreChanged",  "update", feature, resourceId);
                                    eventSupport.emit("StoreChanged",  "add", frozenFeature, resourceId);
                                    resolve(feature.id);
                                    this.delegateScreen.MessageSuccess(`[WFS-T] Total updated: ${totalUpdated}`);
                                }, 33);
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
                                     //  Temporarily workaround: This should be removed once LuciadRIA fixes bug with labels February/2025
                                     eventSupport.emit("StoreChanged", "remove", undefined, frozenFeature.id);
                                     setTimeout(()=>{
                                         //  Temporarily workaround: This should be removed once LuciadFusion fixes the issue auto-generated id incremented on update
                                         frozenFeature.id = resourceId;
                                         // eventSupport.emit("StoreChanged", "update", feature, resourceId);
                                         eventSupport.emit("StoreChanged",  "add", frozenFeature, resourceId);
                                         resolve(feature.id);
                                         this.delegateScreen.MessageSuccess(`[WFS-T] Total updated: ${totalUpdated}`);
                                     }, 33);
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


