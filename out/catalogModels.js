"use strict";
/**
 * Unified model resolution layer.
 *
 * Every CommandCode model flows through the same
 * two-layer merge chain:
 *
 *   1. resolveFromCatalog() — models.dev catalog
 *      (provider entry → global entry → conservative defaults, per field)
 *   2. applyOverride()      — MODEL_OVERRIDES[modelId] wins per field when present
 *
 * The live CommandCode `/models` endpoint supplies model IDs; models.dev is
 * used only as optional metadata.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VISION_PROXY_LATEST_ALIAS = void 0;
exports.resolveProviderForModelId = resolveProviderForModelId;
exports.resolveModelMeta = resolveModelMeta;
exports.resolveVisionProxyModelId = resolveVisionProxyModelId;
exports.isModelDeprecated = isModelDeprecated;
exports.buildCatalogModelInfo = buildCatalogModelInfo;
exports.getCatalogModelConfig = getCatalogModelConfig;
const localize_1 = require("./localize");
const modelOverrides_1 = require("./modelOverrides");
const modelsDev_1 = require("./modelsDev");
/** Fallback base URLs used when the catalog is not loaded. */
const FALLBACK_BASE_URLS = {
    "commandcode": "https://api.commandcode.ai/provider/v1/",
};
/** Per-provider display metadata (family grouping, name suffix). */
const PROVIDER_LABELS = {
    "commandcode": { family: "CommandCode", detail: "CommandCode", nameSuffix: "" },
};
const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_MAX_TOKENS = 4096;
/**
 * Resolve the provider for a model ID. CommandCode exposes all models from
 * one OpenAI/Anthropic-compatible provider endpoint.
 */
function resolveProviderForModelId(modelId) {
    void modelId;
    return "commandcode";
}
/**
 * Resolve model metadata from the catalog with conservative defaults.
 * Per field: provider-specific entry → global entry → default.
 */
function resolveFromCatalog(providerId, modelId) {
    const providerEntry = (0, modelsDev_1.getCatalogProviderModelEntry)(providerId, modelId);
    const globalEntry = (0, modelsDev_1.lookupModelDevEntry)(modelId);
    const entry = providerEntry ?? globalEntry;
    const thinkingMode = entry ? (0, modelsDev_1.inferThinkingMode)(entry) : "switchable";
    const rawEfforts = entry ? (0, modelsDev_1.inferReasoningEfforts)(entry) : undefined;
    // Normalize: "none"/"disabled" effort values are represented by the "disabled" picker option
    const supportedReasoningEfforts = (rawEfforts ?? []).filter((e) => e !== "none" && e !== "disabled");
    return {
        displayName: entry?.name ?? modelId,
        vision: entry ? (0, modelsDev_1.inferVision)(entry) : false,
        thinkingMode,
        supportedReasoningEfforts,
        defaultReasoningEffort: entry ? (0, modelsDev_1.inferDefaultReasoningEffort)(entry) : "enabled",
        contextLength: entry?.limit?.context ?? DEFAULT_CONTEXT_LENGTH,
        maxOutputTokens: entry?.limit?.output ?? DEFAULT_MAX_TOKENS,
        // Claude uses CommandCode's Anthropic endpoint; all other listed
        // models use the OpenAI-compatible endpoint. This intentionally wins
        // over stale provider metadata from an unrelated catalog.
        apiMode: /^(?:anthropic\/)?claude[-/]/i.test(modelId) ? "anthropic" : "openai",
        supportsTemperature: entry?.temperature ?? true,
        toolCalling: entry?.tool_call ?? true,
        baseUrl: (0, modelsDev_1.getCatalogProviderBaseUrl)(providerId, FALLBACK_BASE_URLS[providerId]),
        thinkingBudget: entry ? (0, modelsDev_1.inferThinkingBudget)(entry) : undefined,
        status: entry?.status,
        cost: entry?.cost ?? { cache_read: 0, input: 0, output: 0 },
    };
}
/**
 * Apply per-model overrides. Override wins per field when present.
 */
