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

/**
 * A local, in-memory working copy for editing a set of previously-locked features (see
 * {@link WFSTFeatureStore.lockFeatures}/{@link WFSTFeatureStore.getFeatureWithLock}) before
 * committing them back as a single WFS-T transaction.
 *
 * Backed by a {@link MemoryStore} for fast local reads/writes while editing, and a delegate
 * {@link WFSTFeatureStore} (see {@link initializeDelegateStore}) used only to fetch the
 * unchanged features and to actually commit the accumulated edits
 * ({@link commitLockTransaction}). Every local {@link put}/{@link add}/{@link remove} updates
 * this store's own {@link WFSTEditFeatureLockItem} bookkeeping (`updatedIds`/`insertedIds`/
 * `deletedIds`/`unchangedIds`) and persists it via `WFSTFeatureLocksStorage.replaceLock`, so the
 * pending edit set survives across page reloads until it's committed or the lock expires.
 *
 * Pending (not-yet-committed) feature content is serialized independently of the delegate
 * store's own WFS-T wire format - see {@link encodePendingFeature}/{@link decodePendingFeature}.
 */
export class WFSTFeatureLockStore extends MemoryStore {
    /** The delegate store used to fetch unchanged features and commit accumulated edits - see {@link initializeDelegateStore}. */
    private delegateStore: WFSTFeatureStore;
    /** This lock's live bookkeeping (`unchangedIds`/`updatedIds`/`insertedIds`/`deletedIds`) - persisted after every mutation via `WFSTFeatureLocksStorage.replaceLock`. */
    private options: WFSTEditFeatureLockItem;
    /** User-facing notifications for this store's own operations - swappable via {@link setScreenHelper}. */
    private delegateScreen: WFSTDelegateScreenHelper;
    /** The CRS features are edited in, exposed via {@link getReference}. */
    private sharableReference: CoordinateReference;
    // Which local pending-edit serialization format put()/add()/loadLatestState() use for
    // updatedIds/insertedIds - mirrors initializeDelegateStore's own JSON-vs-GML branch exactly,
    // so a JSON-configured lock (every existing caller/test) keeps today's GeoJSON-based format
    // untouched, while a GML-configured lock (e.g. demo-gml's AdvancedGMLCodec-based main layer)
    // gets a format that can actually represent Circle/Arc - GeoJSON cannot represent them at all.
    /**
     * True if pending edits are serialized as GML (via {@link gmlCodec}) instead of GeoJSON -
     * mirrors {@link initializeDelegateStore}'s own JSON-vs-GML branch, so a JSON-configured lock
     * keeps its existing GeoJSON-based pending-edit format untouched, while a GML-configured lock
     * gets a format that can actually represent Circle/Arc (GeoJSON cannot represent them at all).
     */
    private useGMLSerialization: boolean;
    /** The GML codec used for pending-edit serialization when {@link useGMLSerialization} is true. */
    private gmlCodec?: AdvancedGMLCodec;

    /**
     * @param options the lock item to build an editable working copy for - typically the result
     *                of {@link WFSTFeatureStore.lockFeatures}/{@link WFSTFeatureStore.getFeatureWithLock}
     *                (or a previously-persisted one loaded from `WFSTFeatureLocksStorage`).
     */
    constructor(options: WFSTEditFeatureLockItem) {
        const reference = getReference(options.srsName);
        super({reference});
        this.sharableReference = reference;
        this.options = options;
        this.delegateStore = this.initializeDelegateStore(options.storeSettings, reference);
        this.loadAll();
        this.delegateScreen = new WFSTDelegateScreenHelper();
    }

    /** Loads the feature-type schema (fire-and-forget) and the current pending-edit state - called once from the constructor. */
    private loadAll() {
        this.loadFeatureDescription().then(()=> {
            // Do nothing for now.
        });
        this.loadLatestState();
    }

    /**
     * Marks a feature as deleted in this lock's pending-edit bookkeeping (removing it from
     * whichever of `unchangedIds`/`updatedIds`/`insertedIds` it was in) and removes it from the
     * local working copy. The deletion isn't sent to the server until
     * {@link commitLockTransaction} runs.
     *
     * @param anId the id of the feature to remove.
     * @returns whatever the underlying {@link MemoryStore.remove} returns.
     */
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

    /** Like {@link put}, but marks the pending edit as properties-only (`onlyProperties: true`) if it's also otherwise unchanged. */
    putProperties(feature: Feature): FeatureId {
        const options = {onlyProperties: true}
        return this.put(feature, options);
    }

    /**
     * Updates a feature in the local working copy and records it as a pending update/insert in
     * this lock's bookkeeping - the change isn't sent to the server until
     * {@link commitLockTransaction} runs.
     *
     * @param feature the feature's new state.
     * @param options `{onlyProperties: true}` to mark this as a properties-only change (see
     *                {@link putProperties}); combined with (not overriding) any previous
     *                properties-only flag already recorded for the same feature.
     * @returns the feature's id, or null if its geometry type doesn't match the feature type's
     *          schema.
     */
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

