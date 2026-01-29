import { Feature } from "@luciad/ria/model/feature/Feature";

/** Supported GeoJSON geometry types. */
export type GeoJSONGeometryType =
    "Point" |
    "LineString" |
    "Polygon" |
    "MultiPoint" |
    "MultiLineString" |
    "MultiPolygon" |
    "GeometryCollection";

/** Supported XSD types mapped to standard JSON types. */
export type BasicJSONSchema7TypeName = "string" | "number" | "boolean";

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

export type XSDTypeKey = keyof typeof xsdToJsonMap;

/** Supported GML geometry property names. */
export type GMLGeometryNames = "Point" | "LineString" | "Polygon" | "MultiPoint" | "MultiLineString" | "MultiPolygon" | "Geometry" | "MultiGeometry" | "MultiSurface" | "MultiCurve";

const gmlToJSONGeometry: { [key: string]: GMLGeometryNames } = {
    "gml:PointPropertyType": "Point",
    "gml:LineStringPropertyType": "LineString",
    "gml:PolygonPropertyType": "Polygon",
    "gml:MultiPointPropertyType": "MultiPoint",
    "gml:MultiLineStringPropertyType": "MultiLineString",
    "gml:MultiPolygonPropertyType": "MultiPolygon",
    "gml:GeometryPropertyType": "Geometry",
    "gml:MultiGeometryPropertyType": "MultiGeometry",
    "gml:MultiCurvePropertyType": "MultiCurve",
    "gml:MultiSurfacePropertyType": "MultiSurface",
};

export type GMLGeometryTypeKey = string;

/**
 * Maps a GML property type name (e.g., gml:PointPropertyType) to a simplified geometry name.
 */
export function GMLGeometryTypeToGeometry(key: GMLGeometryTypeKey): GMLGeometryNames {
    if (typeof gmlToJSONGeometry[key] !== "undefined") {
        return gmlToJSONGeometry[key] as GMLGeometryNames;
    }
    throw new Error(`Unsupported target geometry type: ${key}`);
}

/** Information about an XSD element extracted from DescribeFeatureType. */
export interface XsdElement {
    name?: string;
    type?: string;
    minOccurs?: number;
    substitutionGroup?: string;
}

/** Specific information for a geometry element. */
interface XsdGeometryElement extends XsdElement {
    type?: GMLGeometryTypeKey;
}

/** Result of parsing a WFS DescribeFeatureType response. */
export interface WFSFeatureDescription {
    geometry: XsdGeometryElement;
    properties: XsdElement[];
    feature: XsdElement;
    tns: string;
    shortTns: string;
}

/**
 * Parses WFS DescribeFeatureType XML into a structured feature description.
 */
export function parseWFSFeatureDescription(xmlContent: string): WFSFeatureDescription {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlContent, "application/xml");
    const schemaElement = xmlDoc.documentElement;
    const targetNamespace = schemaElement.getAttribute("targetNamespace");

    const w3cxsd = "http://www.w3.org/2001/XMLSchema";
    const extensions = Array.from(xmlDoc.getElementsByTagNameNS(w3cxsd, "extension"));
    const targetExtension = extensions.find(e => e.getAttribute("base") === "gml:AbstractFeatureType");

    if (!targetExtension) {
        return {
            geometry: null,
            properties: [],
            feature: null,
            tns: targetNamespace || null,
            shortTns: null
        };
    }

    const sequence = targetExtension.getElementsByTagNameNS(w3cxsd, "sequence")[0];
    const elements = sequence ? Array.from(sequence.getElementsByTagNameNS(w3cxsd, "element")) : [];

    const extractedElements: XsdElement[] = elements.map(element => ({
        name: element.getAttribute("name") || undefined,
        type: element.getAttribute("type") || undefined,
        minOccurs: element.hasAttribute("minOccurs") ? Number(element.getAttribute("minOccurs")) : undefined,
        substitutionGroup: element.getAttribute("substitutionGroup") || undefined
    }));

    // Identify geometry and properties based on type prefix
    const geometry = extractedElements.filter(e => e.type?.startsWith("gml:")) as XsdGeometryElement[];
    const properties = extractedElements.filter(e => e.type?.startsWith("xsd:"));

    // Find the feature type definition itself
    const rootElements = Array.from(xmlDoc.getElementsByTagNameNS(w3cxsd, "element"));
    const featureRoot = rootElements.find(e => e.getAttribute("substitutionGroup") === "gml:AbstractFeature");

    const feature: XsdElement = featureRoot ? {
        name: featureRoot.getAttribute("name") || undefined,
        type: featureRoot.getAttribute("type") || undefined,
        minOccurs: featureRoot.hasAttribute("minOccurs") ? Number(featureRoot.getAttribute("minOccurs")) : undefined,
        substitutionGroup: featureRoot.getAttribute("substitutionGroup") || undefined
    } : null;

    const shortTns = feature && feature.type ? feature.type.split(":")[0] : null;

    return {
        geometry: geometry[0] || null,
        properties,
        feature,
        tns: targetNamespace || null,
        shortTns
    };
}