function applyOverride(meta, override) {
    if (!override)
        return meta;
    return {
        displayName: override.displayName ?? meta.displayName,
        vision: override.vision ?? meta.vision,
        thinkingMode: override.thinkingMode ?? meta.thinkingMode,
        supportedReasoningEfforts: override.supportedReasoningEfforts ?? meta.supportedReasoningEfforts,
        defaultReasoningEffort: override.defaultReasoningEffort ?? meta.defaultReasoningEffort,
        contextLength: override.contextLength ?? meta.contextLength,
        maxOutputTokens: override.maxOutputTokens ?? meta.maxOutputTokens,
        apiMode: override.apiMode ?? meta.apiMode,
        supportsTemperature: override.supportsTemperature ?? meta.supportsTemperature,
        toolCalling: override.toolCalling ?? meta.toolCalling,
        baseUrl: override.baseUrl ?? meta.baseUrl,
        thinkingBudget: override.thinkingBudget ?? meta.thinkingBudget,
        status: override.status ?? meta.status,
        cost: override.cost ?? meta.cost,
    };
}
/**
 * Resolve the final metadata for a model through the merge chain.
 */
function resolveModelMeta(providerId, modelId) {
    return applyOverride(resolveFromCatalog(providerId, modelId), modelOverrides_1.MODEL_OVERRIDES[modelId]);
}
/**
 * Build the reasoning effort enum (values/labels/descriptions/default) for a model.
 */
function buildReasoningEnum(meta) {
    const hasEfforts = meta.supportedReasoningEfforts.length > 0;
    let enumValues;
    if (hasEfforts) {
        if (meta.thinkingMode === "switchable") {
            enumValues = ["disabled", ...meta.supportedReasoningEfforts];
        }
        else {
            enumValues = [...meta.supportedReasoningEfforts];
        }
    }
    else {
        if (meta.thinkingMode === "switchable") {
            enumValues = ["disabled", "enabled"];
        }
        else if (meta.thinkingMode === "adaptive") {
            enumValues = ["disabled", "adaptive"];
        }
        else {
            enumValues = ["enabled"];
        }
    }
    // Fall back to the last enum value when the requested default is not selectable
    // (e.g. "enabled" for an adaptive model).
    const defaultEffort = enumValues.includes(meta.defaultReasoningEffort)
        ? meta.defaultReasoningEffort
        : enumValues[enumValues.length - 1];
    const getLabel = (e) => {
        switch (e) {
            case 'disabled': return (0, localize_1.l10n)("Disabled");
            case 'adaptive': return (0, localize_1.l10n)("Adaptive");
            case 'enabled': return (0, localize_1.l10n)("Thinking");
            case 'low': return (0, localize_1.l10n)("Low");
            case 'medium': return (0, localize_1.l10n)("Medium");
            case 'high': return (0, localize_1.l10n)("High");
            case 'xhigh': return (0, localize_1.l10n)("Extra High");
            case 'max': return (0, localize_1.l10n)("Maximum");
            default: return e.charAt(0).toUpperCase() + e.slice(1);
        }
    };
    const getDesc = (e) => {
        switch (e) {
            case 'disabled': return (0, localize_1.l10n)("Do not enable thinking");
            case 'adaptive': return (0, localize_1.l10n)("Automatically decide when to think");
            case 'enabled': return (0, localize_1.l10n)("Enable thinking");
            case 'low': return (0, localize_1.l10n)("Reduce thinking, faster response");
            case 'medium': return (0, localize_1.l10n)("Balance thinking and speed");
            case 'high': return (0, localize_1.l10n)("Deeper thinking, slower response");
            case 'xhigh': return (0, localize_1.l10n)("Very deep thinking, slower response");
            case 'max': return (0, localize_1.l10n)("Maximum thinking depth, slowest response");
            default: return e;
        }
    };
    return {
        enumValues,
        enumItemLabels: enumValues.map(getLabel),
        enumDescriptions: enumValues.map(getDesc),
        defaultEffort,
    };
}
/**
 * Special vision proxy model ID that resolves to the newest qwen*-plus model.
 */
