import {WFSCapabilities, WFSCapabilitiesFromUrlOptions} from "@luciad/ria/model/capabilities/WFSCapabilities";
import {WFSCapabilitiesOperation} from "@luciad/ria/model/capabilities/WFSCapabilitiesOperation";

const WFSTOperationsAllowed = ["LockFeature", "Transaction", "GetFeatureWithLock"];

interface WFSTOperationsProperties {
    name: string;
    post: string;
    formats: string[];
}

export interface WFSTOperationsKeys {
    LockFeature?: WFSTOperationsProperties;
    Transaction?: WFSTOperationsProperties;
    GetFeatureWithLock?: WFSTOperationsProperties;
}

export interface WFSTExtendedProperties {
    WFSTCapable: boolean
    WFSTOperations: WFSTOperationsKeys;
}

export interface WFSCapabilitiesExtendedResult {
    wfsCapabilities: WFSCapabilities;
    wfstCapabilities: WFSTExtendedProperties;
}

export class WFSCapabilitiesExtended {

    static getServiceOperation(
        capabilities:  WFSCapabilities,
        operationName: string
    ): WFSCapabilitiesOperation {
        return capabilities.operations.find(o => o && o.name === operationName);
    }

    static getServiceUrl(operation: any, method: string) {
        if (!operation) {
            return null;
        }

        const request = operation.supportedRequests.filter((r: any) => {
            return r.method === method;
        })[0];

        if (request) {
            return request.url;
        }
    }

    static getWFSTCapabilities(inputResult: WFSCapabilities): WFSTExtendedProperties {
        const WFSTOperations: WFSTOperationsKeys = {};
        const result = inputResult as any;

        if (result?._parser?._raw?.WFS_Capabilities?.OperationsMetadata?.Operation) {
            const wfstOperations = result._parser._raw.WFS_Capabilities.OperationsMetadata.Operation.filter((op: {
                name: string,
                DCP: any[],
                Parameter: any[]
            }) => WFSTOperationsAllowed.includes(op.name));
            for (const op of wfstOperations) {
                const post = op.DCP[0].HTTP.Post.href;
                const formats = op.Parameter ? op.Parameter[0].AllowedValues.Value : [];
                // @ts-ignore
                WFSTOperations[op.name] = {name: op.name, post, formats}
            }
            const WFSTCapable = typeof WFSTOperations.Transaction !== "undefined";

            // Workaround
            return {
                WFSTCapable,
                WFSTOperations
            };
        }
        return {
            WFSTCapable: false,
            WFSTOperations
        };
    }

    static fromURL(url: string, options?: WFSCapabilitiesFromUrlOptions): Promise<WFSCapabilitiesExtendedResult> {
        return new Promise<WFSCapabilitiesExtendedResult>((resolve, reject)=>{
            WFSCapabilities.fromURL(url, options).then((wfsCapabilities)=>{
                const wfstCapabilities = this.getWFSTCapabilities(wfsCapabilities);
                resolve({
                    wfsCapabilities, wfstCapabilities
                });
            }).catch(reject);
        })
    }


}
