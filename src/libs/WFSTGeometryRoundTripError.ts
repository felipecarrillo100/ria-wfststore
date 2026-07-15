export class WFSTGeometryRoundTripError extends Error {
    constructor(message: string) {
        super(`Geometry round-trip verification failed: ${message}`);
        this.name = "WFSTGeometryRoundTripError";
    }
}
