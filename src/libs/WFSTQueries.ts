import {Feature} from "@luciad/ria/model/feature/Feature";
import {GMLFeatureEncoder} from "./GMLFeatureEncoder";
import {filterPropertiesToSchema, GMLGeometryTypeKey, WFSFeatureDescription} from "./ParseWFSFeatureDescription";
import {create} from "xmlbuilder2";
import {WFSTEditFeatureLockItem} from "../types/WFSTTypes";
import {decodeStoredFeature, verifyGeometryCompatibilityOrThrowError} from "./WFSTFeaturePreparation";

/** Options shared by {@link WFSTQueries.TransactionAddRequest2_0_0}/{@link WFSTQueries.TransactionUpdateRequest2_0_0} (and their single-feature counterparts). */
interface WFSTAddUpdateRequestOptions {
    typeName: string;
    feature: Feature;
    featureDescription: WFSFeatureDescription,
    /** Update only, and only when true: omit the geometry `<wfs:Property>` entirely, sending property changes alone. */
    onlyProperties?: boolean;
    prettyPrint?: boolean
    invertAxes?: boolean;
    mode3D?: boolean;
}

/** Options for {@link WFSTQueries.TransactionDeleteRequest2_0_0}. */
interface WFSTRemoveRequestOptions {
    typeName: string;
    rid: number | string;
    prettyPrint?: boolean
}

/** Options for {@link WFSTQueries.GetFeatureWithLock2_0_0}/{@link WFSTQueries.LockFeature2_0_0}. */
interface WFSTGetFeatureWithLockOptions {
    typeName: string;
    rids: string[] | number[],
    /** Lock duration in minutes (converted to seconds in the request); defaults to 5 minutes if omitted. */
    expiry?: number
    prettyPrint?: boolean
}

/** Options for {@link WFSTQueries.TransactionCommitLock_2_0_0}. */
interface WFSTCommitLockTransaction {
    lockItem: WFSTEditFeatureLockItem;
    typeName: string;
    featureDescription: WFSFeatureDescription,
    prettyPrint?: boolean;
    invertAxes?: boolean;
    mode3D?: boolean;
}

/** Options for {@link WFSTQueries.ReleaseLock2_0_0}. */
interface ReleaseLockOptions {
    lockId: string;
    prettyPrint?: boolean
}

/** Options for {@link WFSTQueries.TransactionQueryByIds_2_0_0}. */
interface TransactionQueryOptions {
    typeName: string;
    rids: string[];
    outputFormat?: string;
    prettyPrint?: boolean
}

/**
 * Builds every WFS 2.0.0 request body {@link WFSTFeatureStore} sends, as raw XML strings -
 * `GetFeature` (by resource id), `Transaction` (Insert/Update/Delete, individually or combined
 * for a lock commit), `GetFeatureWithLock`, `LockFeature`, and `ReleaseLock`.
 *
 * Geometry encoding within these requests is delegated to {@link GMLFeatureEncoder}, configured
 * per-call against the target feature type's own schema (`featureDescription`).
 */
export class WFSTQueries {

    /**
     * Builds a `GetFeature` request filtered to an explicit set of resource ids (a WFS-T
     * `GetFeature`, not a `Transaction` - used for reading features back, e.g. by
     * {@link WFSTFeatureStore.queryByRids}).
     *
     * @param options the type name, ids to fetch, and optional output format override.
     * @returns the request XML.
     */
    public static TransactionQueryByIds_2_0_0(options: TransactionQueryOptions) {
        const allRids = options.rids.map(rid=>`<fes:ResourceId rid="${rid}"/>`)
        const outputFormat =  options.outputFormat ? options.outputFormat : "application/gml+xml; version=3.2";
        return this.prettyPrint(`<?xml version="1.0" encoding="UTF-8"?>
<wfs:GetFeature xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:gml="http://www.opengis.net/gml/3.2" xmlns:xlink="http://www.w3.org/1999/xlink" service="WFS" outputFormat="${outputFormat}" count="500" version="2.0.0">
    <wfs:Query typeNames="${options.typeName}">
        <fes:Filter>         
            <fes:Or>
                ${allRids.join(" ")}                
            </fes:Or>
        </fes:Filter>
    </wfs:Query>
</wfs:GetFeature>`, options.prettyPrint)
    }

    /**
     * Builds a `Transaction` request deleting a single feature - see
     * {@link WFSTFeatureStore.remove}.
     *
     * @param options the type name and id of the feature to delete.
     * @returns the request XML.
     */
    public static TransactionDeleteRequest2_0_0(options: WFSTRemoveRequestOptions) {
        // Sample source: https://gist.github.com/SKalt/0f4b757209687331c8a1d40aecbf69f9
        return this.prettyPrint(`<?xml version="1.0" ?>
<wfs:Transaction
   version="2.0.0"
   service="WFS"
   xmlns:fes="http://www.opengis.net/fes/2.0"
   xmlns:wfs="http://www.opengis.net/wfs/2.0"
   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
   xsi:schemaLocation="http://www.opengis.net/wfs/2.0
http://schemas.opengis.net/wfs/2.0/wfs.xsd">
${this.singleDelete2_0_0(options)}
</wfs:Transaction>`, options.prettyPrint);
    }

