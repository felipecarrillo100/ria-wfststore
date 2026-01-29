import { WFSTDelegateScreenHelper } from "./screen/WFSTDelegateScreenHelper";
import { WFSTProtocol } from "./WFSTProtocol";

/**
 * Utility class to handle WFS-T errors and provide user-facing feedback.
 */
export class WFSTErrorHandler {
    private delegateScreen: WFSTDelegateScreenHelper;

    constructor(delegateScreen: WFSTDelegateScreenHelper) {
        this.delegateScreen = delegateScreen;
    }

    /**
     * Handles common HTTP errors and WFS exceptions.
     * @param error The error object (Response or Error)
     * @param resolve Optional resolve function to call after handling (with null)
     */
    public async handleError(error: any, resolve?: (value: any) => void) {
        if (error instanceof Response) {
            await this.handleResponseError(error);
        } else {
            this.handleUnknownError(error);
        }

        if (resolve) {
            resolve(null);
        }
    }

    private async handleResponseError(response: Response) {
        switch (response.status) {
            case 400:
                const xmlText = await response.text();
                const { exceptionCode, exceptionText } = WFSTProtocol.parseExceptionReport(xmlText);
                this.delegateScreen.MessageError(`${exceptionCode || "Error 400"}:\r\n${exceptionText || "Bad Request"}`);
                break;
            case 401:
                this.delegateScreen.MessageError("WFS-T:\r\nUnauthorized");
                break;
            case 500:
                this.delegateScreen.MessageError("WFS-T:\r\nInternal Server Error");
                break;
            default:
                this.delegateScreen.MessageError(`WFS-T:\r\nError Code ${response.status}`);
                break;
        }
    }

    private handleUnknownError(error: any) {
        console.error("WFS-T Unknown Error:", error);
        this.delegateScreen.MessageError("WFS-T: Unknown Error");
    }
}
