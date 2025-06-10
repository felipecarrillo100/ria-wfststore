import {Feature} from "@luciad/ria/model/feature/Feature";
import {GMLFeatureEncoder} from "./GMLFeatureEncoder";
import {GMLGeometryTypeKey, GMLGeometryTypeToGeometry, WFSFeatureDescription} from "./ParseWFSFeatureDescription";
import {create} from "xmlbuilder2";
import {WFSTInvalidGeometry} from "./WFSTInvalidGeometry";
import {GeoJsonCodec} from "@luciad/ria/model/codec/GeoJsonCodec";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {WFSTEditFeatureLockItem} from "../WFSTFeatureStore";

interface WFSTAddUpdateRequestOptions {
    typeName: string;
    feature: Feature;
    featureDescription: WFSFeatureDescription,
    onlyProperties?: boolean;
    prettyPrint?: boolean
    invertAxes?: boolean;
}

interface WFSTRemoveRequestOptions {
    typeName: string;
    rid: number | string;
    prettyPrint?: boolean
}

interface WFSTGetFeatureWithLockOptions {
    typeName: string;
    rids: string[] | number[],
    expiry?: number
    prettyPrint?: boolean
}

interface WFSTCommitLockTransaction {
    lockItem: WFSTEditFeatureLockItem;
    typeName: string;
    featureDescription: WFSFeatureDescription,
    prettyPrint?: boolean;
    invertAxes?: boolean;
}

interface ReleaseLockOptions {
    lockId: string;
    prettyPrint?: boolean
}

interface TransactionQueryOptions {
    typeName: string;
    rids: string[];
    outputFormat?: string;
    prettyPrint?: boolean
}

export class WFSTQueries {

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

    private static singleDelete2_0_0(options: WFSTRemoveRequestOptions) {
        return `<wfs:Delete typeName="${options.typeName}">
      <fes:Filter>
         <fes:ResourceId rid="${options.rid}"/>
      </fes:Filter>
   </wfs:Delete>`;
    }

    public static TransactionAddRequest2_0_0(options: WFSTAddUpdateRequestOptions) {
        return this.prettyPrint(`<?xml version="1.0" ?>
<wfs:Transaction xmlns:wfs="http://www.opengis.net/wfs/2.0" xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:ows="http://www.opengis.net/ows/1.1" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:gml="http://www.opengis.net/gml/3.2" service="WFS" version="2.0.0">
${this.singleAdd2_0_0(options)}
</wfs:Transaction>
`, options.prettyPrint);
    }

    private static singleAdd2_0_0( options: WFSTAddUpdateRequestOptions ) {
        const properties = this.propertiesAsGMLForAdd(options.feature);
        const targetGeometry = options.featureDescription.geometry.type as GMLGeometryTypeKey;
        const gmlEncoder = new GMLFeatureEncoder({targetGeometry, gmlVersion: "3.2", invert: options.invertAxes});
        const {geometry, geometryType} = gmlEncoder.encodeFeature(options.feature);
        this.verifyGeometryCompatibilityOrThrowError(geometryType, targetGeometry);
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

    private static verifyGeometryCompatibilityOrThrowError(geometry: string, targetGeometry: GMLGeometryTypeKey) {
        if (GMLGeometryTypeToGeometry(targetGeometry) === "Geometry") return;
        if (geometry !== GMLGeometryTypeToGeometry(targetGeometry)) throw new WFSTInvalidGeometry(`${targetGeometry}`);
    }

    private static prettyPrint(xmlContent: string, pretty = false) {
            // Parse the XML string into a document
            const doc = create(xmlContent);
            // Convert the document back to a string
            return doc.end({ prettyPrint: pretty });
    }

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

    private static singleUpdate2_0_0(options: WFSTAddUpdateRequestOptions) {
        const properties = this.propertiesAsGMLForUpdate(options.feature);
        let geometryContent : string;
        if (options.onlyProperties) {
            geometryContent = ""
        } else {
            const targetGeometry = options.featureDescription.geometry.type as GMLGeometryTypeKey;
            const gmlEncoder = new GMLFeatureEncoder({targetGeometry, gmlVersion: "3.2", invert: options.invertAxes});
            const {geometry, geometryType} = gmlEncoder.encodeFeature(options.feature);
            this.verifyGeometryCompatibilityOrThrowError(geometryType, targetGeometry);
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

    private static propertiesAsGMLForUpdate(feature: Feature, inPrefix?: string) {
        const prefix = inPrefix ? inPrefix : "wfs";
        let properties = "";
        for (const key in feature.properties) {
            if (feature.properties.hasOwnProperty(key)) {
                const s =
`<${prefix}:Property>
    <${prefix}:ValueReference>${key}</${prefix}:ValueReference>
    <${prefix}:Value>${feature.properties[key]}</${prefix}:Value>
</${prefix}:Property>
`
                properties+=s;
            }
        }
        return properties;
    }

    private static propertiesAsGMLForAdd(feature: Feature, inPrefix?: string) {
        const prefix = inPrefix ? inPrefix : "tns";
        let properties = "";
        for (const key in feature.properties) {
            if (feature.properties.hasOwnProperty(key)) {
                const s = `<${prefix}:${key}>${feature.properties[key]}</${prefix}:${key}>`
                properties+=s;
            }
        }
        return properties;
    }


    private static encodeJSONFeatureHelper(jsonFeature: string, srsName: string): Feature {
        const reference = getReference(srsName);
        const jsonDecoder = new GeoJsonCodec({generateIDs: false, reference});
        const cursor = jsonDecoder.decode({content: jsonFeature, contentType:"application/json"});
        if (cursor.hasNext()) {
            return cursor.next() as Feature;
        } else {
            return null;
        }
    }
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
            feature: this.encodeJSONFeatureHelper(element.feature, options.lockItem.srsName),
            featureDescription: options.featureDescription,
            onlyProperties: element.onlyProperties,
            prettyPrint: options.prettyPrint,
            invertAxes: options.invertAxes
        }));
        const insertedItems = options.lockItem.insertedIds.map(element=> this.singleAdd2_0_0({
            typeName: options.typeName,
            feature: this.encodeJSONFeatureHelper(element.feature, options.lockItem.srsName),
            featureDescription: options.featureDescription,
            prettyPrint: options.prettyPrint,
            invertAxes: options.invertAxes
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

    public static ReleaseLock2_0_0(options: ReleaseLockOptions) {
        return this.prettyPrint(`<wfs:ReleaseLock
    service="WFS"
    version="2.0.0"
    lockId="${options.lockId}"
    xmlns:wfs="http://www.opengis.net/wfs/2.0">
</wfs:ReleaseLock>`, options.prettyPrint);
    }

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
