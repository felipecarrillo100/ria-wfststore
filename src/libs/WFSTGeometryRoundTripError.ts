/** Thrown by {@link assertGeometryRoundTrip} when a just-written Circle/Arc doesn't read back as the same geometry - see `verifyGeometryRoundTrip.ts` for why this check exists. */
export class WFSTGeometryRoundTripError extends Error {
    /** @param message the specific mismatch detail, appended after a fixed "Geometry round-trip verification failed: " prefix. */
    constructor(message: string) {
        super(`Geometry round-trip verification failed: ${message}`);
        this.name = "WFSTGeometryRoundTripError";
    }
}
