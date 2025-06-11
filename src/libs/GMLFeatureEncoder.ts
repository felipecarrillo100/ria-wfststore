import {Feature} from "@luciad/ria/model/feature/Feature";
import {GeoJsonCodec} from "@luciad/ria/model/codec/GeoJsonCodec";
import {MemoryStore} from "@luciad/ria/model/store/MemoryStore";
import {encodeFeatureToGML, GMLFeature} from "./gml/gml32/encodeFeatureToGML";
import {GMLGeometryNames, GMLGeometryTypeKey, GMLGeometryTypeToGeometry} from "./ParseWFSFeatureDescription";
import {GMLGeometry, GMLGeometryTypeNames} from "./gml/gml32/GMLGeometry";
import {EncodeGeometryDimension} from "./gml/gml32/encodeGeometryToGML";

const geoJSONCodec = new GeoJsonCodec({generateIDs: true});
const geoJSONCodecPreserveIds = new GeoJsonCodec({generateIDs: false});

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
    forceDimension?: EncodeGeometryDimension;
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
    private forceDimension: EncodeGeometryDimension;

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
        this.forceDimension = options.forceDimension;
    }

    encodeFeature(feature: Feature) {
        const featureAsJSON = this.SingleFeatureGMLasJSONEncode(feature);
        const gmlFeature = encodeFeatureToGML(featureAsJSON, { gmlVersion: this.gmlVersion, invert: this.invert, forceDimension: this.forceDimension});
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
            featureAsJson.geometry.srsName = srsName === "CRS:84" ? "urn:ogc:def:crs:EPSG:4326" : srsName;
            featureAsJson.geometry.type = this.reMapShapeTypeIfNeeded(featureAsJson.geometry.type);
            if (this.wrapToMultiGeometry) {
                if (featureAsJson.geometry.type!=="MultiGeometry") {
                    // @ts-ignore
                    featureAsJson.geometry = {
                        id: "aMultiGeometry",
                        type: "MultiGeometry",
                        srsName: featureAsJson.geometry.srsName === "CRS:84" ? "urn:ogc:def:crs:EPSG:4326" : featureAsJson.geometry.srsName,
                        geometries: this.decomposeGeometries(featureAsJson.geometry)
                    };
                } else {
                    featureAsJson.geometry.srsName = featureAsJson.geometry.srsName === "CRS:84" ? "urn:ogc:def:crs:EPSG:4326" : featureAsJson.geometry.srsName;
                    featureAsJson.geometry.geometries = this.decomposeGeometries(featureAsJson.geometry);
                }
            }
            if (this.wrapToMultiSurface) {
                if (featureAsJson.geometry.type === "Polygon") {
                    featureAsJson.geometry = {
                            id: "aMultiSurface",
                        // @ts-ignore
                            type: this.targetGeometry,
                            srsName: featureAsJson.geometry.srsName === "CRS:84" ? "urn:ogc:def:crs:EPSG:4326" : featureAsJson.geometry.srsName,
                        // @ts-ignore
                           coordinates: [featureAsJson.geometry.coordinates]
                        };
                } else {
                    featureAsJson.geometry.srsName = featureAsJson.geometry.srsName === "CRS:84" ? "urn:ogc:def:crs:EPSG:4326" : featureAsJson.geometry.srsName;
                    if (featureAsJson.geometry.type === "MultiPolygon") {
                        // @ts-ignore
                        featureAsJson.geometry.type = this.targetGeometry;
                    }
                }
            }
            if (this.wrapToMultiCurve) {
                if (featureAsJson.geometry.type === "LineString") {
                    featureAsJson.geometry = {
                        id: "aMultiCurve",
                        // @ts-ignore
                        type: this.targetGeometry,
                        srsName: featureAsJson.geometry.srsName === "CRS:84" ? "urn:ogc:def:crs:EPSG:4326" : featureAsJson.geometry.srsName,
                        // @ts-ignore
                        coordinates: [featureAsJson.geometry.coordinates]
                    };
                } else {
                    featureAsJson.geometry.srsName = featureAsJson.geometry.srsName === "CRS:84" ? "urn:ogc:def:crs:EPSG:4326" : featureAsJson.geometry.srsName;
                    if (featureAsJson.geometry.type === "MultiLineString") {
                        // @ts-ignore
                        featureAsJson.geometry.type = this.targetGeometry;
                    }
                }
            }
            if (this.wrapToMultiPoint) {
                if (featureAsJson.geometry.type === "Point") {
                    featureAsJson.geometry = {
                        id: "aMultiPoint",
                        // @ts-ignore
                        type: "MultiPoint",
                        srsName: featureAsJson.geometry.srsName === "CRS:84" ? "urn:ogc:def:crs:EPSG:4326" : featureAsJson.geometry.srsName,
                        // @ts-ignore
                        coordinates: [featureAsJson.geometry.coordinates]
                    };
                } else {
                    featureAsJson.geometry.srsName = featureAsJson.geometry.srsName === "CRS:84" ? "urn:ogc:def:crs:EPSG:4326" : featureAsJson.geometry.srsName;
                }
            }
            if (featureAsJson.geometry.type === "MultiPolygon") {
                // @ts-ignore
                featureAsJson.geometry.type = "MultiSurface"
            }
            return featureAsJson;
        }
        return null;
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
