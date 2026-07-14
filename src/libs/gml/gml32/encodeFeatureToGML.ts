import {create} from 'xmlbuilder2';
import {XMLBuilder} from "xmlbuilder2/lib/interfaces";
import {encodeGeometryToGML} from "./encodeGeometryToGML";
import {GMLGeometry} from "./GMLGeometry";

// Define types for geometries and features

export interface GMLFeature {
    id: string;
    type?: "Feature";
    geometry: GMLGeometry;
    properties: {[key:string]: string};
}

export interface EncodeFeatureToGMLOptions {
    usePosList?: boolean;
    invert?: boolean;
    gmlVersion?: '3.2' | '3.1.1';
    inDoc?: XMLBuilder;
    // See EncodeGeometryToGMLOptions.mode3D in encodeGeometryToGML.ts: true/false forces 3D/2D,
    // undefined auto-detects from the geometry's own coordinates.
    mode3D?: boolean;
}

// Function to encode a feature to GML 3.2
export function encodeFeatureToGML(feature: GMLFeature, options?: EncodeFeatureToGMLOptions): string {
    options = options ? options : {};
    const doc = options.inDoc ? options.inDoc : create({ version: '1.0', encoding: 'UTF-8' });
    const gmlVersion = options.gmlVersion || '3.2';

    const xmlns = gmlVersion === '3.1.1' ? 'http://www.opengis.net/gml' : 'http://www.opengis.net/gml/3.2';
    // Application properties are declared in their own namespace, not gml: - the gml namespace is
    // reserved for GML's own vocabulary, and a real GML/decode implementation may (correctly) treat
    // any gml:-namespaced child of a feature as structural rather than as feature data.
    const featureElement = doc.ele('gml:Feature', {
        'gml:id': feature.id,
        'xmlns:app': 'http://ria-wfststore/gml/app',
        // Only declare xmlns:gml when standalone; in inDoc mode the caller declares it once on an ancestor.
        ...(options.inDoc ? {} : {'xmlns:gml': xmlns})
    });

    for (const key in feature.properties) {
        if (feature.properties.hasOwnProperty(key) && key!=="id" && key!=="geometry") {
            const referenceValue =  key;
            const value = feature.properties[key];
            featureElement.ele('app:'+referenceValue).txt(value).up();
        }
    }

    const geometryElement = featureElement.ele('geometry');
    encodeGeometryToGML(feature.geometry, {...options, gmlVersion, inDoc:geometryElement })
    return doc.end({ prettyPrint: false });
}

