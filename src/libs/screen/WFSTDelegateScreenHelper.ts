import {Feature} from "@luciad/ria/model/feature/Feature";
// `import type` keeps this a type-only edge: WFSTFeatureStore and WFSTFeatureLockStore both
// construct a WFSTDelegateScreenHelper, so a value import here would be a real runtime cycle.
import type {WFSTFeatureStore} from "../../WFSTFeatureStore";
import type {WFSTFeatureLockStore} from "../../WFSTFeatureLockStore";


export class WFSTDelegateScreenHelper {
    public EditNewFeatureProperties (_feature: Feature, _store: WFSTFeatureStore | WFSTFeatureLockStore, _newFeature=true) {
        // const editFeaturePropertiesForm = <EditNewFeaturePropertiesJSONSchemaForm feature={feature} store={store} newFeature={true}/>;
        // ScreenPanel.createLeftPanelForm(editFeaturePropertiesForm);
    }

    public createToastList(title: string, points: string[]): any {
        return `${title}\r\n${points.map((e) => e)}`;
    }

    public confirmGeometryUpdate(onOK: ()=>void, _onCancel?:()=>void) {
        onOK();
    }

    public confirmFeatureDelete(onOK: ()=>void, _onCancel?:()=>void) {
        onOK();
    }

    public confirmSelectedFeaturesDelete(onOK: ()=>void, _onCancel?:()=>void) {
        onOK();
    }


    public MessageInfo(s:string) {
        console.log(s);
    }

    public MessageSuccess(s:string) {
        console.log(s);
    }

    public MessageError(s:string) {
        console.error(s);
    }

    public MessageWarning(s:string) {
        console.error(s);
    }

}
