import { describe, expect, it } from '@jest/globals';
import "isomorphic-fetch";
import { WFSCapabilitiesExtended, WFSCapabilitiesExtendedResult } from "./WFSCapabilitiesExtended";

describe('OgcOpenApiGetCapabilities', () => {

    it('OgcOpenApiGetCapabilities.fromURL leu-gsp-vrndp06:8080/geoserver', async () => {
        return WFSCapabilitiesExtended.fromURL("http://leu-gsp-vrndp06.ingrnet.com:8080/geoserver/ows").then(({ wfstCapabilities }: WFSCapabilitiesExtendedResult) => {
            // testing geoserver
            expect(wfstCapabilities.WFSTCapable).toBe(true);
        }, () => {
            expect(false).toBe(true);
        })
    });

    it('OgcOpenApiGetCapabilities.fromURL leu-gsp-vrndp06:8080/geoserver', async () => {
        return WFSCapabilitiesExtended.fromURL("http://leu-gsp-vrndp06.ingrnet.com:8080/geoserver/ows").then(({ wfstCapabilities }: WFSCapabilitiesExtendedResult) => {
            // testing geoserver
            const expected = {
                "LockFeature": {},
                "GetFeatureWithLock": {},
                "Transaction": {}
            };
            expect(wfstCapabilities.WFSTOperations).toMatchObject(expected);
        }, () => {
            expect(false).toBe(true);
        })
    });

    it('OgcOpenApiGetCapabilities.fromURL sampleservices.luciad.com/wfs', async () => {
        return WFSCapabilitiesExtended.fromURL("https://sampleservices.luciad.com/wfs").then(({ wfstCapabilities }: WFSCapabilitiesExtendedResult) => {
            // testing sampleservices
            expect(wfstCapabilities.WFSTCapable).toBe(false);
        }, () => {
            expect(false).toBe(true);
        })
    });

});


