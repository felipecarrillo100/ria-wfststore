import {Feature} from "@luciad/ria/model/feature/Feature";
import {GeoJsonCodec} from "@luciad/ria/model/codec/GeoJsonCodec";
import {MemoryStore} from "@luciad/ria/model/store/MemoryStore";
import {encodeFeatureToGML, GMLFeature} from "./gml/gml32/encodeFeatureToGML";
import {GMLGeometryNames, GMLGeometryTypeKey, GMLGeometryTypeToGeometry} from "./ParseWFSFeatureDescription";
import {GMLGeometry, GMLGeometryTypeNames} from "./gml/gml32/GMLGeometry";
import {normalizeGMLGeometry, normalizeSrsName} from "./gml/gml32/normalizeGMLGeometry";

// mode3D:true unconditionally: this is an internal Feature<->JSON transport format, never inspected
// directly by anything outside this file, so it should always preserve Z faithfully. Whether the
// final GML output actually WRITES 3 coordinates is a separate decision made downstream, in
// encodeGeometryToGML, per its own mode3D option/auto-detection.
const geoJSONCodec = new GeoJsonCodec({generateIDs: true, mode3D: true});
const geoJSONCodecPreserveIds = new GeoJsonCodec({generateIDs: false, mode3D: true});

interface GeometryMapType {
    GeometryCollection?: string;
    MultiPolygon?: string;
}

interface GMLEncoderOptions {
    geometryMap?: GeometryMapType;
    wrapToMultiGeometry?: boolean;
    wrapToMultiSurface?: boolean;
    wrapToMultiCurve?: boolean;
    wrapToMultiPoint?: boolean;
    targetGeometry?: GMLGeometryTypeKey;
    gmlVersion?: '3.2' | '3.1.1';
    invert?: boolean;
    // true/false forces 3D/2D output; omitted auto-detects from the feature's own geometry.
    mode3D?: boolean;
}


const ReplaceMapGeometries = {
    GeometryCollection: "MultiGeometry",
}
export class GMLFeatureEncoder {
    private geometryMap: GeometryMapType;
    private wrapToMultiGeometry: boolean;
    private targetGeometry: GMLGeometryNames;
    private gmlVersion: "3.2" | "3.1.1";
    private wrapToMultiSurface: boolean;
    private wrapToMultiCurve: boolean;
    private wrapToMultiPoint: boolean;
    private invert: boolean;
    private mode3D?: boolean;

    constructor(options?: GMLEncoderOptions) {
        if (!options) options = {};
        this.geometryMap = options.geometryMap ? options.geometryMap : ReplaceMapGeometries;
        this.gmlVersion = options.gmlVersion || '3.2';
        const gmlGeometry = options.targetGeometry;
        this.targetGeometry = GMLGeometryTypeToGeometry(gmlGeometry);
        this.wrapToMultiGeometry = typeof options.wrapToMultiGeometry !== "undefined" ? options.wrapToMultiGeometry: this.targetGeometry === "MultiGeometry";
        this.wrapToMultiSurface = typeof options.wrapToMultiGeometry !== "undefined" ? options.wrapToMultiSurface: (this.targetGeometry === "MultiSurface" || this.targetGeometry === "MultiPolygon");
        this.wrapToMultiCurve = typeof options.wrapToMultiCurve !== "undefined" ? options.wrapToMultiCurve: (this.targetGeometry === "MultiCurve" || this.targetGeometry === "MultiLineString");
        this.wrapToMultiPoint = typeof options.wrapToMultiPoint !== "undefined" ? options.wrapToMultiPoint: (this.targetGeometry === "MultiPoint");
        this.invert = options.invert;
        this.mode3D = options.mode3D;
    }

    encodeFeature(feature: Feature) {
        const featureAsJSON = this.SingleFeatureGMLasJSONEncode(feature);
        const gmlFeature = encodeFeatureToGML(featureAsJSON, { gmlVersion: this.gmlVersion, invert: this.invert, mode3D: this.mode3D });
        return {
            geometryType: featureAsJSON.geometry.type,
            feature: gmlFeature,
            geometry: GMLFeatureEncoder.XMLUnwrap(gmlFeature, 'geometry')
        };
    }

