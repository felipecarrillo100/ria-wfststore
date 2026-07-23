/** Thrown by {@link verifyGeometryCompatibilityOrThrowError} when an encoded feature's geometry type doesn't match what the target server schema field declares. */
export class WFSTInvalidGeometry extends Error {
    /** @param message the expected geometry type name, appended after a fixed "Expected geometry: " prefix. */
    constructor(message: string) {
        super(`Expected geometry: ${message}`);
        this.name = "WFSTInvalidGeometry";
    }
}
