"use strict";
/**
 * models.dev catalog fetcher and query engine.
 *
 * Downloads the models.dev catalog (https://models.dev/catalog.json) and provides
 * fast lookup of model metadata by ID, provider info, and provider-specific model
 * metadata. The catalog has two top-level sections:
 *
 *   - `models`:      Global model catalog keyed by fully qualified ID (e.g. "zhipuai/glm-5")
 *   - `providers`:   Provider entries keyed by provider ID, each containing:
 *       - `api`:     API base URL
 *       - `models`:  Provider-specific model metadata keyed by short ID (e.g. "glm-5")
 *
 * Used to auto-discover new models, resolve API base URLs per provider, and
 * populate model metadata (context length, max output tokens, vision, reasoning,
 * thinking modes, etc.) instead of hardcoding.
 *
 * Cached in memory for 1 minute. The short TTL keeps every extension
 * activation (and model-picker refresh) fetching a fresh catalog, while
 * still deduping the burst of concurrent activation calls VS Code fires
 * on startup. On failure the fetch falls back to a configurable mirror URL
 * (commandcode.modelsDevMirrorUrl), then to a hardcoded catalog snapshot.
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCatalogProvider = getCatalogProvider;
exports.getCatalogProviderBaseUrl = getCatalogProviderBaseUrl;
exports.getCatalogProviderModelEntry = getCatalogProviderModelEntry;
exports.getCatalogProviderModelIds = getCatalogProviderModelIds;
exports.inferThinkingMode = inferThinkingMode;
exports.inferReasoningEfforts = inferReasoningEfforts;
exports.inferDefaultReasoningEffort = inferDefaultReasoningEffort;
exports.inferVision = inferVision;
exports.inferThinkingBudget = inferThinkingBudget;
exports.ensureModelsDevLoaded = ensureModelsDevLoaded;
exports.lookupModelDevEntry = lookupModelDevEntry;
exports.hasModelDevEntry = hasModelDevEntry;
exports.deduceApiModeFromFamily = deduceApiModeFromFamily;
exports.clearModelsDevCache = clearModelsDevCache;
const vscode = __importStar(require("vscode"));
const hardcodedModelList_1 = require("./hardcodedModelList");
const logger_1 = require("./logger");
const CATALOG_URL = "https://models.dev/catalog.json";
const CACHE_TTL_MS = 60 * 1000; // 1 minute — dedupes concurrent startup activations
const OFFICIAL_TIMEOUT_MS = 10 * 1000;
const MIRROR_TIMEOUT_MS = 30 * 1000;
/** Value sent in the `platform` header to mirrors that require it. */
const MIRROR_PLATFORM_HEADER = "commandcode-copilot";
// ── Module-level cache ──
/** Map from global catalog fully qualified ID to entry. */
let metadataMap = null;
/** Map from short ID (last segment after slash) to global entry. */
let shortIdMap = null;
/** Provider catalog keyed by provider ID. */
let providersMap = null;
let cacheTimestamp = 0;
/** Whether the last fetch attempt succeeded. Used to retry sooner after failure. */
let lastLoadFailed = false;
// ── Internal helpers ──
/**
 * Mirror configuration from the `commandcode` settings.
 * Accepts the full catalog URL or a base URL ending with "/".
 */
function getMirrorConfig() {
    const cfg = vscode.workspace.getConfiguration("commandcode");
    const rawUrl = cfg.get("modelsDevMirrorUrl", "")?.trim();
    if (!rawUrl)
        return {};
    return {
        url: rawUrl.endsWith("/") ? `${rawUrl}catalog.json` : rawUrl,
        token: cfg.get("modelsDevMirrorToken", "")?.trim() || undefined,
    };
}
/**
 * Fetch JSON with a timeout, converting abort into a plain error.
 * Returns the parsed catalog plus the raw payload size in bytes.
 */
async function fetchJson(url, timeoutMs, headers) {
    try {
        const response = await fetch(url, {
            signal: AbortSignal.timeout(timeoutMs),
            headers,
        });
        if (!response.ok) {
            throw new Error(`catalog error: [${response.status}] ${response.statusText}`);
        }
        const text = await response.text();
        return { data: JSON.parse(text), bytes: text.length };
    }
    catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") {
            logger_1.logger.warn("modelsDev.fetch.timeout", { url, timeoutMs });
            throw new Error(`Request timed out after ${timeoutMs}ms`);
        }
        throw err;
    }
}
/**
 * Fetch the catalog JSON. Fallback chain: official models.dev URL → configured
 * mirror (with platform/token headers) → hardcoded catalog snapshot.
 */