    private static XMLUnwrap(text:string, querySelector: string) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text,"text/xml");
        const element = xmlDoc.querySelectorAll(querySelector);
        if (element.length>0) return element[0].innerHTML;
        return null
    }

    private reMapShapeTypeIfNeeded(type: GMLGeometryTypeNames): GMLGeometryTypeNames {
        //TODO: implement shapeType conversions if needed
        return type;
    }

    public static encodeFeatureToGeoJSON(feature: Feature) {
        const memoryStore = new MemoryStore({reference: feature.shape.reference});
        const newFeature = new Feature(feature.shape, feature.properties, feature.id)
        memoryStore.put(newFeature);
        const srsName = newFeature.shape ? newFeature.shape.reference.identifier : "";
        const cursor = memoryStore.query();
        const result = geoJSONCodec.encode(cursor);
        let geoJSONFeature: any;
        try {
            geoJSONFeature = JSON.parse(result.content);
        } catch (err) {
            geoJSONFeature = {};
        }
        const geometryType = geoJSONFeature.geometry.type;
        return {content: result.content, contentType: result.contentType, srsName: srsName, geometryType};
    }

    // Perhaps needed in the future: srsName
    public static decodeFeatureFromGeoJSON(content: string, srsName: string) {
        const cursor = geoJSONCodecPreserveIds.decode({content, contentType: "application/geo+json"});
        return cursor.hasNext() ? cursor.next() : null;
    }

    private SingleFeatureGMLasJSONEncode(feature: Feature) {
        const {content, srsName} = GMLFeatureEncoder.encodeFeatureToGeoJSON(feature);
        const featureAsJson = JSON.parse(content) as GMLFeature;
        if (featureAsJson.type==="Feature" && featureAsJson.geometry)  {
            featureAsJson.geometry.srsName = normalizeSrsName(srsName);
            featureAsJson.geometry.type = this.reMapShapeTypeIfNeeded(featureAsJson.geometry.type);
            if (this.wrapToMultiGeometry) {
                if (featureAsJson.geometry.type!=="MultiGeometry") {
                    // @ts-ignore
                    featureAsJson.geometry = {
                        id: "aMultiGeometry",
                        type: "MultiGeometry",
                        srsName: normalizeSrsName(featureAsJson.geometry.srsName),
                        geometries: this.decomposeGeometries(featureAsJson.geometry)
                    };
                } else {
                    featureAsJson.geometry.srsName = normalizeSrsName(featureAsJson.geometry.srsName);
                    featureAsJson.geometry.geometries = this.decomposeGeometries(featureAsJson.geometry);
                }
            }
            this.wrapSingleToMulti(featureAsJson, this.wrapToMultiSurface, "Polygon", "MultiPolygon", "aMultiSurface", this.targetGeometry);
            this.wrapSingleToMulti(featureAsJson, this.wrapToMultiCurve, "LineString", "MultiLineString", "aMultiCurve", this.targetGeometry);
            this.wrapSingleToMulti(featureAsJson, this.wrapToMultiPoint, "Point", "MultiPoint", "aMultiPoint", "MultiPoint");
            featureAsJson.geometry = normalizeGMLGeometry(featureAsJson.geometry);
            return featureAsJson;
        }
        return null;
    }

    // Shared shape of wrapToMultiSurface/wrapToMultiCurve/wrapToMultiPoint: wrap a lone
    // `singleType` geometry into a single-member Multi* structure, or - if it's already a
    // `multiTypeName` - just remap its "type" to the GML type name the server actually
    // advertises (e.g. GeoJSON's "MultiPolygon" -> GML's "MultiSurface").
    private wrapSingleToMulti(
        featureAsJson: GMLFeature, enabled: boolean, singleType: string, multiTypeName: string,
        wrapId: string, wrapType: string
    ): void {
        if (!enabled) return;
        if (featureAsJson.geometry.type === singleType) {
            featureAsJson.geometry = {
                id: wrapId,
                // @ts-ignore
                type: wrapType,
                srsName: normalizeSrsName(featureAsJson.geometry.srsName),
                // @ts-ignore
                coordinates: [featureAsJson.geometry.coordinates]
            };
        } else {
            featureAsJson.geometry.srsName = normalizeSrsName(featureAsJson.geometry.srsName);
            if (featureAsJson.geometry.type === multiTypeName) {
                // @ts-ignore
                featureAsJson.geometry.type = wrapType;
            }
        }
    }

    private decomposeGeometries = (geometry: GMLGeometry): any => {
        switch (geometry.type) {
            case "MultiGeometry": {
                let geometries: GMLGeometry[] = [];
                for (const g of geometry.geometries) {
                    const dg = this.decomposeGeometries(g);
                    geometries = [...geometries, ...dg];
                }
                return geometries;
            }
             case "MultiPolygon":
                return geometry.coordinates.map(coord=>({
                    type: 'Polygon',
                    coordinates: coord
                }))
            case "MultiSurface":
                return geometry.coordinates.map(coord=>({
                    type: 'Surface',
                    coordinates: coord
                }))
            case "MultiPoint":
                return geometry.coordinates.map(coord=>({
                    type: 'Point',
                    coordinates: coord
                }))
            case 'MultiLineString':
                return geometry.coordinates.map(coord=>({
                    type: 'LineString',
                    coordinates: coord
                }))
            default:
                return [geometry]
        }
    }
}
