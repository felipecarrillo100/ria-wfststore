import { Feature } from "@luciad/ria/model/feature/Feature";
import { GeoJsonCodec } from "@luciad/ria/model/codec/GeoJsonCodec";
import { MemoryStore } from "@luciad/ria/model/store/MemoryStore";
import { encodeFeatureToGML, GMLFeature } from "./gml/gml32/encodeFeatureToGML";
import { GMLGeometryNames, GMLGeometryTypeKey, GMLGeometryTypeToGeometry } from "./ParseWFSFeatureDescription";
import { GMLGeometry, GMLGeometryTypeNames } from "./gml/gml32/GMLGeometry";

const geoJSONCodec = new GeoJsonCodec({ generateIDs: true });
const geoJSONCodecPreserveIds = new GeoJsonCodec({ generateIDs: false });

interface GeometryMapType {
    GeometryCollection?: string;
    MultiPolygon?: string;
}

/** Options for GML encoding. */
interface GMLEncoderOptions {
    geometryMap?: GeometryMapType;
    wrapToMultiGeometry?: boolean;
    wrapToMultiSurface?: boolean;
    wrapToMultiCurve?: boolean;
    wrapToMultiPoint?: boolean;
    targetGeometry?: GMLGeometryTypeKey;
    gmlVersion?: '3.2' | '3.1.1';
    invert?: boolean;
}

const DefaultReplaceMap = {
    GeometryCollection: "MultiGeometry",
};

/**
 * Handles encoding of Features into GML representations.
 * Manages geometry wrapping (e.g., Polygon -> MultiSurface) as required by WFS target types.
 */
export class GMLFeatureEncoder {
    private geometryMap: GeometryMapType;
    private wrapToMultiGeometry: boolean;
    private targetGeometry: GMLGeometryNames;
    private gmlVersion: "3.2" | "3.1.1";
    private wrapToMultiSurface: boolean;
    private wrapToMultiCurve: boolean;
    private wrapToMultiPoint: boolean;
    private invert: boolean;

    constructor(options: GMLEncoderOptions = {}) {
        this.geometryMap = options.geometryMap || DefaultReplaceMap;
        this.gmlVersion = options.gmlVersion || '3.2';
        this.targetGeometry = GMLGeometryTypeToGeometry(options.targetGeometry || "");

        this.wrapToMultiGeometry = options.wrapToMultiGeometry ?? (this.targetGeometry === "MultiGeometry");
        this.wrapToMultiSurface = options.wrapToMultiSurface ?? (this.targetGeometry === "MultiSurface" || this.targetGeometry === "MultiPolygon");
        this.wrapToMultiCurve = options.wrapToMultiCurve ?? (this.targetGeometry === "MultiCurve" || this.targetGeometry === "MultiLineString");
        this.wrapToMultiPoint = options.wrapToMultiPoint ?? (this.targetGeometry === "MultiPoint");
        this.invert = !!options.invert;
    }

    /**
     * Encodes a feature to GML.
     * @returns An object containing the geometry type, the full GML feature string, and the unwrapped GML geometry string.
     */
    public encodeFeature(feature: Feature) {
        const featureAsJSON = this.singleFeatureGMLasJSONEncode(feature);
        const gmlFeature = encodeFeatureToGML(featureAsJSON, { gmlVersion: this.gmlVersion, invert: this.invert });
        return {
            geometryType: featureAsJSON.geometry.type,
            feature: gmlFeature,
            geometry: GMLFeatureEncoder.XMLUnwrap(gmlFeature, 'geometry')
        };
    }

    /** Helper to extract content from an XML tag. */
    private static XMLUnwrap(text: string, querySelector: string): string | null {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text, "text/xml");
        const element = xmlDoc.querySelectorAll(querySelector);
        return element.length > 0 ? element[0].innerHTML : null;
    }

    /** Encodes a feature to a GeoJSON string. */
    public static encodeFeatureToGeoJSON(feature: Feature) {
        const memoryStore = new MemoryStore({ reference: feature.shape.reference });
        const newFeature = new Feature(feature.shape, feature.properties, feature.id);
        memoryStore.put(newFeature);

        const srsName = newFeature.shape ? newFeature.shape.reference.identifier : "";
        const cursor = memoryStore.query();
        const result = geoJSONCodec.encode(cursor);

        let geoJSONFeature: any;
        try {
            geoJSONFeature = JSON.parse(result.content);
        } catch {
            geoJSONFeature = {};
        }

        return { content: result.content, contentType: result.contentType, srsName, geometryType: geoJSONFeature.geometry?.type };
    }

    /** Decodes a feature from a GeoJSON string. */
    public static decodeFeatureFromGeoJSON(content: string, srsName: string): Feature | null {
        const cursor = geoJSONCodecPreserveIds.decode({ content, contentType: "application/geo+json" });
        return cursor.hasNext() ? cursor.next() as Feature : null;
    }

    private singleFeatureGMLasJSONEncode(feature: Feature): GMLFeature {
        const { content, srsName } = GMLFeatureEncoder.encodeFeatureToGeoJSON(feature);
        const featureAsJson = JSON.parse(content) as GMLFeature;

        if (featureAsJson.type === "Feature" && featureAsJson.geometry) {
            const geometry = featureAsJson.geometry;
            geometry.srsName = srsName === "CRS:84" ? "urn:ogc:def:crs:EPSG:4326" : srsName;

            if (this.wrapToMultiGeometry) {
                this.wrapGeometry(geometry, "MultiGeometry", "aMultiGeometry");
            } else if (this.wrapToMultiSurface && geometry.type === "Polygon") {
                this.wrapGeometry(geometry, this.targetGeometry, "aMultiSurface");
            } else if (this.wrapToMultiCurve && geometry.type === "LineString") {
                this.wrapGeometry(geometry, this.targetGeometry, "aMultiCurve");
            } else if (this.wrapToMultiPoint && geometry.type === "Point") {
                this.wrapGeometry(geometry, "MultiPoint", "aMultiPoint");
            }

            // Standardize MultiPolygon to MultiSurface if required
            if (geometry.type === "MultiPolygon") {
                (geometry as any).type = "MultiSurface";
            }
        }
        return featureAsJson;
    }

    private wrapGeometry(geometry: GMLGeometry, type: any, id: string) {
        if (type === "MultiGeometry") {
            (geometry as any).geometries = this.decomposeGeometries(geometry);
        } else {
            (geometry as any).coordinates = [(geometry as any).coordinates];
        }
        geometry.id = id;
        geometry.type = type;
    }

    private decomposeGeometries = (geometry: GMLGeometry): any[] => {
        switch (geometry.type) {
            case "MultiGeometry":
                return geometry.geometries.flatMap(g => this.decomposeGeometries(g));
            case "MultiPolygon":
            case "MultiSurface":
            case "MultiCurve":
            case "MultiLineString":
            case "MultiPoint":
                // @ts-ignore
                const subType = geometry.type.replace("Multi", "").replace("Surface", "Polygon").replace("Curve", "LineString");
                return (geometry as any).coordinates.map(coord => ({
                    type: subType,
                    coordinates: coord
                }));
            default:
                return [geometry];
        }
    }
}
