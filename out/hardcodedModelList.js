"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HARDCODED_CATALOG = void 0;
/**
 * Metadata-only fallback. CommandCode owns the authoritative model list and
 * exposes it through /provider/v1/models, so this snapshot intentionally does
 * not duplicate a stale provider catalog.
 */
exports.HARDCODED_CATALOG = {
    models: {},
    providers: {},
};
//# sourceMappingURL=hardcodedModelList.js.map