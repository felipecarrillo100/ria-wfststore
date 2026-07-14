import {Feature} from "@luciad/ria/model/feature/Feature";
import {Cursor} from "@luciad/ria/model/Cursor";
import {EncodeResult} from "@luciad/ria/model/codec/Codec";
import {GMLCodec, GMLCodecConstructorOptions} from "@luciad/ria/model/codec/GMLCodec";
import {GeoJsonCodec} from "@luciad/ria/model/codec/GeoJsonCodec";
import {Shape} from "@luciad/ria/shape/Shape";
import {ProgrammingError} from "@luciad/ria/error/ProgrammingError";
import {create} from "xmlbuilder2";
import {XMLBuilder} from "xmlbuilder2/lib/interfaces";
import {encodeFeatureToGML, GMLFeature} from "./encodeFeatureToGML";
import {encodeGeometryToGML} from "./encodeGeometryToGML";
import {GMLGeometry} from "./GMLGeometry";
import {normalizeGMLGeometry, normalizeSrsName} from "./normalizeGMLGeometry";
import {GMLFeatureEncoder} from "../../GMLFeatureEncoder";

export interface AdvancedGMLCodecConstructorOptions extends GMLCodecConstructorOptions {
    /** GML version used for encode() output only; decode() auto-detects as GMLCodec already does. @default '3.2' */
    gmlVersion?: '3.2' | '3.1.1';
    /** Passed through to the geometry encoder for every feature/shape. @default true */
    usePosList?: boolean;
    /** gml:id assigned to the <gml:FeatureCollection> root produced by encode(). Auto-generated if omitted. */
    featureCollectionId?: string;
    /**
     * `true`/`false` forces 3D/2D output for every feature/shape encoded by this codec instance.
     * Omitted (the default) auto-detects per geometry from its own coordinates - unlike
     * {@link GeoJsonCodec.mode3D}, which defaults to `false` (always 2D) when omitted.
     */
    mode3D?: boolean;
}

const DEFAULT_OUTPUT_GML_3_2 = "application/gml+xml; version=3.2";
const DEFAULT_OUTPUT_GML_3_1_1 = "text/xml; subtype=gml/3.1.1";

/**
 * A GML codec that both encodes and decodes GML, unlike RIA's own {@link GMLCodec} which only decodes
 * (its `encode()` always throws). Decoding is entirely delegated to the inherited {@link GMLCodec.decode},
 * so this class only adds real encode support on top of it, following the same method-granularity
 * convention as {@link GeoJsonCodec} (`encode`, `encodeShape`) plus a single-feature `encodeFeature`.
 *
 * Unlike {@link GMLFeatureEncoder} (used internally for WFS-T transactions against a specific, known
 * server feature-type schema), this codec is schema-independent: it encodes each feature's/shape's own
 * natural geometry type and makes no attempt to wrap/upgrade geometries to match a target type.
 */
export class AdvancedGMLCodec<TFeature extends Feature = Feature> extends GMLCodec<TFeature> {
    private readonly gmlVersion: '3.2' | '3.1.1';
    private readonly usePosListOption: boolean;
    private readonly swapAxesOption?: string[];
    private readonly featureCollectionId?: string;
    // mode3D:true unconditionally: an internal-only intermediate representation should always
    // preserve Z faithfully. Whether the final GML actually gets written in 3D is decided later,
    // per this.mode3D, at the point of GML serialization.
    private readonly shapeCodec = new GeoJsonCodec({mode3D: true});
    private readonly mode3D?: boolean;

    constructor(options?: AdvancedGMLCodecConstructorOptions) {
        super(options);
        this.gmlVersion = options?.gmlVersion ?? '3.2';
        this.usePosListOption = options?.usePosList ?? true;
        // GMLCodec keeps its own options in private fields with no getters, so we keep our own copy
        // of the one field encode() needs.
        this.swapAxesOption = options?.swapAxes;
        this.featureCollectionId = options?.featureCollectionId;
        // No ?? default here (unlike usePosListOption above): undefined must stay undefined to
        // trigger auto-detection, not collapse to a fixed default.
        this.mode3D = options?.mode3D;
    }

    // decode() is intentionally not overridden: it is inherited from GMLCodec as-is.

    encode(featureCursor: Cursor<TFeature>): EncodeResult {
        const xmlns = this.gmlVersion === '3.1.1' ? 'http://www.opengis.net/gml' : 'http://www.opengis.net/gml/3.2';
        const doc = create({version: '1.0', encoding: 'UTF-8'});
        const collection = doc.ele('gml:FeatureCollection', {
            'xmlns:gml': xmlns,
            'gml:id': this.featureCollectionId ?? AdvancedGMLCodec.generateId('FC')
        });

        while (featureCursor.hasNext()) {
            const feature = featureCursor.next();
            this.encodeFeatureInto(feature, collection.ele('gml:featureMember'));
        }

        return {
            content: doc.end({prettyPrint: false}),
            contentType: this.gmlVersion === '3.1.1' ? DEFAULT_OUTPUT_GML_3_1_1 : DEFAULT_OUTPUT_GML_3_2
        };
    }

    /**
     * Encodes a single feature into a standalone `<gml:Feature>` document (its own XML declaration,
     * not wrapped in a FeatureCollection) — the single-feature counterpart to {@link encode}.
     */
    encodeFeature(feature: TFeature): string {
        return this.encodeFeatureInto(feature);
    }

    /**
     * Encodes a single {@link Shape} into a GML geometry fragment, mirroring {@link GeoJsonCodec.encodeShape}.
     * GML has no natural "object" representation the way GeoJSON does, so the returned value is an XML
     * string (e.g. `<gml:Point>...</gml:Point>`) rather than a plain object.
     */
    encodeShape(shape: Shape | null): string | null {
        if (!shape) return null;
        const geoJsonGeometry = this.shapeCodec.encodeShape(shape);
        if (!geoJsonGeometry) return null;
        const gmlGeometry = normalizeGMLGeometry({
            ...geoJsonGeometry,
            srsName: normalizeSrsName(shape.reference.identifier)
        } as GMLGeometry);
        return encodeGeometryToGML(gmlGeometry, {
            gmlVersion: this.gmlVersion,
            usePosList: this.usePosListOption,
            invert: this.shouldInvert(shape.reference.identifier),
            mode3D: this.mode3D
        });
    }

    private encodeFeatureInto(feature: Feature, inDoc?: XMLBuilder): string {
        if (!feature.shape) {
            throw new ProgrammingError("AdvancedGMLCodec: features without a shape are not supported");
        }
        const gmlFeatureJSON = this.toGMLFeatureJSON(feature);
        return encodeFeatureToGML(gmlFeatureJSON, {
            gmlVersion: this.gmlVersion,
            usePosList: this.usePosListOption,
            invert: this.shouldInvert(feature.shape.reference.identifier),
            mode3D: this.mode3D,
            inDoc
        });
    }

    private toGMLFeatureJSON(feature: Feature): GMLFeature {
        const {content, srsName} = GMLFeatureEncoder.encodeFeatureToGeoJSON(feature);
        const featureAsJson = JSON.parse(content) as GMLFeature;
        featureAsJson.geometry = normalizeGMLGeometry({
            ...featureAsJson.geometry,
            srsName: normalizeSrsName(srsName)
        });
        return featureAsJson;
    }

    private shouldInvert(referenceIdentifier: string): boolean | undefined {
        return this.swapAxesOption?.includes(referenceIdentifier);
    }

    private static generateId(prefix: string): string {
        return `${prefix}-${Math.random().toString(36).slice(2)}`;
    }
}
