import {Feature} from "@luciad/ria/model/feature/Feature";
import {GMLGeometryTypeKey, GMLGeometryTypeToGeometry} from "./ParseWFSFeatureDescription";
import {WFSTInvalidGeometry} from "./WFSTInvalidGeometry";
import {GeoJsonCodec} from "@luciad/ria/model/codec/GeoJsonCodec";
import {AdvancedGMLCodec} from "./gml/gml32/AdvancedGMLCodec";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";

// Safety net, not the primary compatibility check (see areCompatibleGeometries in
// ParseWFSFeatureDescription.ts for that): throws if the GML geometry type GMLFeatureEncoder
// actually produced still doesn't match what the server's DescribeFeatureType advertised for
// this field, which would mean wrapToMulti*/normalizeGMLGeometry didn't already reconcile it.
export function verifyGeometryCompatibilityOrThrowError(geometry: string, targetGeometry: GMLGeometryTypeKey): void {
    if (GMLGeometryTypeToGeometry(targetGeometry) === "Geometry") return;
    if (geometry !== GMLGeometryTypeToGeometry(targetGeometry)) throw new WFSTInvalidGeometry(`${targetGeometry}`);
}

// Decodes a feature previously stored as either a JSON or a GML string (WFSTFeatureLockStore's
// insertedIds/updatedIds bookkeeping, see WFSTFeatureLocksStorage) back into a real Feature, so
// it can be re-templated into WFS-T XML when a lock is committed. WFSTFeatureLockStore stores GML
// instead of GeoJSON specifically when its own delegate store is GML-configured (see its
// useGMLSerialization) - GeoJSON cannot represent Circle/Arc at all, so a locked Circle/Arc edit
// could never survive a commit otherwise. The two formats are trivially distinguishable by their
// first character (GML always starts with an XML declaration/tag, JSON always with "{"), so
// detecting from content avoids threading a separate format flag through the lock item itself.
export function decodeStoredFeature(storedFeature: string, srsName: string): Feature | null {
    const reference = getReference(srsName);
    if (storedFeature.trim().startsWith("<")) {
        const cursor = new AdvancedGMLCodec({reference}).decode({content: storedFeature});
        return cursor && cursor.hasNext() ? cursor.next() as Feature : null;
    }
    // mode3D:true: this must stay symmetric with GMLFeatureEncoder's own internal codecs, or Z
    // gets silently dropped here, one hop before the feature is re-encoded for the WFS-T request.
    const jsonDecoder = new GeoJsonCodec({generateIDs: false, reference, mode3D: true});
    const cursor = jsonDecoder.decode({content: storedFeature, contentType: "application/json"});
    return cursor.hasNext() ? cursor.next() as Feature : null;
}
