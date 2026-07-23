import {create} from 'xmlbuilder2';
import {XMLBuilder} from "xmlbuilder2/lib/interfaces";
import {encodeGeometryToGML} from "./encodeGeometryToGML";
import {GMLGeometry} from "./GMLGeometry";

// Define types for geometries and features

/** The internal, GeoJSON-Feature-shaped representation {@link encodeFeatureToGML} consumes - built by {@link GMLFeatureEncoder}/{@link AdvancedGMLCodec}. */
export interface GMLFeature {
    id: string;
    type?: "Feature";
    geometry: GMLGeometry;
    properties: {[key:string]: string};
}

/** Options for {@link encodeFeatureToGML}. */
export interface EncodeFeatureToGMLOptions {
    usePosList?: boolean;
    invert?: boolean;
    gmlVersion?: '3.2' | '3.1.1';
    /** An existing element to append the encoded `<gml:Feature>` into, instead of starting a new standalone document. */
    inDoc?: XMLBuilder;
    // See EncodeGeometryToGMLOptions.mode3D in encodeGeometryToGML.ts: true/false forces 3D/2D,
    // undefined auto-detects from the geometry's own coordinates.
    /** See `EncodeGeometryToGMLOptions.mode3D` in `encodeGeometryToGML.ts`: true/false forces 3D/2D, undefined auto-detects from the geometry's own coordinates. */
    mode3D?: boolean;
}

// Function to encode a feature to GML 3.2
/**
 * Encodes a {@link GMLFeature} into a `<gml:Feature>` element: its properties as `app:`-namespaced
 * child elements, and its geometry (delegated to {@link encodeGeometryToGML}) wrapped in a plain
 * `<geometry>` element.
 *
 * @param feature the feature to encode.
 * @param options see {@link EncodeFeatureToGMLOptions}.
 * @returns the encoded XML - a full standalone document (own XML declaration) when `options.inDoc`
 *          is omitted, or just the appended fragment's serialization when it's supplied.
 */
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

