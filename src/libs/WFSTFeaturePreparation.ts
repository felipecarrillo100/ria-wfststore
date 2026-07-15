import {Feature} from "@luciad/ria/model/feature/Feature";
import {GMLGeometryTypeKey, GMLGeometryTypeToGeometry} from "./ParseWFSFeatureDescription";
import {WFSTInvalidGeometry} from "./WFSTInvalidGeometry";
import {GeoJsonCodec} from "@luciad/ria/model/codec/GeoJsonCodec";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";

// Safety net, not the primary compatibility check (see areCompatibleGeometries in
// ParseWFSFeatureDescription.ts for that): throws if the GML geometry type GMLFeatureEncoder
// actually produced still doesn't match what the server's DescribeFeatureType advertised for
// this field, which would mean wrapToMulti*/normalizeGMLGeometry didn't already reconcile it.
export function verifyGeometryCompatibilityOrThrowError(geometry: string, targetGeometry: GMLGeometryTypeKey): void {
    if (GMLGeometryTypeToGeometry(targetGeometry) === "Geometry") return;
    if (geometry !== GMLGeometryTypeToGeometry(targetGeometry)) throw new WFSTInvalidGeometry(`${targetGeometry}`);
}

// Decodes a feature previously stored as a JSON string (WFSTFeatureLockStore's insertedIds/
// updatedIds bookkeeping, see WFSTFeatureLocksStorage) back into a real Feature, so it can be
// re-templated into WFS-T XML when a lock is committed.
export function decodeStoredJSONFeature(jsonFeature: string, srsName: string): Feature | null {
    const reference = getReference(srsName);
    // mode3D:true: this must stay symmetric with GMLFeatureEncoder's own internal codecs, or Z
    // gets silently dropped here, one hop before the feature is re-encoded for the WFS-T request.
    const jsonDecoder = new GeoJsonCodec({generateIDs: false, reference, mode3D: true});
    const cursor = jsonDecoder.decode({content: jsonFeature, contentType: "application/json"});
    return cursor.hasNext() ? cursor.next() as Feature : null;
}
