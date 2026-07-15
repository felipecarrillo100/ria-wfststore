import {MemoryStore} from "@luciad/ria/model/store/MemoryStore";
import {WFSTFeatureLocksStorage} from "./libs/storage/WFSTFeatureLocksStorage";
import {getReference} from "@luciad/ria/reference/ReferenceProvider";
import {WFSTEditFeatureLockItem, WFSTFeatureStore, WFSTFeatureStoreConstructorOptions} from "./WFSTFeatureStore";
import {CoordinateReference} from "@luciad/ria/reference/CoordinateReference";
import {Feature, FeatureId} from "@luciad/ria/model/feature/Feature";
import {Cursor} from "@luciad/ria/model/Cursor";
import {GMLFeatureEncoder} from "./libs/GMLFeatureEncoder";
import {areCompatibleGeometries, standardizeProperties} from "./libs/ParseWFSFeatureDescription";
import {WFSTDelegateScreenHelper} from "./libs/screen/WFSTDelegateScreenHelper";
import {AdvancedGMLCodec} from "./libs/gml/gml32/AdvancedGMLCodec";
import {GeoJsonCodec} from "@luciad/ria/model/codec/GeoJsonCodec";

export class WFSTFeatureLockStore extends MemoryStore {
    private delegateStore: WFSTFeatureStore;
    private options: WFSTEditFeatureLockItem;
    private delegateScreen: WFSTDelegateScreenHelper;
    private sharableReference: CoordinateReference;
    // Which local pending-edit serialization format put()/add()/loadLatestState() use for
    // updatedIds/insertedIds - mirrors initializeDelegateStore's own JSON-vs-GML branch exactly,
    // so a JSON-configured lock (every existing caller/test) keeps today's GeoJSON-based format
    // untouched, while a GML-configured lock (e.g. demo-gml's AdvancedGMLCodec-based main layer)
    // gets a format that can actually represent Circle/Arc - GeoJSON cannot represent them at all.
    private useGMLSerialization: boolean;
    private gmlCodec?: AdvancedGMLCodec;
    constructor(options: WFSTEditFeatureLockItem) {
        const reference = getReference(options.srsName);
        super({reference});
        this.sharableReference = reference;
        this.options = options;
        this.delegateStore = this.initializeDelegateStore(options.storeSettings, reference);
        this.loadAll();
        this.delegateScreen = new WFSTDelegateScreenHelper();
    }

    private loadAll() {
        this.loadFeatureDescription().then(()=> {
            // Do nothing for now.
        });
        this.loadLatestState();
    }

    remove(anId: FeatureId): boolean {
        const id = anId as string;
        const unchangedIndex = this.options.unchangedIds.findIndex(e=>e===id);
        const deletedIndex = this.options.deletedIds.findIndex(e=>e===id);
        const updatedIndex = this.options.updatedIds.findIndex(e=>e.id===id);
        const insertedIndex = this.options.insertedIds.findIndex(e=>e.id===id);

        if (unchangedIndex > -1) {
            this.options.unchangedIds.splice(unchangedIndex, 1);
            if (deletedIndex===-1) this.options.deletedIds.push(id);
        } else if(updatedIndex>-1) {
            this.options.updatedIds.splice(updatedIndex, 1);
            if (deletedIndex===-1) this.options.deletedIds.push(id);
        } else if (insertedIndex>-1) {
            this.options.insertedIds.splice(insertedIndex, 1);
        }
        WFSTFeatureLocksStorage.replaceLock(this.options)
        return super.remove(id);
    }

    putProperties(feature: Feature): FeatureId {
        const options = {onlyProperties: true}
        return this.put(feature, options);
    }

    put(feature: Feature, options?: object): FeatureId {
        const id = feature.id as string;
        const geometryType = GMLFeatureEncoder.getGeometryTypeName(feature);
        const template = this.getFeatureTemplate();
        const isCompatibleGeometry = areCompatibleGeometries(geometryType as any, template.geometry.type);
        // Verify the geometry entered
        if (!isCompatibleGeometry) {
            this.delegateScreen.MessageError(`[WFS-T] Error: Incompatible geometry. Expects ${template.geometry.type}`);
            return null;
        }
        const updatedIndex = this.options.updatedIds.findIndex(e=> e.id === feature.id);
        const unchangedIndex = this.options.unchangedIds.findIndex(e=> e===id);
        const insertedIndex = this.options.insertedIds.findIndex(e=>e.id===id);

        const content = this.encodePendingFeature(feature);
        const newFeature= {id, feature: content, onlyProperties: true};

        const onlyProperties = options ? (options as any).onlyProperties : false;
        // Modify the lists
        if (unchangedIndex > -1) {
            this.options.unchangedIds.splice(unchangedIndex,1);
            newFeature.onlyProperties = newFeature.onlyProperties && onlyProperties;
            this.options.updatedIds.push(newFeature);
        } else if (updatedIndex>-1) {
            newFeature.onlyProperties = newFeature.onlyProperties && onlyProperties;
            this.options.updatedIds[updatedIndex]  = newFeature;
        } else if (insertedIndex > -1) {
            this.options.insertedIds[insertedIndex]  = newFeature;
        }
        WFSTFeatureLocksStorage.replaceLock(this.options)
        return super.put(feature);
    }

