import {Feature} from "@luciad/ria/model/feature/Feature";
// `import type` keeps this a type-only edge: WFSTFeatureStore and WFSTFeatureLockStore both
// construct a WFSTDelegateScreenHelper, so a value import here would be a real runtime cycle.
import type {WFSTFeatureStore} from "../../WFSTFeatureStore";
import type {WFSTFeatureLockStore} from "../../WFSTFeatureLockStore";


/**
 * The UI integration point for {@link WFSTFeatureStore}/{@link WFSTFeatureLockStore}: every
 * user-facing notification or confirmation those classes need (transaction success/error toasts,
 * "are you sure?" prompts, prompting for missing properties on a new feature) goes through an
 * instance of this class rather than being hardcoded.
 *
 * The default implementation here is intentionally minimal - confirmations auto-accept, messages
 * just go to the console, and `EditNewFeatureProperties` is a no-op - so the library works
 * out of the box with zero UI dependency. Real applications should subclass this (or otherwise
 * implement the same shape) and pass an instance via
 * `new WFSTFeatureStore({..., })` + {@link WFSTFeatureStore.setScreenHelper}, or the equivalent on
 * {@link WFSTFeatureLockStore}, to route these into actual dialogs/toasts.
 */
export class WFSTDelegateScreenHelper {
    /**
     * Called when {@link WFSTFeatureStore.add}/{@link WFSTFeatureLockStore.add} can't proceed
     * because the new feature is missing required properties - override this to show a form
     * letting the user fill them in and re-submit.
     *
     * @param _feature   the feature awaiting complete properties.
     * @param _store     the store the feature would be added to.
     * @param _newFeature true if this is a brand-new feature (always true from every current
     *                    call site).
     */
    public EditNewFeatureProperties (_feature: Feature, _store: WFSTFeatureStore | WFSTFeatureLockStore, _newFeature=true) {
        // const editFeaturePropertiesForm = <EditNewFeaturePropertiesJSONSchemaForm feature={feature} store={store} newFeature={true}/>;
        // ScreenPanel.createLeftPanelForm(editFeaturePropertiesForm);
    }

    /**
     * Builds a single message summarizing several bullet points, e.g. for
     * {@link WFSTFeatureStore.commitLockTransaction}'s combined insert/update/delete counts.
     *
     * @param title  a heading for the message.
     * @param points the individual bullet points.
     * @returns the combined message - override to return a richer object (e.g. JSX) if
     *          {@link MessageInfo} is also overridden to render one.
     */
    public createToastList(title: string, points: string[]): any {
        return `${title}\r\n${points.map((e) => e)}`;
    }

    /**
     * Called before {@link WFSTFeatureStore.put} sends a geometry/property update - override to
     * show a confirmation dialog instead of the default auto-accept.
     *
     * @param onOK     call this to proceed with the update.
     * @param _onCancel call this to abort it (unused by the default implementation).
     */
    public confirmGeometryUpdate(onOK: ()=>void, _onCancel?:()=>void) {
        onOK();
    }

    /** Like {@link confirmGeometryUpdate}, for confirming a single feature's deletion. Not currently called by {@link WFSTFeatureStore}/{@link WFSTFeatureLockStore} directly - available for host applications' own delete flows. */
    public confirmFeatureDelete(onOK: ()=>void, _onCancel?:()=>void) {
        onOK();
    }

    /** Like {@link confirmGeometryUpdate}, for confirming a multi-feature deletion. Not currently called by {@link WFSTFeatureStore}/{@link WFSTFeatureLockStore} directly - available for host applications' own delete flows. */
    public confirmSelectedFeaturesDelete(onOK: ()=>void, _onCancel?:()=>void) {
        onOK();
    }


    /** Reports an informational message - default implementation logs it. */
    public MessageInfo(s:string) {
        console.log(s);
    }

    /** Reports a success message - default implementation logs it. */
    public MessageSuccess(s:string) {
        console.log(s);
    }

    /** Reports an error message - default implementation logs it as an error. */
    public MessageError(s:string) {
        console.error(s);
    }

    /** Reports a warning message - default implementation logs it as an error (not a distinct warning level). */
    public MessageWarning(s:string) {
        console.error(s);
    }

}