    /** @returns just the inner `<wfs:Delete>` fragment for one feature - shared by {@link TransactionDeleteRequest2_0_0} and {@link TransactionCommitLock_2_0_0}'s batch of deletes. */
    private static singleDelete2_0_0(options: WFSTRemoveRequestOptions) {
        return `<wfs:Delete typeName="${options.typeName}">
      <fes:Filter>
         <fes:ResourceId rid="${options.rid}"/>
      </fes:Filter>
   </wfs:Delete>`;
    }

    /**
     * Builds a `Transaction` request inserting a single feature - see
     * {@link WFSTFeatureStore.add}.
     *
     * @param options the feature to insert, its type's schema, and encoding options.
     * @returns the request XML.
     */
    public static TransactionAddRequest2_0_0(options: WFSTAddUpdateRequestOptions) {
        return this.prettyPrint(`<?xml version="1.0" ?>
<wfs:Transaction xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:gml="http://www.opengis.net/gml/3.2" service="WFS" version="2.0.0">
${this.singleAdd2_0_0(options)}
</wfs:Transaction>
`, options.prettyPrint);
    }

    /**
     * @returns just the inner `<wfs:Insert>` fragment for one feature - shared by
     *          {@link TransactionAddRequest2_0_0} and {@link TransactionCommitLock_2_0_0}'s batch
     *          of inserts. Encodes the geometry against `options.featureDescription`'s own schema
     *          via {@link GMLFeatureEncoder}, and throws if the feature's geometry type turns out
     *          incompatible with the schema (see {@link verifyGeometryCompatibilityOrThrowError}).
     */
    private static singleAdd2_0_0( options: WFSTAddUpdateRequestOptions ) {
        const properties = this.propertiesAsGMLForAdd(options.feature, options.featureDescription);
        const targetGeometry = options.featureDescription.geometry.type as GMLGeometryTypeKey;
        const gmlEncoder = new GMLFeatureEncoder({targetGeometry, gmlVersion: "3.2", invert: options.invertAxes, mode3D: options.mode3D});
        const {geometry, geometryType} = gmlEncoder.encodeFeature(options.feature);
        verifyGeometryCompatibilityOrThrowError(geometryType, targetGeometry);
        const split = options.typeName.split(":");
        const typeNameMin = split.length > 1 ? split[1] : split[0];
        const tns = options.featureDescription.tns ? options.featureDescription.tns : (split.length > 1 ? split[0] : null);
        const geometryName = options.featureDescription.geometry.name;
        return `<wfs:Insert handle="AddHandle">
    <tns:${typeNameMin}  ${tns ? `xmlns:tns="${tns}"` : ''}>
      <tns:${geometryName}>
          ${geometry}
      </tns:${geometryName}>
      ${properties}
    </tns:${typeNameMin}>
  </wfs:Insert>`;
    }

    /** @returns `xmlContent` re-serialized, pretty-printed if `pretty` is true - the common post-processing step for every request builder here. */
    private static prettyPrint(xmlContent: string, pretty = false) {
            // Parse the XML string into a document
            const doc = create(xmlContent);
            // Convert the document back to a string
            return doc.end({ prettyPrint: pretty });
    }

    /**
     * Builds a `Transaction` request updating a single feature (geometry and/or properties) -
     * see {@link WFSTFeatureStore.put}/{@link WFSTFeatureStore.putProperties}.
     *
     * @param options the feature's new state, its type's schema, and encoding options.
     * @returns the request XML.
     */
    public static TransactionUpdateRequest2_0_0(options: WFSTAddUpdateRequestOptions) {
        return this.prettyPrint(`<?xml version="1.0" ?>
<wfs:Transaction
   version="2.0.0"
   service="WFS"
   xmlns:fes="http://www.opengis.net/fes/2.0"
   xmlns:gml="http://www.opengis.net/gml/3.2"
   xmlns:wfs="http://www.opengis.net/wfs/2.0"
   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
   xsi:schemaLocation="http://www.opengis.net/wfs/2.0
http://schemas.opengis.net/wfs/2.0.0/wfs.xsd">
${this.singleUpdate2_0_0(options)}
</wfs:Transaction>`, options.prettyPrint)
    }

