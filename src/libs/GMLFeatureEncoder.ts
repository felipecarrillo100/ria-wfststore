import {Feature} from "@luciad/ria/model/feature/Feature";
import {GeoJsonCodec} from "@luciad/ria/model/codec/GeoJsonCodec";
import {MemoryStore} from "@luciad/ria/model/store/MemoryStore";
import {encodeFeatureToGML, GMLFeature} from "./gml/gml32/encodeFeatureToGML";
import {GMLGeometryNames, GMLGeometryTypeKey, GMLGeometryTypeToGeometry} from "./ParseWFSFeatureDescription";
import {GMLGeometry, GMLGeometryTypeNames} from "./gml/gml32/GMLGeometry";
import {normalizeGMLGeometry, normalizeSrsName} from "./gml/gml32/normalizeGMLGeometry";
import {detectCircularShapeTypeName, tryBuildCircularGeometryJSON} from "./gml/gml32/encodeCircularShapeToJSON";

// mode3D:true unconditionally: this is an internal Feature<->JSON transport format, never inspected
// directly by anything outside this file, so it should always preserve Z faithfully. Whether the
// final GML output actually WRITES 3 coordinates is a separate decision made downstream, in
// encodeGeometryToGML, per its own mode3D option/auto-detection.
/** Used internally (see {@link GMLFeatureEncoder.encodeFeatureToGeoJSON}) as a Feature-to-JSON intermediate step, always generating fresh ids. */
const geoJSONCodec = new GeoJsonCodec({generateIDs: true, mode3D: true});
/** Like {@link geoJSONCodec}, but preserves the feature's own id - used for round-tripping pending-edit content (see {@link GMLFeatureEncoder.decodeFeatureFromGeoJSON}) where the id must survive. */
const geoJSONCodecPreserveIds = new GeoJsonCodec({generateIDs: false, mode3D: true});

/** Overrides for how specific GeoJSON geometry type names get remapped when encoding - see {@link ReplaceMapGeometries}. */
interface GeometryMapType {
    GeometryCollection?: string;
    MultiPolygon?: string;
}

/** Constructor options for {@link GMLFeatureEncoder}. */
interface GMLEncoderOptions {
    /** Overrides for GeoJSON-type-name-to-GML-type-name remapping - defaults to {@link ReplaceMapGeometries}. */
    geometryMap?: GeometryMapType;
    /** Wrap a lone geometry into a single-member `MultiGeometry` - defaults to true only when `targetGeometry` resolves to `"MultiGeometry"`. */
    wrapToMultiGeometry?: boolean;
    /** Wrap a lone Polygon into a single-member MultiSurface/MultiPolygon - defaults to true only when `targetGeometry` resolves to `"MultiSurface"`/`"MultiPolygon"`. */
    wrapToMultiSurface?: boolean;
    /** Wrap a lone LineString into a single-member MultiCurve/MultiLineString - defaults to true only when `targetGeometry` resolves to `"MultiCurve"`/`"MultiLineString"`. */
    wrapToMultiCurve?: boolean;
    /** Wrap a lone Point into a single-member MultiPoint - defaults to true only when `targetGeometry` resolves to `"MultiPoint"`. */
    wrapToMultiPoint?: boolean;
    /** The server schema's declared geometry property type for the field being encoded into - drives every `wrapToMulti*` default above. */
    targetGeometry?: GMLGeometryTypeKey;
    gmlVersion?: '3.2' | '3.1.1';
    invert?: boolean;
    // true/false forces 3D/2D output; omitted auto-detects from the feature's own geometry.
    /** true/false forces 3D/2D output; omitted auto-detects from the feature's own geometry. */
    mode3D?: boolean;
}


/** Default GeoJSON-type-name-to-GML-type-name remap: GeoJSON's `GeometryCollection` has no GML equivalent, so it's written as `MultiGeometry` instead. */
const ReplaceMapGeometries = {
    GeometryCollection: "MultiGeometry",
}

