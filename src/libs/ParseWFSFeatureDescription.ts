// Define a type for the extracted element information

// Define a mapping from XSD types to JSON types
import {Feature} from "@luciad/ria/model/feature/Feature";

/**
 * The geometry type names this library distinguishes between when validating a feature's
 * geometry against a WFS feature type's schema - see {@link areCompatibleGeometries}.
 */
export type GeoJSONGeometryType =
    "Point" |
    "LineString" |
    "Polygon" |
    "MultiPoint" |
    "MultiLineString" |
    "MultiPolygon" |
    "GeometryCollection" |
    // Not actual GeoJSON types - GMLFeatureEncoder.getGeometryTypeName() returns these for
    // Circle/Arc shapes (which GeoJSON can't represent at all), so areCompatibleGeometries can
    // validate them the same way as everything else.
    "Circle" |
    "Arc";

/** The JSON Schema primitive types an XSD property type can map to - see {@link xsdToJsonMap}. */
export type BasicJSONSchema7TypeName = "string" | "number" | "boolean";
/** Maps every XSD simple type this library recognizes in a `DescribeFeatureType` schema to its JSON Schema equivalent - see {@link mapXsdTypeToJsonType}. */
export const xsdToJsonMap: { [key: string]: BasicJSONSchema7TypeName } = {
    // String mappings
    "xsd:string": "string",
    "xsd:duration": "string",
    "xsd:dateTime": "string",
    "xsd:time": "string",
    "xsd:date": "string",
    "xsd:gYearMonth": "string",
    "xsd:gMonthDay": "string",
    "xsd:gDay": "string",
    "xsd:gMonth": "string",
    "xsd:hexBinary": "string",
    "xsd:base64Binary": "string",
    "xsd:anyURI": "string",
    "xsd:QName": "string",
    "xsd:NOTATION": "string",

    // Number mappings
    "xsd:decimal": "number",
    "xsd:float": "number",
    "xsd:double": "number",
    "xsd:int": "number",
    "xsd:integer": "number",
    "xsd:gYear": "number",
    "xsd:nonPositiveInteger": "number",
    "xsd:negativeInteger": "number",
    "xsd:long": "number",
    "xsd:short": "number",
    "xsd:byte": "number",
    "xsd:nonNegativeInteger": "number",
    "xsd:unsignedLong": "number",
    "xsd:unsignedInt": "number",
    "xsd:unsignedShort": "number",
    "xsd:unsignedByte": "number",
    "xsd:positiveInteger": "number",

    // Boolean mappings
    "xsd:boolean": "boolean"
};
/** Any XSD simple type key {@link xsdToJsonMap} recognizes. */
export type XSDTypeKey = keyof typeof xsdToJsonMap;

/** The GML geometry property type names this library recognizes in a `DescribeFeatureType` schema - see {@link GMLGeometryTypeToGeometry}. */
export type GMLGeometryNames = "Point" | "LineString" | "Polygon" | "MultiPoint" | "MultiLineString" | "MultiPolygon" | "Geometry" | "MultiGeometry" | "MultiSurface" | "MultiCurve";
/** Maps a schema's `gml:*PropertyType` attribute value to the plain geometry name it represents - see {@link GMLGeometryTypeToGeometry}, {@link areCompatibleGeometries}. */
const gmlToJSONGeometry: { [key: string]: GMLGeometryNames } = {
    // String mappings
    "gml:PointPropertyType": "Point",
    "gml:LineStringPropertyType": "LineString",
    "gml:PolygonPropertyType": "Polygon",
    "gml:MultiPointPropertyType": "MultiPoint",
    "gml:MultiLineStringPropertyType": "MultiLineString",
    "gml:MultiPolygonPropertyType": "MultiPolygon",
    "gml:GeometryPropertyType": "Geometry",
    "gml:MultiGeometryPropertyType": "MultiGeometry",
    "gml:MultiCurvePropertyType": "MultiCurve",
    // Added for geoserver
    "gml:MultiSurfacePropertyType": "MultiSurface",
}
/** Any GML geometry property type key {@link gmlToJSONGeometry} recognizes. */
export type GMLGeometryTypeKey = keyof typeof xsdToJsonMap;

/**
 * @param key a schema's `gml:*PropertyType` attribute value.
 * @returns the plain geometry name it represents.
 * @throws {Error} if `key` isn't a recognized GML geometry property type.
 */
