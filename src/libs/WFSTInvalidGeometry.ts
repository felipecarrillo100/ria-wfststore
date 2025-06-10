export class WFSTInvalidGeometry extends Error {
    constructor(message: string) {
        super(`Expected geometry: ${message}`);
        this.name = "WFSTInvalidGeometry";
    }
}