    /**
     * @returns just the inner `<wfs:Update>` fragment for one feature - shared by
     *          {@link TransactionUpdateRequest2_0_0} and {@link TransactionCommitLock_2_0_0}'s
     *          batch of updates. Omits the geometry property entirely when
     *          `options.onlyProperties` is true; otherwise encodes and validates it the same way
     *          {@link singleAdd2_0_0} does.
     */
    private static singleUpdate2_0_0(options: WFSTAddUpdateRequestOptions) {
        const properties = this.propertiesAsGMLForUpdate(options.feature, options.featureDescription);
        let geometryContent : string;
        if (options.onlyProperties) {
            geometryContent = ""
        } else {
            const targetGeometry = options.featureDescription.geometry.type as GMLGeometryTypeKey;
            const gmlEncoder = new GMLFeatureEncoder({targetGeometry, gmlVersion: "3.2", invert: options.invertAxes, mode3D: options.mode3D});
            const {geometry, geometryType} = gmlEncoder.encodeFeature(options.feature);
            verifyGeometryCompatibilityOrThrowError(geometryType, targetGeometry);
            const geometryName = options.featureDescription.geometry.name;
            geometryContent = `<wfs:Property>
        <wfs:ValueReference>${geometryName}</wfs:ValueReference>
        <wfs:Value>
          ${geometry}
        </wfs:Value>
      </wfs:Property>`
        }
      // Final result
        return `<wfs:Update typeName="${options.typeName}">
      ${properties}
      ${geometryContent}
      <fes:Filter>
         <fes:ResourceId rid="${options.feature.id}"/>
      </fes:Filter>
   </wfs:Update>`;
    }

    /**
     * @returns `feature.properties` as a series of `<wfs:Property>` elements, for an Update
     *          request - filtered to `featureDescription`'s own schema first (see
     *          {@link filterPropertiesToSchema}), so a property not declared by the server's own
     *          `DescribeFeatureType` (e.g. `boundedBy`, injected by a schema-agnostic GML decoder)
     *          is never sent back to it.
     */
    private static propertiesAsGMLForUpdate(feature: Feature, featureDescription: WFSFeatureDescription, inPrefix?: string) {
        const prefix = inPrefix ? inPrefix : "wfs";
        const properties = filterPropertiesToSchema(featureDescription, feature.properties);
        let result = "";
        for (const key in properties) {
            if (properties.hasOwnProperty(key)) {
                const s =
`<${prefix}:Property>
    <${prefix}:ValueReference>${key}</${prefix}:ValueReference>
    <${prefix}:Value>${properties[key]}</${prefix}:Value>
</${prefix}:Property>
`
                result+=s;
            }
        }
        return result;
    }

    /**
     * @returns `feature.properties` as a series of `<tns:propertyName>value</tns:propertyName>`
     *          elements, for an Insert request (a different shape than
     *          {@link propertiesAsGMLForUpdate}'s `<wfs:Property>` wrapper, per the WFS-T spec) -
     *          filtered to `featureDescription`'s own schema first, same as
     *          {@link propertiesAsGMLForUpdate}.
     */
    private static propertiesAsGMLForAdd(feature: Feature, featureDescription: WFSFeatureDescription, inPrefix?: string) {
        const prefix = inPrefix ? inPrefix : "tns";
        const properties = filterPropertiesToSchema(featureDescription, feature.properties);
        let result = "";
        for (const key in properties) {
            if (properties.hasOwnProperty(key)) {
                const s = `<${prefix}:${key}>${properties[key]}</${prefix}:${key}>`
                result+=s;
            }
        }
        return result;
    }


    /**
     * Builds a single combined `Transaction` request committing every pending edit in a lock
     * (inserts, updates, deletes) at once - see {@link WFSTFeatureStore.commitLockTransaction}.
     * Pending features are stored serialized (see
     * {@link WFSTFeatureLockStore.encodePendingFeature}) and decoded back via
     * {@link decodeStoredFeature} before being encoded into this request.
     *
     * @param options the lock's accumulated edits, the type's schema, and encoding options.
     * @returns the request XML, carrying the lock's `lockId` so the server can validate it.
     */
    public static TransactionCommitLock_2_0_0(options: WFSTCommitLockTransaction ) {
        const deletedItems = options.lockItem.deletedIds.map(element=> this.singleDelete2_0_0(
            {
                typeName: options.typeName,
                rid: element,
                prettyPrint: options.prettyPrint
            }));
        // Avoid sending geometry when only properties changed (onlyProperties boolean)
        const updatedItems = options.lockItem.updatedIds.map(element=> this.singleUpdate2_0_0({
            typeName: options.typeName,
            feature: decodeStoredFeature(element.feature, options.lockItem.srsName),
            featureDescription: options.featureDescription,
            onlyProperties: element.onlyProperties,
            prettyPrint: options.prettyPrint,
            invertAxes: options.invertAxes,
            mode3D: options.mode3D
        }));
        const insertedItems = options.lockItem.insertedIds.map(element=> this.singleAdd2_0_0({
            typeName: options.typeName,
            feature: decodeStoredFeature(element.feature, options.lockItem.srsName),
            featureDescription: options.featureDescription,
            prettyPrint: options.prettyPrint,
            invertAxes: options.invertAxes,
            mode3D: options.mode3D
        }));

        return this.prettyPrint(`<?xml version="1.0" ?>
<wfs:Transaction
   version="2.0.0"
   lockId="${options.lockItem.lockId}"
   service="WFS"
   xmlns:fes="http://www.opengis.net/fes/2.0"
   xmlns:gml="http://www.opengis.net/gml/3.2"
   xmlns:wfs="http://www.opengis.net/wfs/2.0"
   xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
   xsi:schemaLocation="http://www.opengis.net/wfs/2.0
http://schemas.opengis.net/wfs/2.0.0/wfs.xsd">
        ${insertedItems.join(" ")}
        ${updatedItems.join(" ")}
        ${deletedItems.join(" ")}
</wfs:Transaction>`, options.prettyPrint)
    }

