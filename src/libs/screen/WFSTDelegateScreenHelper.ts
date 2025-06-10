import {Feature} from "@luciad/ria/model/feature/Feature";
import {WFSTFeatureStore} from "../../WFSTFeatureStore";
import {WFSTFeatureLockStore} from "../../WFSTFeatureLockStore";


export class WFSTDelegateScreenHelper {
    public EditNewFeatureProperties (feature: Feature, store: WFSTFeatureStore | WFSTFeatureLockStore) {
        // const editFeaturePropertiesForm = <EditNewFeaturePropertiesJSONSchemaForm feature={feature} store={store} newFeature={true}/>;
        // ScreenPanel.createLeftPanelForm(editFeaturePropertiesForm);
    }

    public createToastList(title: string, points: string[]): any {
        return `${title}\r\n${points.map((e) => e)}`;
    }

    public confirmGeometryUpdate(onOK: ()=>void, onCancel?:()=>void) {
        onOK();
    }

    public confirmFeatureDelete(onOK: ()=>void, onCancel?:()=>void) {
        onOK();
    }

    public confirmSelectedFeaturesDelete(onOK: ()=>void, onCancel?:()=>void) {
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