/**
 * Creates an empty properties object based on the feature description.
 */
export function populateFeatureProperties(featureDescription: WFSFeatureDescription) {
    const properties: Record<string, any> = {};
    for (const property of featureDescription.properties) {
        if (!property.name) continue;

        switch (mapXsdTypeToJsonType(property.type as XSDTypeKey)) {
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
 * Sets the value of a property ensuring it matches the expected XSD type.
 */
function setProperVariableType(featureTemplate: WFSFeatureDescription, properties: Record<string, any>, key: string) {
    const element = featureTemplate.properties.find(p => p.name === key);
    const value = properties[key];
    if (!element) return value;

    const jsonSchemaType = mapXsdTypeToJsonType(element.type as XSDTypeKey);
    switch (jsonSchemaType) {
        case "string":
            return value !== undefined ? `${value}` : value;
        case "number":
            return value !== undefined ? Number(value) : value;
        case "boolean":
            return value !== undefined ? Boolean(value) : value;
        default:
            return value;
    }
}

/**
 * Standardizes a feature's properties according to the WFS feature description.
 */
export function standardizeProperties(featureTemplate: WFSFeatureDescription, feature: Feature) {
    const templateProperties = populateFeatureProperties(featureTemplate);
    const newProperties: Record<string, any> = {};
    let validProperties = true;

    if (Object.keys(feature.properties).length === 0) {
        validProperties = false;
        return { newFeature: new Feature(feature.shape, templateProperties, feature.id), validProperties };
    }

    for (const key in templateProperties) {
        if (feature.properties[key] !== undefined) {
            newProperties[key] = setProperVariableType(featureTemplate, feature.properties, key);
        } else {
            newProperties[key] = templateProperties[key];
            validProperties = false;
        }
    }

    return {
        newFeature: new Feature(feature.shape, newProperties, feature.id),
        validProperties
    };
}

function mapXsdTypeToJsonType(xsdType: XSDTypeKey): string {
    return xsdToJsonMap[xsdType] || "unknown";
}

/**
 * Checks if a GeoJSON geometry type is compatible with a GML geometry property type.
 */
export function areCompatibleGeometries(geoJSONType: GeoJSONGeometryType, gmlTypeKey: GMLGeometryTypeKey): boolean {
    const compatibilityMap: Record<GeoJSONGeometryType, GMLGeometryNames[]> = {
        "Point": ["Point", "MultiPoint", "Geometry", "MultiGeometry"],
        "LineString": ["LineString", "MultiLineString", "MultiCurve", "Geometry", "MultiGeometry"],
        "Polygon": ["Polygon", "MultiPolygon", "MultiSurface", "Geometry", "MultiGeometry"],
        "MultiPoint": ["MultiPoint", "Geometry", "MultiGeometry"],
        "MultiLineString": ["MultiLineString", "MultiCurve", "Geometry", "MultiGeometry"],
        "MultiPolygon": ["MultiPolygon", "MultiSurface", "Geometry", "MultiGeometry"],
        "GeometryCollection": ["MultiGeometry", "Geometry"],
    };

    try {
        const gmlGeometryName = GMLGeometryTypeToGeometry(gmlTypeKey);
        return compatibilityMap[geoJSONType].includes(gmlGeometryName);
    } catch {
        return false;
    }
}
