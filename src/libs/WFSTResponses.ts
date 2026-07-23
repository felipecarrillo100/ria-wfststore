/**
 * Parses the WFS-T response XML bodies {@link WFSTFeatureStore} handles - transaction summaries
 * (inserted/updated/deleted/replaced counts and the new resource id), lock responses, and
 * exception reports. Counterpart to {@link WFSTQueries}, which builds the request bodies these
 * responses answer.
 */
export class WFSTResponses {

    /**
     * Parses a `Transaction` response's summary counts and (for an Insert) the new feature's
     * resource id.
     *
     * @param xmlContent the response body.
     * @returns each count as a string (or null if absent/unparseable), and the inserted
     *          feature's `rid` (or null for a response with no `fes:ResourceId`, e.g. an Update
     *          or Delete).
     */
    public static parseXMLTransactionResponseResourceId(xmlContent: string): { totalInserted: string | null, totalReplaced: string | null, totalUpdated: string | null, totalDeleted: string | null, resourceId: string | null } {
        // Create a new DOMParser instance
        const parser = new DOMParser();

        // Parse the XML content
        const xmlDoc = parser.parseFromString(xmlContent, "application/xml");

        // Check for parsing errors
        const parserError = xmlDoc.getElementsByTagName("parsererror");
        if (parserError.length > 0) {
            console.error("Error parsing XML:", parserError[0].textContent);
            return { totalInserted: null, totalUpdated: null, totalDeleted: null, resourceId: null, totalReplaced: null };
        }

        // Find the wfs:totalInserted, wfs:totalUpdated, and wfs:totalDeleted elements
        const totalInsertedElement = xmlDoc.getElementsByTagNameNS("http://www.opengis.net/wfs/2.0", "totalInserted")[0];
        const totalUpdatedElement = xmlDoc.getElementsByTagNameNS("http://www.opengis.net/wfs/2.0", "totalUpdated")[0];
        const totalDeletedElement = xmlDoc.getElementsByTagNameNS("http://www.opengis.net/wfs/2.0", "totalDeleted")[0];
        const totalReplacedElement = xmlDoc.getElementsByTagNameNS("http://www.opengis.net/wfs/2.0", "totalReplaced")[0];

        // Find the fes:ResourceId element
        const resourceIdElement = xmlDoc.getElementsByTagNameNS("http://www.opengis.net/fes/2.0", "ResourceId")[0];

        // Extract the text content of the elements
        const totalInserted = totalInsertedElement ? totalInsertedElement.textContent : null;
        const totalUpdated = totalUpdatedElement ? totalUpdatedElement.textContent : null;
        const totalDeleted = totalDeletedElement ? totalDeletedElement.textContent : null;
        const totalReplaced = totalReplacedElement ? totalReplacedElement.textContent : null;

        // Extract the rid attribute of the fes:ResourceId element
        const resourceId = resourceIdElement ? resourceIdElement.getAttribute("rid") : null;

        return { totalInserted, totalUpdated, totalDeleted, totalReplaced, resourceId };
    }

    /**
     * Parses a `Transaction` response that also carries a lock id (a lock-commit response) - like
     * {@link parseXMLTransactionResponseResourceId}, but reads the `ReleaseLockResponse` element's
     * `lockId` instead of a `fes:ResourceId`. Not currently called by {@link WFSTFeatureStore} -
     * {@link parseXMLTransactionResponseResourceId} is used for `commitLockTransaction` instead -
     * kept for a lock-response shape that includes an explicit lock id echo.
     *
     * @param xmlContent the response body.
     * @returns each count as a string (or null if absent), and the lock id (or null if the
     *          response has no `ReleaseLockResponse` element).
     */
    public static parseXMLTransactionWithLockResponse(xmlContent: string): { totalInserted: string | null, totalUpdated: string | null, totalDeleted: string | null, lockId: string | null } {
        // Create a new DOMParser instance
        const parser = new DOMParser();

        // Parse the XML content
        const xmlDoc = parser.parseFromString(xmlContent, "application/xml");

        // Check for parsing errors
        const parserError = xmlDoc.getElementsByTagName("parsererror");
        if (parserError.length > 0) {
            console.error("Error parsing XML:", parserError[0].textContent);
            return { totalInserted: null, totalUpdated: null, totalDeleted: null, lockId: null };
        }

        // Find the wfs:totalInserted, wfs:totalUpdated, and wfs:totalDeleted elements
        const totalInsertedElement = xmlDoc.getElementsByTagNameNS("http://www.opengis.net/wfs/2.0", "totalInserted")[0];
        const totalUpdatedElement = xmlDoc.getElementsByTagNameNS("http://www.opengis.net/wfs/2.0", "totalUpdated")[0];
        const totalDeletedElement = xmlDoc.getElementsByTagNameNS("http://www.opengis.net/wfs/2.0", "totalDeleted")[0];

        // Find the ReleaseLockResponse element and its lockId attribute
        const releaseLockResponseElement = xmlDoc.getElementsByTagNameNS("http://www.opengis.net/wfs/2.0", "ReleaseLockResponse")[0];
        const lockId = releaseLockResponseElement ? releaseLockResponseElement.getAttribute("lockId") : null;

        // Extract the text content of the elements
        const totalInserted = totalInsertedElement ? totalInsertedElement.textContent : null;
        const totalUpdated = totalUpdatedElement ? totalUpdatedElement.textContent : null;
        const totalDeleted = totalDeletedElement ? totalDeletedElement.textContent : null;

        return { totalInserted, totalUpdated, totalDeleted, lockId };
    }


