import { create } from 'xmlbuilder2';
import { encodeGeometryToGML } from "./encodeGeometryToGML";
import { GMLGeometry } from "./GMLGeometry";

/**
 * Representation of a feature for GML encoding.
 */
export interface GMLFeature {
    /** Unique ID of the feature. */
    id: string;
    /** Feature type discriminator. */
    type?: "Feature";
    /** Geometry component of the feature. */
    geometry: GMLGeometry;
    /** Key-value pairs of feature properties. */
    properties: { [key: string]: string };
}

/** Configuration for feature encoding. */
interface EncodeFeatureToGMLOptions {
    /** Use gml:posList instead of gml:pos for coordinate sequences. */
    usePosList?: boolean;
    /** Invert longitude/latitude axis order. */
    invert?: boolean;
    /** Target GML version. */
    gmlVersion?: '3.2' | '3.1.1';
}

/**
 * Encodes a feature object into a GML XML string (3.2 or 3.1.1).
 */
export function encodeFeatureToGML(feature: GMLFeature, options: EncodeFeatureToGMLOptions = {}): string {
    const doc = create({ version: '1.0', encoding: 'UTF-8' });
    const gmlVersion = options.gmlVersion || '3.2';
    const xmlns = gmlVersion === '3.1.1' ? 'http://www.opengis.net/gml' : 'http://www.opengis.net/gml/3.2';

    const featureElement = doc.ele('gml:Feature', {
        'gml:id': feature.id,
        'xmlns:gml': xmlns
    });

    // Encode properties
    for (const key in feature.properties) {
        if (feature.hasOwnProperty(key) && key !== "id" && key !== "geometry") {
            const value = feature.properties[key];
            featureElement.ele('gml:' + key).txt(value).up();
        }
    }

    // Encode geometry
    const geometryElement = featureElement.ele('geometry');
    encodeGeometryToGML(feature.geometry, { ...options, gmlVersion, inDoc: geometryElement });

    return doc.end({ prettyPrint: false });
}

