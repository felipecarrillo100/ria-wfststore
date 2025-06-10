// Define a type for the extracted element information

// Define a mapping from XSD types to JSON types
import {Feature} from "@luciad/ria/model/feature/Feature";

export type GeoJSONGeometryType =
    "Point" |
    "LineString" |
    "Polygon" |
    "MultiPoint" |
    "MultiLineString" |
    "MultiPolygon" |
    "GeometryCollection";

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

export type GMLGeometryNames = "Point" | "LineString" | "Polygon" | "MultiPoint" | "MultiLineString" | "MultiPolygon" | "Geometry" | "MultiGeometry" | "MultiSurface" | "MultiCurve";
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
export type GMLGeometryTypeKey = keyof typeof xsdToJsonMap;

export function GMLGeometryTypeToGeometry(key: GMLGeometryTypeKey) {
    if (typeof gmlToJSONGeometry[key] !== "undefined") return gmlToJSONGeometry[key] as GMLGeometryNames;
    throw new Error('Unsupported target geometry type');
}

export interface XsdElement {
    name?: string;
    type?: XSDTypeKey;
    minOccurs?: number;
    substitutionGroup?: string;
}

interface XsdGeometryElement {
    name?: string;
    type?: GMLGeometryTypeKey;
    minOccurs?: number;
    substitutionGroup?: string;
}


export interface WFSFeatureDescription {
    geometry: XsdGeometryElement;
    properties: XsdElement[];
    feature: XsdElement;
    tns: string;
    shortTns: string;
}

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



function mapXsdTypeToJsonType(xsdType: XSDTypeKey): string {
    // Return the mapped JSON type or 'unknown' if not found
    return xsdToJsonMap[xsdType] || "unknown";
}

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
    };

    // Get the GML geometry name from the key
    const gmlGeometryName = gmlToJSONGeometry[gmlTypeKey];

    // Check if the GeoJSON type is compatible with the GML type
    return compatibilityMap[geoJSONType].includes(gmlGeometryName);
}