    /**
     * Parses a WFS `ExceptionReport` (an OWS error response) into its code and message - used by
     * {@link WFSTFeatureStore.error400} to surface a specific error to the screen helper.
     *
     * @param xmlContent the exception report body.
     * @returns the exception code and text (both null if the report couldn't be parsed or has no
     *          `ows:Exception` element).
     */
    public static parseExceptionReport(xmlContent: string): { exceptionCode: string | null, exceptionText: string | null } {
        // Create a new DOMParser instance
        const parser = new DOMParser();

        // Parse the XML content
        const xmlDoc = parser.parseFromString(xmlContent, "application/xml");

        // Check for parsing errors
        const parserError = xmlDoc.getElementsByTagName("parsererror");
        if (parserError.length > 0) {
            console.error("Error parsing XML:", parserError[0].textContent);
            return { exceptionCode: null, exceptionText: null };
        }

        // Find the ows:Exception element
        const exceptionElement = xmlDoc.getElementsByTagNameNS("http://www.opengis.net/ows/1.1", "Exception")[0];

        // Find the ows:ExceptionText element
        const exceptionTextElement = xmlDoc.getElementsByTagNameNS("http://www.opengis.net/ows/1.1", "ExceptionText")[0];

        // Extract the exceptionCode attribute
        const exceptionCode = exceptionElement ? exceptionElement.getAttribute("exceptionCode") : null;

        // Extract the text content of the ows:ExceptionText element
        const exceptionText = exceptionTextElement ? exceptionTextElement.textContent : null;

        return { exceptionCode, exceptionText };
    }

    /**
     * Parses a `GetFeatureWithLock` response's lock/query metadata (the features themselves are
     * decoded separately, via this store's own GML/JSON codec) - see
     * {@link WFSTFeatureStore.getFeatureWithLock}.
     *
     * @param xmlString the response body.
     * @returns the lock id and query metadata (all undefined if the response has no
     *          `wfs:FeatureCollection` root).
     */
    static parseXMLGetFeaturesWithLock(xmlString: string) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, "application/xml");
        const getAttributeValue = (element: any, attributeName:string) => {
            return element ? element.getAttribute(attributeName) : undefined;
        };
        const featureCollection = xmlDoc.getElementsByTagName("wfs:FeatureCollection")[0];
        const lockId = getAttributeValue(featureCollection, "lockId");
        const numberMatched = getAttributeValue(featureCollection, "numberMatched");
        const numberReturned = getAttributeValue(featureCollection, "numberReturned");
        const timeStamp = getAttributeValue(featureCollection, "timeStamp");
        return {
            lockId,
            numberMatched,
            numberReturned,
            timeStamp,
        };
    }

    /**
     * Parses a `LockFeature` response's lock id - see {@link WFSTFeatureStore.lockFeatures}.
     *
     * @param xmlString the response body.
     * @returns the lock id (undefined if the response has no `wfs:LockFeatureResponse` root).
     */
    static parseXMLLockFeatures(xmlString: string) {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlString, "application/xml");
        const getAttributeValue = (element: any, attributeName:string) => {
            return element ? element.getAttribute(attributeName) : undefined;
        };
        const lockFeatureResponse = xmlDoc.getElementsByTagName("wfs:LockFeatureResponse")[0];
        const lockId = getAttributeValue(lockFeatureResponse, "lockId");
        return {
            lockId,
        };
    }
}