exports.VISION_PROXY_LATEST_ALIAS = "qwen-plus-latest";
/**
 * Compare two model versions numerically (e.g. "3.10" > "3.9").
 */
/**
 * Resolve the vision proxy model ID.
 *
 * The special value "qwen-plus-latest" resolves to a current CommandCode
 * vision-capable model. Any explicit model ID is returned unchanged.
 */
async function resolveVisionProxyModelId(configuredId) {
    if (configuredId !== exports.VISION_PROXY_LATEST_ALIAS) {
        return configuredId;
    }
    return "Qwen/Qwen3.7-Plus";
}
/**
 * Check whether a model is marked as deprecated in the catalog.
 * Deprecated models are hidden from the model picker unless the user opts in.
 */
function isModelDeprecated(providerId, modelId) {
    return resolveModelMeta(providerId, modelId).status === "deprecated";
}
/**
 * Build a LanguageModelChatInformation entry (model picker) for a model.
 */
function buildCatalogModelInfo(providerId, modelId) {
    const meta = resolveModelMeta(providerId, modelId);
    const label = PROVIDER_LABELS[providerId];
    // Deprecated models keep a visible marker when shown (opt-in setting)
    const deprecatedPrefix = meta.status === "deprecated" ? (0, localize_1.l10n)("[Depr] ") : "";
    // Zen free models: append " Free" only when the catalog name doesn't already carry it
    const nameSuffix = label.nameSuffix && !/\bfree\b/i.test(meta.displayName) ? label.nameSuffix : "";
    const name = `${deprecatedPrefix}${meta.displayName}${nameSuffix}`;
    const { enumValues, enumItemLabels, enumDescriptions, defaultEffort } = buildReasoningEnum(meta);
    return {
        id: modelId,
        name,
        detail: label.detail,
        tooltip: label.detail,
        family: label.family,
        version: "1.0.0",
        maxInputTokens: meta.contextLength,
        maxOutputTokens: meta.maxOutputTokens,
        isUserSelectable: true,
        capabilities: {
            toolCalling: meta.toolCalling,
            // Always declare imageInput=true so VS Code passes image data through.
            // Non-vision models handle images via the ask_image tool proxy internally.
            imageInput: true,
        },
        configurationSchema: {
            properties: {
                reasoningEffort: {
                    type: "string",
                    title: (0, localize_1.l10n)("Reasoning Effort"),
                    enum: enumValues,
                    enumItemLabels: enumItemLabels,
                    enumDescriptions: enumDescriptions,
                    default: defaultEffort,
                    group: "navigation",
                },
            },
        },
    };
}
/**
 * Build the CommandCodeModelItem request config for a model.
 * The provider (Go vs Zen) is resolved from the model ID.
 */
function getCatalogModelConfig(modelId) {
    const providerId = resolveProviderForModelId(modelId);
    const meta = resolveModelMeta(providerId, modelId);
    const override = modelOverrides_1.MODEL_OVERRIDES[modelId];
    const config = {
        id: modelId,
        owned_by: "commandcode",
        displayName: meta.displayName,
        baseUrl: meta.baseUrl,
        vision: meta.vision,
        supportsTemperature: meta.supportsTemperature,
        context_length: meta.contextLength,
        max_completion_tokens: meta.maxOutputTokens,
        apiMode: meta.apiMode,
        enable_thinking: true,
        include_reasoning_in_request: override?.includeReasoningInRequest ?? true,
        thinkingMode: meta.thinkingMode,
        cost: meta.cost,
    };
    // Only send an explicit effort when it is a real effort value
    // ("enabled"/"adaptive" are handled via the thinking flags instead).
    if (meta.defaultReasoningEffort && meta.defaultReasoningEffort !== "enabled" && meta.defaultReasoningEffort !== "adaptive") {
        config.reasoning_effort = meta.defaultReasoningEffort;
    }
    if (meta.thinkingBudget?.max !== undefined) {
        config.thinking_budget = meta.thinkingBudget.max;
    }
    if (override?.extra) {
        config.extra = { ...override.extra };
    }
    return config;
}
//# sourceMappingURL=catalogModels.js.map