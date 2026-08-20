"use strict";
/**
 * API model list fetcher.
 *
 * Fetches the list of available model IDs from the CommandCode API
 * (/provider/v1/models) and caches it with a 1-minute TTL.
 * Falls back to stale cache or an empty list on failure (silent degradation).
 *
 * The API base URL is resolved from the models.dev catalog's "commandcode" provider.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.getApiModelIds = getApiModelIds;
exports.clearApiModelCache = clearApiModelCache;
const logger_1 = require("./logger");
const FALLBACK_BASE_URL = "https://api.commandcode.ai/provider/v1/";
const CACHE_TTL_MS = 60 * 1000; // 1 minute — short TTL dedupes concurrent startup activations
// ── Module-level cache ──
let cachedModelIds = null;
let cacheTimestamp = 0;
/**
 * Resolve the API base URL from the catalog, with fallback.
 */
async function resolveBaseUrl() {
    return FALLBACK_BASE_URL;
}
/**
 * Fetch the model ID list from the API's /models endpoint.
 * The endpoint follows OpenAI /v1/models format:
 *   { object: "list", data: [{ id: string, object: string, created: number, owned_by: string }, ...] }
 */
async function fetchApiModelList(apiKey, signal) {
    const apiBaseUrl = await resolveBaseUrl();
    const url = `${apiBaseUrl.replace(/\/+$/, "")}/models`;
    try {
        const timeoutSignal = AbortSignal.timeout(10000);
        const response = await fetch(url, {
            headers: { Authorization: `Bearer ${apiKey}` },
            signal: signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal,
        });
        if (!response.ok) {
            throw new Error(`API model list error: [${response.status}] ${response.statusText}`);
        }
        const body = (await response.json());
        return (body.data ?? []).map((m) => m.id);
    }
    catch (err) {
        if (signal?.aborted) {
            throw err;
        }
        if (err instanceof DOMException && err.name === "AbortError") {
            logger_1.logger.warn("apiModelList.fetch.timeout", { url });
            // Throw a regular error so caller's catch block preserves stale cache
            throw new Error(`Request timed out after 10000ms`);
        }
        throw err;
    }
}
/**
 * Get the list of model IDs available via the CommandCode API.
 *
 * @param apiKey - The API key for authentication.
 * @returns Model IDs plus the source/result status used by the UI refresh flow.
 */
async function getApiModelIds(apiKey, signal) {
    const now = Date.now();
    // Use cached result if still fresh
    if (cachedModelIds !== null && now - cacheTimestamp < CACHE_TTL_MS) {
        return { ids: new Set(cachedModelIds), status: "cached" };
    }
    if (!apiKey) {
        // No API key — use stale cache or return empty
        if (cachedModelIds !== null) {
            return { ids: new Set(cachedModelIds), status: "stale" };
        }
        return { ids: new Set(), status: "missing-key" };
    }
    try {
        // TODO: Consider filtering model IDs against the models.dev catalog.
        // As of 2026-07-30, hy3-preview is wrongly listed as a valid Go model
        // (calls fail, and it is absent from the catalog), so the catalog
        // could serve as a source of truth for valid model IDs.
        const ids = await fetchApiModelList(apiKey, signal);
        cachedModelIds = ids;
        cacheTimestamp = now;
        return { ids: new Set(ids), status: "success" };
    }
    catch (error) {
        // API call failed — use stale cache if available
        const message = error instanceof Error ? error.message : String(error);
        if (cachedModelIds !== null) {
            return { ids: new Set(cachedModelIds), status: "stale", error: message };
        }
        return { ids: new Set(), status: "error", error: message };
    }
}
/**
 * Clear the cached API model list (for testing / manual refresh).
 */
function clearApiModelCache() {
    cachedModelIds = null;
    cacheTimestamp = 0;
}
//# sourceMappingURL=apiModelList.js.map