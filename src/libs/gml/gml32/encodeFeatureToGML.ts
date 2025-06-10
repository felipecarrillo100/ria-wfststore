import {create} from 'xmlbuilder2';
import {encodeGeometryToGML} from "./encodeGeometryToGML";
import {GMLGeometry} from "./GMLGeometry";

// Define types for geometries and features

export interface GMLFeature {
    id: string;
    type?: "Feature";
    geometry: GMLGeometry;
    properties: {[key:string]: string};
}

interface EncodeFeatureToGMLOptions {
    usePosList?: boolean;
    invert?: boolean;
    gmlVersion?: '3.2' | '3.1.1';
}

// Function to encode a feature to GML 3.2
export function encodeFeatureToGML(feature: GMLFeature, options?: EncodeFeatureToGMLOptions): string {
    options = options ? options : {};
    const doc = create({ version: '1.0', encoding: 'UTF-8' });
    const gmlVersion = options.gmlVersion || '3.2';

    const xmlns = gmlVersion === '3.1.1' ? 'http://www.opengis.net/gml' : 'http://www.opengis.net/gml/3.2';
    const featureElement = doc.ele('gml:Feature', {
        'gml:id': feature.id,
        'xmlns:gml': xmlns
    });

    for (const key in feature.properties) {
        if (feature.hasOwnProperty(key) && key!=="id" && key!=="geometry") {
            const referenceValue =  key;
            const value = feature.properties[key];
            featureElement.ele('gml:'+referenceValue).txt(value).up();
        }
    }

    const geometryElement = featureElement.ele('geometry');
    encodeGeometryToGML(feature.geometry, {...options, gmlVersion, inDoc:geometryElement })
    return doc.end({ prettyPrint: false });
}