    add(feature: Feature, options?: object): FeatureId {
        const addFeature = () => {
            const {newFeature, validProperties} = standardizeProperties(this.getFeatureTemplate(), feature);
            const insertedIndex = this.options.insertedIds.findIndex(e=>e.id===feature.id);
            const geometryType = GMLFeatureEncoder.getGeometryTypeName(feature);
            const template = this.getFeatureTemplate();
            const isCompatibleGeometry = areCompatibleGeometries(geometryType as any, template.geometry.type);
            if (!isCompatibleGeometry) {
                this.delegateScreen.MessageError(`[WFS-T] Error: Incompatible geometry. Expects ${template.geometry.type}`);
                return null;
            }
            if (!validProperties) {
                this.delegateScreen.EditNewFeatureProperties(newFeature, this);
                return null;
            }
            const content = this.encodePendingFeature(feature);
            const id = super.add(feature, options);
            const insertedFeature= {id: id as string, feature: content};
            // Inserting
            if (insertedIndex===-1) {
                this.options.insertedIds.push(insertedFeature)
            } else {
                this.options.insertedIds[insertedIndex] = insertedFeature;
            }
            WFSTFeatureLocksStorage.replaceLock(this.options);
            return id;
        }

        if (this.getFeatureTemplate()) {
            return addFeature();
        } else {
            return null;
        }
    }

    private initializeDelegateStore(options: WFSTFeatureStoreConstructorOptions, reference:  CoordinateReference) {
        const wfstOptions: WFSTFeatureStoreConstructorOptions = {...options};
        let codecOptions = {};
        const swapAxes = [reference.identifier, "CRS:84", "EPSG:4326"];
        if (options.swapAxes) {
            codecOptions = {
                ...codecOptions, swapAxes
            }
        }
        if ((options as any).generateIDs) {
            codecOptions = {...codecOptions, generateIDs:true}
        }
        this.useGMLSerialization = wfstOptions.outputFormat.toLowerCase().indexOf("json") === -1;
        if (this.useGMLSerialization) {
            // AdvancedGMLCodec, not RIA's own decode-only GMLCodec: this is what the main WFS-T
            // layer uses for GML output, and Circle/Arc support (encode, which GMLCodec has none
            // of at all, and the decode-side ellipse-drift/ShapeList(1) normalization) depends on
            // it. Using plain GMLCodec here was the root cause of the lock-editing helper showing
            // a different, unsafe shape for a feature the main layer already fixed.
            this.gmlCodec = new AdvancedGMLCodec(codecOptions);
            wfstOptions.codec = this.gmlCodec;
        } else {
            wfstOptions.codec = new GeoJsonCodec(codecOptions);
        }
        wfstOptions.reference = reference;
        return new WFSTFeatureStore(wfstOptions);
    }

    // Local, not-yet-committed pending-edit tracking (updatedIds/insertedIds) needs its own
    // serialization independent of the delegate store's own WFS-T wire format - mirrors whichever
    // branch initializeDelegateStore took, so a JSON-configured lock keeps today's exact format.
    // The GML branch encodes via encode() (a full <gml:FeatureCollection>), not encodeFeature():
    // encodeFeature()'s standalone <gml:Feature> fragment is not decodable by decode() at all
    // (confirmed in AdvancedGMLCodec.test.ts, pre-existing and orthogonal to this fix).
    private encodePendingFeature(feature: Feature): string {
        if (!this.useGMLSerialization) return GMLFeatureEncoder.encodeFeatureToGeoJSON(feature).content;
        return this.gmlCodec.encode(WFSTFeatureLockStore.singleFeatureCursor(feature)).content;
    }

    private decodePendingFeature(content: string): Feature | null {
        if (!this.useGMLSerialization) return GMLFeatureEncoder.decodeFeatureFromGeoJSON(content, this.options.srsName);
        const cursor = this.gmlCodec.decode({content});
        return cursor && cursor.hasNext() ? cursor.next() : null;
    }

    private static singleFeatureCursor(feature: Feature): Cursor<Feature> {
        let done = false;
        return {hasNext: () => !done, next: () => { done = true; return feature; }};
    }

    loadLatestState() {
        this.clear();
        WFSTFeatureLocksStorage.getLock(this.options.id).then(item=>{
            this.delegateStore.queryByRids(item.unchangedIds).then(cursor=>{
                while (cursor.hasNext()) {
                    const feature = cursor.next();
                    super.put(feature);
                }
            });
            for (const f of item.updatedIds) {
                const feature = this.decodePendingFeature(f.feature);
                if (feature) super.put(feature);
            }
            for (const f of item.insertedIds) {
                const feature = this.decodePendingFeature(f.feature);
                if (feature) super.put(feature);
            }
        });
    }

    public getFeatureTemplate() {
        return this.delegateStore.getFeatureTemplate();
    }

    public loadFeatureDescription() {
        return this.delegateStore.loadFeatureDescription();
    }

    public getTypeName() {
        return this.delegateStore.getTypeName();
    }
    public commitLockTransaction(lockItem: WFSTEditFeatureLockItem) {
        return this.delegateStore.commitLockTransaction(lockItem);
    }

    setScreenHelper(screenHelper: WFSTDelegateScreenHelper) {
        this.delegateScreen = screenHelper;
        this.delegateStore.setScreenHelper(screenHelper);
    }

    getReference() {
        return this.sharableReference;
    }
}


