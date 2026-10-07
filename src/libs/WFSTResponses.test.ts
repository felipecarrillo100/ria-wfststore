import {describe, expect, it} from 'vitest';
import {WFSTResponses} from "./WFSTResponses";

// Pure jsdom, no network. Servers are free to pick any prefix (or none) for the WFS 2.0
// namespace, so lock responses must be matched by namespace, not by the literal "wfs:" prefix.
const WFS = "http://www.opengis.net/wfs/2.0";

describe('WFSTResponses lock responses', () => {
    for (const [name, open, close] of [
        ["wfs: prefix", `<wfs:FeatureCollection xmlns:wfs="${WFS}"`, `</wfs:FeatureCollection>`],
        ["other prefix", `<w:FeatureCollection xmlns:w="${WFS}"`, `</w:FeatureCollection>`],
        ["default namespace", `<FeatureCollection xmlns="${WFS}"`, `</FeatureCollection>`],
    ]) {
        it(`parseXMLGetFeaturesWithLock: reads the lock id with a ${name}`, () => {
            const xml = `${open} lockId="L1" numberMatched="2" numberReturned="2" timeStamp="T">${close}`;
            expect(WFSTResponses.parseXMLGetFeaturesWithLock(xml)).toEqual({lockId: "L1", numberMatched: "2", numberReturned: "2", timeStamp: "T"});
        });
    }

    for (const [name, xml] of [
        ["wfs: prefix", `<wfs:LockFeatureResponse xmlns:wfs="${WFS}" lockId="L2"/>`],
        ["other prefix", `<w:LockFeatureResponse xmlns:w="${WFS}" lockId="L2"/>`],
        ["default namespace", `<LockFeatureResponse xmlns="${WFS}" lockId="L2"/>`],
    ]) {
        it(`parseXMLLockFeatures: reads the lock id with a ${name}`, () => {
            expect(WFSTResponses.parseXMLLockFeatures(xml).lockId).toBe("L2");
        });
    }
});
