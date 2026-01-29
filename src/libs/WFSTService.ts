import { HttpRequestHeaders } from "@luciad/ria/util/HttpRequestOptions";
import { WFSFeatureDescription } from "./ParseWFSFeatureDescription";
import { WFSTProtocol } from "./WFSTProtocol";

/**
 * Common configuration for WFSTService requests.
 */
export interface WFSTServiceOptions {
    serviceURL: string;
    requestHeaders?: HttpRequestHeaders;
    credentials?: boolean;
}

/**
 * Service to handle all WFS-T network operations.
 * Consolidates fetch logic and WFS-T query generation.
 */
export class WFSTService {
    private options: WFSTServiceOptions;

    constructor(options: WFSTServiceOptions) {
        this.options = options;
    }

    /**
     * Internal method to handle fetch requests with standard options.
     */
    private async request(url: string, method: string, body?: string, customHeaders?: HttpRequestHeaders): Promise<Response> {
        const headers: Record<string, string> = {
            ...this.options.requestHeaders as Record<string, string>,
            ...customHeaders as Record<string, string>
        };

        const fetchOptions: RequestInit = {
            method,
            headers,
            credentials: this.options.credentials ? "same-origin" : "omit",
            body: (method === "POST" || method === "PUT" || method === "PATCH") ? body : undefined
        };

        return fetch(url, fetchOptions);
    }

    /**
     * Sends a DescribeFeatureType request.
     */
    public async describeFeatureType(typeName: string, version: string): Promise<string> {
        const url = `${this.options.serviceURL}?REQUEST=DescribeFeatureType&SERVICE=WFS&VERSION=${version}&typeNames=${typeName}`;
        const response = await this.request(url, "GET", undefined, {
            "Accept": "text/xml"
        });

        if (!response.ok) {
            throw response;
        }
        return response.text();
    }

    /**
     * Sends a WFS-T Transaction request.
     */
    public async transaction(postData: string): Promise<string> {
        const response = await this.request(this.options.serviceURL, "POST", postData, {
            "Accept": "text/xml",
            "Content-Type": "text/xml"
        });

        if (!response.ok) {
            throw response;
        }
        return response.text();
    }

    /**
     * Executes a GetFeature query by IDs.
     */
    public async getFeaturesById(typeName: string, rids: string[], outputFormat?: string): Promise<string> {
        const postData = WFSTProtocol.createGetFeatureByIdsQuery({
            typeName,
            rids,
            outputFormat
        });

        return this.transaction(postData);
    }
}