export function GMLGeometryTypeToGeometry(key: GMLGeometryTypeKey) {
    if (typeof gmlToJSONGeometry[key] !== "undefined") return gmlToJSONGeometry[key] as GMLGeometryNames;
    throw new Error('Unsupported target geometry type');
}

/** One non-geometry (`xsd:*`-typed) element from a feature type's `DescribeFeatureType` schema. */
export interface XsdElement {
    name?: string;
    type?: XSDTypeKey;
    minOccurs?: number;
    substitutionGroup?: string;
}

/** Like {@link XsdElement}, but for the geometry element specifically (`gml:*`-typed instead of `xsd:*`-typed). */
interface XsdGeometryElement {
    name?: string;
    type?: GMLGeometryTypeKey;
    minOccurs?: number;
    substitutionGroup?: string;
}


/**
 * A feature type's parsed `DescribeFeatureType` schema - which element is the geometry, which
 * are plain properties, the feature element itself, and the type's namespace. Produced by
 * {@link parseWFSFeatureDescription}; consumed throughout {@link WFSTFeatureStore} to validate
 * and encode features against the actual schema the service advertises.
 */
export interface WFSFeatureDescription {
    geometry: XsdGeometryElement;
    properties: XsdElement[];
    feature: XsdElement;
    tns: string;
    shortTns: string;
}

/**
 * Parses a WFS `DescribeFeatureType` response into a {@link WFSFeatureDescription}: finds the
 * `xsd:extension` of `gml:AbstractFeatureType` for this feature type, then splits its child
 * elements into the geometry element (any `gml:`-typed one) and the plain properties (any
 * `xsd:`-typed ones).
 *
 * @param xmlContent the raw `DescribeFeatureType` XML response body.
 * @returns the parsed schema. If the expected `gml:AbstractFeatureType` extension isn't found at
 *          all, returns a description with `geometry`/`feature`/`shortTns` all null and
 *          `properties` empty, rather than throwing.
 */
export function parseWFSFeatureDescription(xmlContent: string): WFSFeatureDescription {
    // Create a new DOMParser instance
    const parser = new DOMParser();

    // Parse the XML content
    const xmlDoc = parser.parseFromString(xmlContent, "application/xml");
    const schemaElement = xmlDoc.documentElement;
    const targetNamespace = schemaElement.getAttribute("targetNamespace");

    // Find the xsd:extension element with base="gml:AbstractFeatureType"
    const extensions = xmlDoc.getElementsByTagNameNS("http://www.w3.org/2001/XMLSchema", "extension");
    let targetExtension: Element | null = null;

    for (const extension of extensions) {
        if (extension.getAttribute("base") === "gml:AbstractFeatureType") {
            targetExtension = extension;
            break;
        }
    }

    // If the target extension is not found, return an empty array
    if (!targetExtension) {
        return {
            geometry: null,
            properties: [],
            feature: null,
            tns: targetNamespace || null,
            shortTns: null
        };
    }

    // Get all xsd:element elements within the target extension
    const sequence = targetExtension.getElementsByTagNameNS("http://www.w3.org/2001/XMLSchema", "sequence")[0];
    const elements = sequence.getElementsByTagNameNS("http://www.w3.org/2001/XMLSchema", "element");

    const result: XsdElement[] = [];

    // Iterate through each element and extract relevant attributes
    for (const element of elements) {
        const elementObj: XsdElement = {};
        // Extract attributes
        if (element.hasAttribute("name")) {
            elementObj.name = element.getAttribute("name");
        }
        if (element.hasAttribute("type")) {
            elementObj.type = element.getAttribute("type");
        }
        if (element.hasAttribute("minOccurs")) {
            elementObj.minOccurs = Number(element.getAttribute("minOccurs"));
        }
        if (element.hasAttribute("substitutionGroup")) {
            elementObj.substitutionGroup = element.getAttribute("substitutionGroup");
        }

        result.push(elementObj);
    }

    // Filter geometry and properties
    const geometry = result.filter(e => typeof e.type === "string" && (e.type as string).startsWith("gml:")) as XsdGeometryElement[];
    const properties = result.filter(e => typeof e.type === "string" && (e.type as string).startsWith("xsd:"));

    // Find elements with substitutionGroup="gml:AbstractFeature"
    const abstractFeatureElements = Array.from(xmlDoc.getElementsByTagNameNS("http://www.w3.org/2001/XMLSchema", "element"))
        .filter(e => e.getAttribute("substitutionGroup") === "gml:AbstractFeature")
        .map(e => {
            const elementObj: XsdElement = {};
            if (e.hasAttribute("name")) {
                elementObj.name = e.getAttribute("name");
            }
            if (e.hasAttribute("type")) {
                elementObj.type = e.getAttribute("type");
            }
            if (e.hasAttribute("minOccurs")) {
                elementObj.minOccurs = Number(e.getAttribute("minOccurs"));
            }
            if (e.hasAttribute("substitutionGroup")) {
                elementObj.substitutionGroup = e.getAttribute("substitutionGroup");
            }
            return elementObj;
        });

    const feature = abstractFeatureElements[0] || null;
    const shortTns = feature && typeof feature.type === "string" ? (feature.type as string).split(":")[0] : null;
    return {
        geometry: geometry[0] || null,
        properties,
        feature: abstractFeatureElements[0] || null,
        tns: targetNamespace || null,
        shortTns
    };
}