async function fetchCatalog() {
    const officialStart = Date.now();
    try {
        const { data, bytes } = await fetchJson(CATALOG_URL, OFFICIAL_TIMEOUT_MS);
        logger_1.logger.info("modelsDev.fetch.official", {
            url: CATALOG_URL,
            durationMs: Date.now() - officialStart,
            bytes,
        });
        return { data, source: "official" };
    }
    catch (err) {
        logger_1.logger.warn("modelsDev.fetch.officialFailed", {
            url: CATALOG_URL,
            durationMs: Date.now() - officialStart,
            error: err instanceof Error ? err.message : String(err),
        });
    }
    const mirror = getMirrorConfig();
    if (mirror.url) {
        const mirrorStart = Date.now();
        try {
            const headers = { platform: MIRROR_PLATFORM_HEADER };
            if (mirror.token) {
                headers["x-mirror-token"] = mirror.token;
            }
            const { data, bytes } = await fetchJson(mirror.url, MIRROR_TIMEOUT_MS, headers);
            logger_1.logger.info("modelsDev.fetch.mirror", {
                url: mirror.url,
                durationMs: Date.now() - mirrorStart,
                bytes,
            });
            return { data, source: "mirror" };
        }
        catch (err) {
            logger_1.logger.warn("modelsDev.fetch.mirrorFailed", {
                url: mirror.url,
                durationMs: Date.now() - mirrorStart,
                error: err instanceof Error ? err.message : String(err),
            });
        }
    }
    logger_1.logger.warn("modelsDev.fetch.hardcoded", {
        providers: Object.keys(hardcodedModelList_1.HARDCODED_CATALOG.providers),
    });
    return { data: hardcodedModelList_1.HARDCODED_CATALOG, source: "hardcoded" };
}
function rebuildIndex(data) {
    // Index global model catalog
    metadataMap = new Map();
    shortIdMap = new Map();
    for (const [fullId, entry] of Object.entries(data.models)) {
        metadataMap.set(fullId, entry);
        const slashIdx = fullId.lastIndexOf("/");
        if (slashIdx >= 0) {
            const shortId = fullId.slice(slashIdx + 1);
            if (!shortIdMap.has(shortId)) {
                shortIdMap.set(shortId, entry);
            }
            else {
                logger_1.logger.warn("modelsDev.index.collision", {
                    shortId,
                    existing: shortIdMap.get(shortId).id,
                    ignored: entry.id,
                });
            }
        }
    }
    // Index provider catalog
    providersMap = new Map();
    for (const [providerId, provider] of Object.entries(data.providers)) {
        providersMap.set(providerId, provider);
    }
}
// ── Provider-specific lookup ──
/**
 * Get a provider entry from the catalog by provider ID.
 * @param providerId - Provider ID (e.g. "commandcode")
 */
function getCatalogProvider(providerId) {
    return providersMap?.get(providerId);
}
/**
 * Get the API base URL for a provider from the catalog.
 * @param providerId - Provider ID (e.g. "commandcode")
 * @param fallbackUrl - Fallback URL if catalog is not loaded or provider not found
 */
function getCatalogProviderBaseUrl(providerId, fallbackUrl) {
    const provider = providersMap?.get(providerId);
    if (provider?.api) {
        return provider.api.replace(/\/+$/, "") + "/";
    }
    return fallbackUrl;
}
/**
 * Get provider-specific model metadata from the catalog.
 * Looks up the model in the specified provider's models section.
 *
 * Matching is tolerant of the ID formats seen in the wild:
 * - exact key match ("deepseek-v4-flash", "MiniMax-M3")
 * - case-insensitive key match ("Kimi-K3" vs "kimi-k3")
 * - case-insensitive short-ID match for fully qualified IDs
 *   ("moonshotai/Kimi-K2.7-Code" → "kimi-k2.7-code")
 * - "-free" suffix stripped ("poolside/laguna-s-2.1-free" → "laguna-s-2.1")
 *
 * @param providerId - Provider ID (e.g. "commandcode")
 * @param modelId - Model ID (e.g. "deepseek-v4-flash", "moonshotai/Kimi-K3")
 * @returns The provider-specific model entry, or undefined if not found.
 */