    /**
     * Builds a `GetFeatureWithLock` request - locks the given features and returns them in one
     * response - see {@link WFSTFeatureStore.getFeatureWithLock}.
     *
     * @param options the type name, ids to lock, and lock expiry.
     * @returns the request XML.
     */
    public static GetFeatureWithLock2_0_0(options: WFSTGetFeatureWithLockOptions ) {
        const allRids = options.rids.map(rid=>`<fes:ResourceId rid="${rid}"/>`);
        // Expiry is in seconds, 300 = 5 minutes. Our options.expiry is in minutes, therefor we multiply * 60
        const expiry = typeof options.expiry !== "undefined" ? `${options.expiry*60}` : "300";
        return this.prettyPrint(`<?xml version="1.0" ?>
<wfs:GetFeatureWithLock
    service="WFS"
    version="2.0.0"
    xmlns:wfs="http://www.opengis.net/wfs/2.0"
    xmlns:fes="http://www.opengis.net/fes/2.0"
    xmlns:gml="http://www.opengis.net/gml/3.2"
    xmlns:example="http://www.example.com"
    outputFormat="application/gml+xml; version=3.2"
    expiry="${expiry}"
    lockAction="ALL">    
    <wfs:Query typeNames="${options.typeName}">
        <fes:Filter>         
            <fes:Or>
                ${allRids.join(" ")}                
            </fes:Or>
        </fes:Filter>
    </wfs:Query>
</wfs:GetFeatureWithLock>`, options.prettyPrint);
    }

    /**
     * Builds a `ReleaseLock` request - releases a previously-acquired lock without committing or
     * discarding its edits server-side (the pending edits still live client-side until the lock
     * store is discarded).
     *
     * @param options the lock id to release.
     * @returns the request XML.
     */
    public static ReleaseLock2_0_0(options: ReleaseLockOptions) {
        return this.prettyPrint(`<wfs:ReleaseLock
    service="WFS"
    version="2.0.0"
    lockId="${options.lockId}"
    xmlns:wfs="http://www.opengis.net/wfs/2.0">
</wfs:ReleaseLock>`, options.prettyPrint);
    }

    /**
     * Builds a `LockFeature` request - like {@link GetFeatureWithLock2_0_0}, but locks the
     * features without fetching their data - see {@link WFSTFeatureStore.lockFeatures}.
     *
     * @param options the type name, ids to lock, and lock expiry.
     * @returns the request XML.
     */
    static LockFeature2_0_0(options: WFSTGetFeatureWithLockOptions ) {
        const allRids = options.rids.map(rid=>`<fes:ResourceId rid="${rid}"/>`);
        // Expiry is in seconds, 300 = 5 minutes. Our options.expiry is in minutes, therefor we multiply * 60
        const expiry = typeof options.expiry !== "undefined" ? `${options.expiry*60}` : "300";
        return this.prettyPrint(`<?xml version="1.0" ?>
<wfs:LockFeature
    service="WFS"
    version="2.0.0"
    xmlns:wfs="http://www.opengis.net/wfs/2.0"
    xmlns:fes="http://www.opengis.net/fes/2.0"
    xmlns:gml="http://www.opengis.net/gml/3.2"
    xmlns:example="http://www.example.com"
    expiry="${expiry}"
    lockAction="ALL">    
    <wfs:Query typeNames="${options.typeName}">
        <fes:Filter>         
            <fes:Or>
                ${allRids.join(" ")}                
            </fes:Or>
        </fes:Filter>
    </wfs:Query>
</wfs:GetFeatureWithLock>`, options.prettyPrint);
    }
}