/**
 * Builds an empty properties object matching `featureDescription`'s schema, with every property
 * defaulted per its JSON type (`""` for string, `0` for number, `false` for boolean) - used as
 * the starting point for a brand-new feature's properties.
 *
 * @param featureDescription the schema to build defaults from.
 * @returns the defaulted properties object.
 */
export function populateFeatureProperties(featureDescription: WFSFeatureDescription) {
    const properties = {} as any;
    for (const property of featureDescription.properties) {
        switch (mapXsdTypeToJsonType(property.type)) {
            case "string":
                properties[property.name] = "";
                break;
            case "number":
                properties[property.name] = 0;
                break;
            case "boolean":
                properties[property.name] = false;
                break;
            default:
                properties[property.name] = "";
        }
    }
    return properties;
}

/**
 * Coerces `properties[key]` to the JS type its schema element (`featureTemplate`) declares
 * (string/number/boolean), so a feature's properties always match the types the server expects
 * regardless of how the caller supplied them.
 *
 * @param featureTemplate the schema to look `key`'s declared type up in.
 * @param properties      the properties object containing `key`.
 * @param key             the property name to coerce.
 * @returns the coerced value, or the original value unchanged if `key` isn't in the schema or is
 *          `undefined`.
 */
function setProperVariableType(featureTemplate: WFSFeatureDescription, properties: {[key:string]: any}, key: string) {
    const element = featureTemplate.properties.find(p=>p.name===key);
    const value = properties[key];
    if (!element) return value;
    const jsonSchemaType = mapXsdTypeToJsonType(element.type);
    switch (jsonSchemaType) {
        case "string":
            return typeof value !== "undefined" ? `${value}` : value;
        case "number":
            return typeof value !== "undefined" ? Number(value) : value;
        case "boolean":
            return typeof value !== "undefined" ? Boolean(value) : value
        default:
            return value;
    }
}

/**
 * Builds a new {@link Feature} whose properties match `featureTemplate`'s schema exactly: known
 * properties are coerced to their declared type (see {@link setProperVariableType}), and missing
 * ones are defaulted (see {@link populateFeatureProperties}) - used by
 * {@link WFSTFeatureStore.add}/{@link WFSTFeatureLockStore.add} before validating/encoding a new
 * feature.
 *
 * @param featureTemplate the schema to standardize against.
 * @param feature         the feature whose properties should be standardized.
 * @returns the rebuilt feature, and whether every one of `feature`'s original properties was
 *          already present and defined (false if any were missing, which callers use to trigger
 *          an "edit properties" prompt instead of sending an incomplete feature).
 */
export function standardizeProperties(featureTemplate: WFSFeatureDescription, feature: Feature) {
    let newFeature;
    let validProperties = true;
    const properties = populateFeatureProperties(featureTemplate);
    if (Object.keys(feature.properties).length === 0) {
        newFeature = new Feature(feature.shape, properties, feature.id);
        validProperties = false;
    } else {
        for (const key in properties) {
            if (properties.hasOwnProperty(key)) {
                if (typeof feature.properties[key] !== "undefined") {
                    properties[key] = setProperVariableType(featureTemplate, feature.properties, key);
                } else {
                    validProperties = false;
                }
            }
        }
        newFeature = new Feature(feature.shape, properties, feature.id);
    }
    return {
        newFeature,
        validProperties
    };
}

