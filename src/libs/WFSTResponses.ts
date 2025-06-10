export class WFSTResponses {

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