/**
 * Encodes a single {@link Feature} into GML shaped to match a *specific* server feature-type
 * schema - wrapping a lone geometry into the appropriate `Multi*` structure when the schema
 * declares one, and remapping GeoJSON-style type names to their GML schema equivalents (e.g.
 * `MultiPolygon` -> `MultiSurface`) via `targetGeometry`.
 *
 * This is what {@link WFSTQueries} uses internally to build WFS-T transaction bodies against a
 * known `DescribeFeatureType` schema. Contrast with {@link AdvancedGMLCodec}, which is
 * schema-independent and just encodes each feature's own natural geometry type as-is.
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
    private mode3D?: boolean;

    /** @param options see {@link GMLEncoderOptions}. */
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

    /**
     * Encodes `feature` into GML matching this encoder's target schema (see the class doc).
     *
     * @param feature the feature to encode.
     * @returns the feature's own geometry type name, the full encoded `<gml:Feature>` XML, and
     *          just the inner geometry element's XML on its own (extracted via {@link XMLUnwrap}).
     */
    encodeFeature(feature: Feature) {
        // Circle/Arc have no GeoJSON representation at all (RIA's own GeoJsonCodec.encode()
        // throws on them), so they never touch encodeFeatureToGeoJSON/SingleFeatureGMLasJSONEncode
        // - built directly from the RIA shape's own properties instead.
        const circularGeometry = feature.shape
            ? tryBuildCircularGeometryJSON(feature.shape, normalizeSrsName(feature.shape.reference.identifier), feature.id as string)
            : null;
        const featureAsJSON: GMLFeature = circularGeometry ? {
            id: feature.id as string,
            type: "Feature",
            geometry: circularGeometry,
            properties: feature.properties as any
        } : this.SingleFeatureGMLasJSONEncode(feature);
        const gmlFeature = encodeFeatureToGML(featureAsJSON, { gmlVersion: this.gmlVersion, invert: this.invert, mode3D: this.mode3D });
        return {
            geometryType: featureAsJSON.geometry.type,
            feature: gmlFeature,
            geometry: GMLFeatureEncoder.XMLUnwrap(gmlFeature, 'geometry')
        };
    }

    /** @returns the inner HTML of the first element in `text` matching `querySelector`, or null if there's no match. */
    private static XMLUnwrap(text:string, querySelector: string) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(text,"text/xml");
        const element = xmlDoc.querySelectorAll(querySelector);
        if (element.length>0) return element[0].innerHTML;
        return null
    }

    /** Placeholder for future shape-type remapping - currently a no-op passthrough. */
    private reMapShapeTypeIfNeeded(type: GMLGeometryTypeNames): GMLGeometryTypeNames {
        //TODO: implement shapeType conversions if needed
        return type;
    }

    /**
     * Encodes a single feature to GeoJSON via a throwaway {@link MemoryStore} (RIA's own
     * `GeoJsonCodec` only encodes cursors/collections, not a single feature directly, hence the
     * one-feature store as a wrapper).
     *
     * @param feature the feature to encode. Note: Circle/Arc shapes will throw here, since
     *                GeoJSON can't represent them - see {@link getGeometryTypeName} for the
     *                pre-check that avoids this.
     * @returns the encoded content/contentType, the feature's srsName, and its geometry type name.
     */
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

    // Circle/Arc have no GeoJSON representation - encodeFeatureToGeoJSON's geoJSONCodec.encode()
    // throws outright on them - so a caller that only needs the geometry TYPE NAME (e.g. a
    // schema-compatibility pre-check before the real GML encoding even runs) must not go through
    // it unconditionally, or it crashes before ever reaching the encoder that actually handles
    // these two shapes.
    /**
     * @param feature the feature to get the geometry type name of.
     * @returns the feature's geometry type name - detected as Circle/Arc first (see
     *          {@link detectCircularShapeTypeName}), falling back to
     *          {@link encodeFeatureToGeoJSON}'s geometry type for everything else. Circle/Arc have
     *          no GeoJSON representation at all - `encodeFeatureToGeoJSON`'s codec throws outright
     *          on them - so a caller that only needs the type name (e.g. a schema-compatibility
     *          pre-check before the real GML encoding runs) must check these first, or it would
     *          crash before ever reaching the encoder that actually handles these two shapes.
     */
    public static getGeometryTypeName(feature: Feature): string {
        const circularTypeName = feature.shape ? detectCircularShapeTypeName(feature.shape) : null;
        if (circularTypeName) return circularTypeName;
        return GMLFeatureEncoder.encodeFeatureToGeoJSON(feature).geometryType;
    }

    // Perhaps needed in the future: srsName
    /**
     * The inverse of {@link encodeFeatureToGeoJSON} - decodes a feature back from its GeoJSON
     * content, preserving its original id (see {@link geoJSONCodecPreserveIds}).
     *
     * @param content the GeoJSON content to decode.
     * @param srsName currently unused (kept for a possible future need).
     * @returns the decoded feature, or null if the content decodes to no features.
     */
    public static decodeFeatureFromGeoJSON(content: string, srsName: string) {
        const cursor = geoJSONCodecPreserveIds.decode({content, contentType: "application/geo+json"});
        return cursor.hasNext() ? cursor.next() : null;
    }

    /**
     * Converts a feature to the intermediate {@link GMLFeature} JSON shape via
     * {@link encodeFeatureToGeoJSON}, then applies this encoder's schema-specific
     * wrapping/remapping (`wrapToMulti*`, {@link decomposeGeometries},
     * {@link normalizeGMLGeometry}) so the result matches the target server schema.
     *
     * @param feature the feature to convert.
     * @returns the schema-adjusted intermediate representation, or null if
     *          {@link encodeFeatureToGeoJSON} produced no usable geometry.
     */
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
    /**
     * Shared by {@link wrapToMultiSurface}/{@link wrapToMultiCurve}/{@link wrapToMultiPoint}'s
     * call sites: wraps a lone `singleType` geometry into a single-member Multi* structure, or -
     * if it's already a `multiTypeName` - just remaps its `type` to the GML type name the server
     * actually advertises (e.g. GeoJSON's `"MultiPolygon"` -> GML's `"MultiSurface"`).
     *
     * @param featureAsJson the feature whose geometry may be wrapped/remapped (mutated in place).
     * @param enabled       whether this wrapping is active at all (the relevant `wrapToMulti*` flag).
     * @param singleType    the GeoJSON type name that should get wrapped (e.g. `"Polygon"`).
     * @param multiTypeName the GeoJSON multi-type name that should get remapped (e.g. `"MultiPolygon"`).
     * @param wrapId        the `id` assigned to a newly-created wrapper geometry.
     * @param wrapType      the GML type name to write (e.g. `"MultiSurface"`).
     */
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

    /**
     * Flattens a `MultiGeometry`/`MultiPolygon`/`MultiSurface`/`MultiPoint`/`MultiLineString`
     * into its individual member geometries (recursively, for nested `MultiGeometry`) - used by
     * {@link SingleFeatureGMLasJSONEncode} when re-wrapping into a `MultiGeometry` structure.
     *
     * @param geometry the geometry to decompose.
     * @returns the flat list of member geometries, or `[geometry]` unchanged if it isn't one of
     *          the multi-types this handles.
     */
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