function getCatalogProviderModelEntry(providerId, modelId) {
    const models = providersMap?.get(providerId)?.models;
    if (!models)
        return undefined;
    if (models[modelId])
        return models[modelId];
    const lookupIds = modelId.endsWith("-free") ? [modelId, modelId.slice(0, -"-free".length)] : [modelId];
    const lowerKeys = new Set(lookupIds.map((id) => id.toLowerCase()));
    const lowerShorts = new Set(lookupIds.map((id) => id.split("/").pop()?.toLowerCase()).filter((s) => s !== undefined));
    for (const [key, entry] of Object.entries(models)) {
        const lowerKey = key.toLowerCase();
        if (lowerKeys.has(lowerKey))
            return entry;
        const keyShort = key.split("/").pop()?.toLowerCase();
        if (keyShort !== undefined && lowerShorts.has(keyShort))
            return entry;
    }
    return undefined;
}
/**
 * Get all model IDs served by a provider from the catalog.
 * Returns an empty array if the catalog is not loaded or the provider is unknown.
 *
 * @param providerId - Provider ID (e.g. "commandcode")
 */
function getCatalogProviderModelIds(providerId) {
    const models = providersMap?.get(providerId)?.models;
    return models ? Object.keys(models) : [];
}
// ── Inference helpers ──
/**
 * Infer the thinking mode from a catalog model entry.
 *
 * - `reasoning: false` or missing → `"always"` (no thinking at all)
 * - `reasoning: true` with missing, empty, or populated `reasoning_options`
 *   → `"switchable"` (user can toggle thinking on/off; effort levels are only
 *   offered when an `effort` option declares them)
 *
 * Previously a reasoning model without `reasoning_options` was treated as
 * `"always"` (thinking locked on, no way to disable). models.dev's global
 * model entries carry no `reasoning_options` at all — they live only in
 * provider-specific sections — so any model resolved from the global section
 * ended up un-disableable. `"switchable"` keeps thinking on by default while
 * restoring the user's ability to turn it off.
 */
function inferThinkingMode(entry) {
    if (!entry.reasoning)
        return "always";
    return "switchable";
}
/**
 * Extract supported reasoning effort values from a catalog model entry.
 * Returns undefined if no explicit effort values are defined (simple on/off).
 */
function inferReasoningEfforts(entry) {
    const opts = entry.reasoning_options;
    if (!opts)
        return undefined;
    for (const opt of opts) {
        if (opt.type === "effort" && opt.values && opt.values.length > 0) {
            return opt.values;
        }
    }
    return undefined;
}
/**
 * Infer the default reasoning effort from a catalog model entry.
 * Returns the last (highest) effort value, or "enabled" if no effort values.
 */
function inferDefaultReasoningEffort(entry) {
    const efforts = inferReasoningEfforts(entry);
    if (efforts && efforts.length > 0)
        return efforts[efforts.length - 1];
    return "enabled";
}
/**
 * Check if a model has vision capability from its catalog entry.
 */
function inferVision(entry) {
    if (entry.attachment === true)
        return true;
    const input = entry.modalities?.input;
    if (input && (input.includes("image") || input.includes("video")))
        return true;
    return false;
}
/**
 * Extract the thinking budget range from a catalog model entry.
 * Returns undefined if no `budget_tokens` reasoning option is defined.
 */
function inferThinkingBudget(entry) {
    const opts = entry.reasoning_options;
    if (!opts)
        return undefined;
    for (const opt of opts) {
        if (opt.type === "budget_tokens") {
            const result = {};
            if (typeof opt.min === "number")
                result.min = opt.min;
            if (typeof opt.max === "number")
                result.max = opt.max;
            return result;
        }
    }
    return undefined;
}
// ── Public API ──
/**
 * Log a one-line summary of a catalog load attempt: which source won, how
 * long the whole fallback chain took, and how much data is indexed. When no
 * fresh data was loaded (hardcoded fallback keeping existing cache, or total
 * failure), counts are read from the in-memory index instead.
 * Fallback sources (mirror/hardcoded) and total failure are logged as
 * warnings so they stand out in the output channel.
 */
