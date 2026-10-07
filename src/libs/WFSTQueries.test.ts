import {describe, expect, it} from 'vitest';
import {WFSTQueries} from "./WFSTQueries";
import {WFSFeatureDescription} from "./ParseWFSFeatureDescription";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {createPoint} from "@luciad/ria/shape/ShapeFactory";
import {Feature} from "@luciad/ria/model/feature/Feature";

// Pure jsdom, no network: checks the request XML these builders produce.

const reference = getReference("EPSG:4326");

const featureDescription: WFSFeatureDescription = {
    geometry: {name: "geom", type: "gml:PointPropertyType"},
    properties: [{name: "label", type: "xsd:string"}],
    feature: null,
    tns: "http://example.com/tns",
    shortTns: "tns"
};

function parse(xml: string) {
    return new DOMParser().parseFromString(xml, "application/xml");
}

describe('WFSTQueries XML escaping', () => {
    const tricky = `A&B <b>x</b> "q" 'a'`;

    it('Insert: a property value with markup characters is sent as plain text', () => {
        const feature = new Feature(createPoint(reference, [1, 2]), {label: tricky}, "t.1");
        const xml = WFSTQueries.TransactionAddRequest2_0_0({typeName: "tns:t", feature, featureDescription});
        const doc = parse(xml);

        expect(doc.getElementsByTagName("parsererror").length).toBe(0);
        expect(doc.getElementsByTagName("b").length).toBe(0);
        expect(doc.getElementsByTagNameNS("http://example.com/tns", "label")[0].textContent).toBe(tricky);
    });

    it('Update: a property value with markup characters is sent as plain text', () => {
        const feature = new Feature(createPoint(reference, [1, 2]), {label: tricky}, "t.1");
        const xml = WFSTQueries.TransactionUpdateRequest2_0_0({typeName: "tns:t", feature, featureDescription, onlyProperties: true});
        const doc = parse(xml);

        expect(doc.getElementsByTagName("b").length).toBe(0);
        expect(doc.getElementsByTagNameNS("http://www.opengis.net/wfs/2.0", "Value")[0].textContent).toBe(tricky);
    });

    it('Insert: an injection attempt does not add elements to the transaction', () => {
        const injection = `</tns:label><tns:evil>1</tns:evil><tns:label>`;
        const feature = new Feature(createPoint(reference, [1, 2]), {label: injection}, "t.1");
        const doc = parse(WFSTQueries.TransactionAddRequest2_0_0({typeName: "tns:t", feature, featureDescription}));

        expect(doc.getElementsByTagNameNS("http://example.com/tns", "evil").length).toBe(0);
        expect(doc.getElementsByTagNameNS("http://example.com/tns", "label")[0].textContent).toBe(injection);
    });

    it('Delete: a resource id with a quote stays inside its attribute', () => {
        const rid = `t.1"/><fes:ResourceId rid="t.2`;
        const doc = parse(WFSTQueries.TransactionDeleteRequest2_0_0({typeName: "tns:t", rid}));
        const resourceIds = doc.getElementsByTagNameNS("http://www.opengis.net/fes/2.0", "ResourceId");

        expect(resourceIds.length).toBe(1);
        expect(resourceIds[0].getAttribute("rid")).toBe(rid);
    });
});
