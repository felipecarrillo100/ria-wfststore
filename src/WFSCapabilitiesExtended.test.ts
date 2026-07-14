import { describe, expect, it } from 'vitest';
import {WFSCapabilitiesExtended, WFSCapabilitiesExtendedResult} from "./WFSCapabilitiesExtended";

describe('OgcOpenApiGetCapabilities',  () => {

    it('OgcOpenApiGetCapabilities.fromURL localhost:8081/geoserver', async () => {
        return WFSCapabilitiesExtended.fromURL("http://localhost:8081/geoserver/ows").then(({wfsCapabilities, wfstCapabilities}:WFSCapabilitiesExtendedResult)=>{
            // testing geoserver
            expect(wfstCapabilities.WFSTCapable).toBe(true);
        }, ()=>{
            expect(false).toBe(true);
        })
    });

    it('OgcOpenApiGetCapabilities.fromURL localhost:8081/geoserver', async () => {
        return WFSCapabilitiesExtended.fromURL("http://localhost:8081/geoserver/ows").then(({wfsCapabilities, wfstCapabilities}:WFSCapabilitiesExtendedResult)=>{
            // testing geoserver
            const expected = {
                "LockFeature": {},
                "GetFeatureWithLock": {},
                "Transaction": {}
            };
            expect(wfstCapabilities.WFSTOperations).toMatchObject(expected);
        }, ()=>{
            expect(false).toBe(true);
        })
    });

    it('OgcOpenApiGetCapabilities.fromURL sampleservices.luciad.com/wfs', async () => {
        return WFSCapabilitiesExtended.fromURL("https://sampleservices.luciad.com/wfs").then(({wfsCapabilities, wfstCapabilities}:WFSCapabilitiesExtendedResult)=>{
            // testing sampleservices
            expect(wfstCapabilities.WFSTCapable).toBe(false);
        }, ()=>{
            expect(false).toBe(true);
        })
    });

});