function logLoadSummary(source, start, data) {
    const countProviderModels = (providerId) => {
        if (data?.providers?.[providerId]?.models) {
            return Object.keys(data.providers[providerId].models).length;
        }
        const entry = providersMap?.get(providerId);
        return entry?.models ? Object.keys(entry.models).length : 0;
    };
    const payload = {
        source,
        durationMs: Date.now() - start,
        providers: data ? Object.keys(data.providers ?? {}).length : (providersMap?.size ?? 0),
        goModels: countProviderModels("commandcode"),
        commandCodeModels: countProviderModels("commandcode"),
    };
    if (source === "official") {
        logger_1.logger.info("modelsDev.load", payload);
    }
    else {
        logger_1.logger.warn("modelsDev.load", payload);
    }
}
/**
 * Ensure the models.dev catalog is loaded and cached.
 * Silently degrades on failure — existing cache is preserved.
 */
async function ensureModelsDevLoaded() {
    const now = Date.now();
    // Fresh cache within TTL — skip fetch (dedupes the startup activation burst)
    if (!lastLoadFailed && metadataMap !== null && now - cacheTimestamp < CACHE_TTL_MS) {
        return;
    }
    // Failed load — respect minimum retry interval (1 minute)
    if (lastLoadFailed && metadataMap !== null && now - cacheTimestamp < 60000) {
        return;
    }
    const start = Date.now();
    try {
        const { data, source } = await fetchCatalog();
        if (source === "hardcoded" && metadataMap !== null) {
            // Keep the previously fetched catalog — it is fresher than the
            // hardcoded list. Only the retry timing is updated.
            cacheTimestamp = now;
            lastLoadFailed = true;
            logLoadSummary("hardcoded", start, null);
            return;
        }
        rebuildIndex(data);
        cacheTimestamp = now;
        lastLoadFailed = source !== "official";
        logLoadSummary(source, start, data);
    }
    catch {
        // Both sources failed and the hardcoded list is unavailable; keep any
        // existing data and retry later. Should not normally happen.
        if (metadataMap === null) {
            metadataMap = new Map();
            shortIdMap = new Map();
            providersMap = new Map();
        }
        cacheTimestamp = now;
        lastLoadFailed = true;
        logLoadSummary("failed", start, null);
    }
}
/**
 * Look up a model's metadata by its API model ID from the global catalog.
 *
 * Matching strategy (in order):
 * 1. Exact match on the full models.dev ID
 * 2. Short ID match (last segment after '/')
 * 3. Suffix match
 *
 * @param apiModelId - The model ID as returned by the API (e.g. "deepseek-v4-flash")
 * @returns The global catalog entry, or undefined if not found.
 */
function lookupModelDevEntry(apiModelId) {
    if (!metadataMap)
        return undefined;
    if (metadataMap.has(apiModelId))
        return metadataMap.get(apiModelId);
    if (shortIdMap?.has(apiModelId))
        return shortIdMap.get(apiModelId);
    for (const [fullId, entry] of metadataMap) {
        if (fullId.endsWith(`/${apiModelId}`) || fullId === apiModelId)
            return entry;
    }
    return undefined;
}
/**
 * Check whether a given API model ID exists in the global catalog.
 */
function hasModelDevEntry(apiModelId) {
    return lookupModelDevEntry(apiModelId) !== undefined;
}
/**
 * Deduce API mode (openai vs anthropic) from a model ID and optional catalog entry.
 * Uses family-based heuristics since the catalog does not directly expose apiMode.
 *
 * Also checks the `provider.npm` field: @ai-sdk/anthropic → anthropic.
 */
function deduceApiModeFromFamily(modelId, entry) {
    // Check provider npm hint first
    if (entry?.provider?.npm?.includes("anthropic"))
        return "anthropic";
    const family = entry?.family?.toLowerCase() ?? "";
    if (family.includes("claude") || family.includes("anthropic"))
        return "anthropic";
    if (family.includes("qwen")) {
        if (/qwen[\s-]*3\.[67]/i.test(modelId))
            return "anthropic";
        return "openai";
    }
    if (family.includes("gemma"))
        return "anthropic";
    return "openai";
}
/**
 * Clear the cached metadata (for testing / manual refresh).
 */
function clearModelsDevCache() {
    metadataMap = null;
    shortIdMap = null;
    providersMap = null;
    cacheTimestamp = 0;
    lastLoadFailed = false;
}
//# sourceMappingURL=modelsDev.js.map