/**
 * Filters `properties` down to only the keys `featureTemplate`'s own schema declares, coercing
 * each to its declared JSON type (see {@link setProperVariableType}) - the single gate at the
 * point a feature's properties are serialized for a WFS-T Insert/Update, so nothing outside what
 * the server's own `DescribeFeatureType` advertises for this type is ever sent back to it.
 *
 * Unlike {@link standardizeProperties}, this never adds a schema property that's missing from
 * `properties` (no defaulting) - it's a pure subset filter, safe to apply to a partial update
 * (e.g. `putProperties`'s `onlyProperties: true` case) without forcing every other field to a
 * default value.
 *
 * Real-world motivation: a feature decoded via RIA's own, schema-agnostic `GMLCodec.decode()`
 * (used by {@link AdvancedGMLCodec}) picks up `gml:AbstractFeatureType`'s own structural elements
 * (e.g. `gml:boundedBy`) as an extra `boundedBy` property, since that decoder has no notion of
 * "this feature type's own declared properties" to exclude them by. Left unfiltered, editing that
 * feature and sending it back would include `boundedBy` as a `<wfs:Property>` the server doesn't
 * recognize, and reject the whole transaction.
 *
 * @param featureTemplate the schema to filter against.
 * @param properties      the properties to filter.
 * @returns a new object containing only the schema-declared keys that were actually present in
 *          `properties`.
 */
export function filterPropertiesToSchema(featureTemplate: WFSFeatureDescription, properties: {[key: string]: any}): {[key: string]: any} {
    const filtered: {[key: string]: any} = {};
    for (const element of featureTemplate.properties) {
        if (element.name && typeof properties[element.name] !== "undefined") {
            filtered[element.name] = setProperVariableType(featureTemplate, properties, element.name);
        }
    }
    return filtered;
}



/** @returns the JSON Schema type `xsdType` maps to via {@link xsdToJsonMap}, or `"unknown"` if it isn't recognized. */
function mapXsdTypeToJsonType(xsdType: XSDTypeKey): string {
    // Return the mapped JSON type or 'unknown' if not found
    return xsdToJsonMap[xsdType] || "unknown";
}

/**
 * Checks whether a feature's own geometry type (`geoJSONType`, as returned by
 * `GMLFeatureEncoder.getGeometryTypeName`) can be written into a schema field declared as
 * `gmlTypeKey` - e.g. a `Point` feature is compatible with a field typed `MultiPoint` or the
 * fully-generic `Geometry`/`MultiGeometry`, but not with a field typed `Polygon`.
 *
 * @param geoJSONType the feature's own geometry type.
 * @param gmlTypeKey  the schema field's declared GML geometry property type.
 * @returns true if compatible.
 */
export function areCompatibleGeometries(geoJSONType: GeoJSONGeometryType, gmlTypeKey: GMLGeometryTypeKey): boolean {
    // Define compatibility rules
    const compatibilityMap: { [key in GeoJSONGeometryType]: GMLGeometryNames[] } = {
        "Point": ["Point", "MultiPoint", "Geometry", "MultiGeometry"],
        "LineString": ["LineString", "MultiLineString", "MultiCurve", "Geometry", "MultiGeometry"],
        "Polygon": ["Polygon", "MultiPolygon", "MultiSurface", "Geometry", "MultiGeometry"],
        "MultiPoint": ["MultiPoint", "Geometry", "MultiGeometry"],
        "MultiLineString": ["MultiLineString", "MultiCurve", "Geometry", "MultiGeometry"],
        "MultiPolygon": ["MultiPolygon", "MultiSurface", "Geometry", "MultiGeometry"],
        "GeometryCollection": ["MultiGeometry", "Geometry"],
        // No dedicated GML schema type exists for either (see GMLCodecCircularShapeSupport.test.ts) -
        // only compatible with a field the server advertises as fully generic.
        "Circle": ["Geometry"],
        "Arc": ["Geometry"],
    };

    // Get the GML geometry name from the key
    const gmlGeometryName = gmlToJSONGeometry[gmlTypeKey];

    // Check if the GeoJSON type is compatible with the GML type
    return compatibilityMap[geoJSONType].includes(gmlGeometryName);
}
