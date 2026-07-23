import {WFSCapabilities, WFSCapabilitiesFromUrlOptions} from "@luciad/ria/model/capabilities/WFSCapabilities";
import {WFSCapabilitiesOperation} from "@luciad/ria/model/capabilities/WFSCapabilitiesOperation";

/** The WFS-T operation names this library recognizes - anything else in a capabilities document's `OperationsMetadata` is ignored by {@link WFSCapabilitiesExtended.getWFSTCapabilities}. */
const WFSTOperationsAllowed = ["LockFeature", "Transaction", "GetFeatureWithLock"];

/** One WFS-T operation's advertised POST endpoint and supported output formats, as parsed from a capabilities document. */
interface WFSTOperationsProperties {
    name: string;
    post: string;
    formats: string[];
}

/** Which WFS-T operations a service advertises support for, keyed by operation name - absent keys mean the service doesn't support that operation at all. */
export interface WFSTOperationsKeys {
    LockFeature?: WFSTOperationsProperties;
    Transaction?: WFSTOperationsProperties;
    GetFeatureWithLock?: WFSTOperationsProperties;
}

/** The WFS-T-specific subset of a service's capabilities, as extracted by {@link WFSCapabilitiesExtended.getWFSTCapabilities}. */
export interface WFSTExtendedProperties {
    /** True if the service advertises `Transaction` support (i.e. supports Insert/Update/Delete via WFS-T), independent of lock support. */
    WFSTCapable: boolean
    /** The individual WFS-T operations advertised, if any. */
    WFSTOperations: WFSTOperationsKeys;
}

/** The combined result of fetching a WFS capabilities document and extracting its WFS-T-specific subset - see {@link WFSCapabilitiesExtended.fromURL}. */
export interface WFSCapabilitiesExtendedResult {
    /** The full, unmodified capabilities document as parsed by RIA's own `WFSCapabilities`. */
    wfsCapabilities: WFSCapabilities;
    /** The WFS-T-specific subset extracted from it - see {@link WFSTExtendedProperties}. */
    wfstCapabilities: WFSTExtendedProperties;
}

/**
 * Fetches and extracts WFS-T-specific information from a WFS capabilities document that RIA's own
 * {@link WFSCapabilities} doesn't expose directly (which operations - Transaction, LockFeature,
 * GetFeatureWithLock - the service actually advertises, and their POST endpoints/formats).
 *
 * {@link WFSTFeatureStore.createFromURL_WFST}/{@link WFSTFeatureStore.createFromCapabilities_WFST}
 * are the usual way this ends up getting used - most consumers won't need to call this directly
 * unless they want to inspect WFS-T support before constructing a store.
 */
export class WFSCapabilitiesExtended {

    /** @returns the named operation from a capabilities document's `operations` list, or undefined if it isn't advertised. */
    static getServiceOperation(
        capabilities:  WFSCapabilities,
        operationName: string
    ): WFSCapabilitiesOperation {
        return capabilities.operations.find(o => o && o.name === operationName);
    }

    /**
     * @param operation an operation as returned by {@link getServiceOperation} (or any object with
     *                  the same `supportedRequests` shape).
     * @param method    the HTTP method to look up, e.g. `"GET"` or `"POST"`.
     * @returns the operation's endpoint URL for that method, or null/undefined if `operation` is
     *          falsy or doesn't advertise that method.
     */
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

    /**
     * Parses the WFS-T-specific operations (`LockFeature`, `Transaction`, `GetFeatureWithLock` -
     * see {@link WFSTOperationsAllowed}) out of a capabilities document's raw
     * `OperationsMetadata`, which RIA's own {@link WFSCapabilities} parses but doesn't expose a
     * typed accessor for.
     *
     * @param inputResult the capabilities document to extract from.
     * @returns the WFS-T operations found (empty if none), and whether the service is
     *          `WFSTCapable` (advertises `Transaction` specifically).
     */
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

    /**
     * Fetches the WFS capabilities document at `url` and extracts its WFS-T-specific subset in
     * one call - the combination of RIA's own `WFSCapabilities.fromURL` and
     * {@link getWFSTCapabilities}.
     *
     * @param url     the WFS service's base URL.
     * @param options passed through to RIA's own `WFSCapabilities.fromURL`.
     * @returns a Promise resolving to both the full capabilities and the extracted WFS-T subset.
     */
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