    /**
     * Inserts a new feature into the local working copy and records it as a pending insert in
     * this lock's bookkeeping - the insert isn't sent to the server until
     * {@link commitLockTransaction} runs.
     *
     * @param feature the feature to insert.
     * @param options passed through to the underlying {@link MemoryStore.add}.
     * @returns the newly-assigned local id, or null if the feature template isn't loaded yet, the
     *          geometry type doesn't match the feature type's schema, or the properties are
     *          incomplete (in which case {@link WFSTDelegateScreenHelper.EditNewFeatureProperties}
     *          is triggered instead).
     */
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

    /**
     * Builds the delegate {@link WFSTFeatureStore} used to fetch unchanged features and commit
     * this lock's edits, choosing a codec (GML via {@link AdvancedGMLCodec}, or JSON via RIA's
     * `GeoJsonCodec`) based on `options.outputFormat` - see {@link useGMLSerialization}.
     *
     * @param options   the lock item's own store settings (see
     *                  `WFSTFeatureStore.cleanOptions`).
     * @param reference the CRS to construct the delegate store with.
     * @returns the constructed delegate store.
     */
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

    /**
     * Serializes a feature for this lock's own pending-edit bookkeeping (`updatedIds`/
     * `insertedIds`), independent of the delegate store's own WFS-T wire format - mirrors
     * whichever branch {@link initializeDelegateStore} took (see {@link useGMLSerialization}), so
     * a JSON-configured lock keeps its existing GeoJSON-based format untouched.
     *
     * The GML branch encodes via `encode()` (a full `<gml:FeatureCollection>`), not
     * `encodeFeature()`: `encodeFeature()`'s standalone `<gml:Feature>` fragment isn't decodable
     * by `decode()` at all (confirmed in `AdvancedGMLCodec.test.ts`, pre-existing and orthogonal
     * to this).
     *
     * @param feature the feature to serialize.
     * @returns the serialized content string, in whichever format this lock uses.
     */
    private encodePendingFeature(feature: Feature): string {
        if (!this.useGMLSerialization) return GMLFeatureEncoder.encodeFeatureToGeoJSON(feature).content;
        return this.gmlCodec.encode(WFSTFeatureLockStore.singleFeatureCursor(feature)).content;
    }

    /**
     * The inverse of {@link encodePendingFeature} - reconstructs a feature from this lock's own
     * pending-edit bookkeeping.
     *
     * @param content the serialized content, as produced by {@link encodePendingFeature}.
     * @returns the decoded feature, or null if it couldn't be decoded.
     */
    private decodePendingFeature(content: string): Feature | null {
        if (!this.useGMLSerialization) return GMLFeatureEncoder.decodeFeatureFromGeoJSON(content, this.options.srsName);
        const cursor = this.gmlCodec.decode({content});
        return cursor && cursor.hasNext() ? cursor.next() : null;
    }

    /** Wraps a single feature as a one-shot {@link Cursor}, since {@link AdvancedGMLCodec.encode} expects a cursor rather than a single feature - used by {@link encodePendingFeature}. */
    private static singleFeatureCursor(feature: Feature): Cursor<Feature> {
        let done = false;
        return {hasNext: () => !done, next: () => { done = true; return feature; }};
    }

    /**
     * Repopulates the local working copy from this lock's persisted state: fetches the
     * `unchangedIds` fresh from the delegate store, and decodes every pending `updatedIds`/
     * `insertedIds` entry via {@link decodePendingFeature}. Called once from the constructor, but
     * also callable directly to discard any further in-memory changes and reload from the last
     * persisted lock state.
     */
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

    /** @returns the delegate store's cached feature-type schema - see `WFSTFeatureStore.getFeatureTemplate`. */
    public getFeatureTemplate() {
        return this.delegateStore.getFeatureTemplate();
    }

    /** Delegates to `WFSTFeatureStore.loadFeatureDescription` on this lock's delegate store. */
    public loadFeatureDescription() {
        return this.delegateStore.loadFeatureDescription();
    }

    /** @returns the delegate store's WFS feature type name - see `WFSTFeatureStore.getTypeName`. */
    public getTypeName() {
        return this.delegateStore.getTypeName();
    }

    /**
     * Commits a lock's accumulated pending edits as a single WFS-T transaction - delegates to
     * `WFSTFeatureStore.commitLockTransaction`.
     *
     * @param lockItem the lock item to commit (typically `this.options`, but any compatible lock
     *                 item can be passed).
     * @returns a Promise resolving to a {@link CommitLockTransactionResult}.
     */
    public commitLockTransaction(lockItem: WFSTEditFeatureLockItem) {
        return this.delegateStore.commitLockTransaction(lockItem);
    }

    /** Replaces both this store's own and its delegate store's {@link WFSTDelegateScreenHelper}. */
    setScreenHelper(screenHelper: WFSTDelegateScreenHelper) {
        this.delegateScreen = screenHelper;
        this.delegateStore.setScreenHelper(screenHelper);
    }

    /** @returns the {@link CoordinateReference} this lock's features are edited in. */
    getReference() {
        return this.sharableReference;
    }
}

