/**
 * Unified model resolution layer.
 *
 * Every CommandCode model flows through the same
 * two-layer merge chain:
 *
 *   1. resolveFromCatalog() — models.dev catalog
 *      (provider entry → vendor provider entry → global entry → conservative defaults, per field)
 *   2. applyOverride()      — MODEL_OVERRIDES[modelId] wins per field when present
 *
 * The live CommandCode `/models` endpoint supplies model IDs; models.dev is
 * used only as optional metadata. models.dev has no "commandcode" provider
 * entry (CommandCode is a private gateway), so reasoning metadata
 * (`reasoning_options`) is resolved from the catalog section of the model's
 * underlying vendor (deepseek/anthropic/openai/…), which is where models.dev
 * actually stores it — the global `models` section carries no
 * `reasoning_options` at all.
 */

import type { LanguageModelChatInformation } from "vscode";
import type { CommandCodeModelItem } from "./types";
import { l10n } from "./localize";
import { MODEL_OVERRIDES, type ModelMetaOverride } from "./modelOverrides";
import {
    getCatalogProviderBaseUrl,
    getCatalogProviderModelEntry,
    inferDefaultReasoningEffort,
    inferReasoningEfforts,
    inferThinkingBudget,
    inferThinkingMode,
    inferVision,
    lookupModelDevEntry,
    type ModelsDevEntry,
} from "./modelsDev";

/** Supported provider IDs. */
export type ProviderId = "commandcode";

/** Fallback base URLs used when the catalog is not loaded. */
const FALLBACK_BASE_URLS: Record<ProviderId, string> = {
    "commandcode": "https://api.commandcode.ai/provider/v1/",
};

/** Per-provider display metadata (family grouping, name suffix). */
const PROVIDER_LABELS: Record<ProviderId, { family: string; detail: string; nameSuffix: string }> = {
    "commandcode": { family: "CommandCode", detail: "CommandCode", nameSuffix: "" },
};

const DEFAULT_CONTEXT_LENGTH = 128000;
const DEFAULT_MAX_TOKENS = 4096;

/**
 * models.dev provider IDs for the upstream vendors behind CommandCode's
 * gateway. models.dev has no "commandcode" provider entry, and per-model
 * reasoning data (`reasoning_options`: toggle / effort / budget_tokens) is
 * stored only in the real vendors' provider sections — the global `models`
 * section has none. When the CommandCode section is absent, fall back to the
 * underlying vendor's section so thinking toggles/efforts are not lost.
 * Ordered by specificity; the first matching rule wins.
 */
const VENDOR_PROVIDER_CANDIDATES: ReadonlyArray<readonly [RegExp, readonly string[]]> = [
    // Prefix rules (fully qualified IDs as returned by the /models endpoint)
    [/^deepseek\//i, ["deepseek"]],
    [/^anthropic\//i, ["anthropic"]],
    [/^openai\//i, ["openai"]],
    [/^qwen\//i, ["alibaba", "alibaba-cn"]],
    [/^minimaxai\//i, ["minimax", "minimax-cn"]],
    [/^moonshotai\//i, ["moonshotai", "moonshotai-cn"]],
    [/^poolside\//i, ["poolside"]],
    [/^zai-org\//i, ["zai"]],
    [/^google\//i, ["google"]],
    [/^x-ai\//i, ["xai"]],
    [/^mistral\//i, ["mistral"]],
    [/^meta\//i, ["meta"]],
    // Family rules (unprefixed IDs, e.g. "claude-sonnet-5")
    [/^claude[-/]/i, ["anthropic"]],
    [/^gpt[-0-9]/i, ["openai"]],
    [/^o[0-9]-/i, ["openai"]],
    [/^deepseek[-/]/i, ["deepseek"]],
    [/^qwen/i, ["alibaba", "alibaba-cn"]],
    [/^minimax/i, ["minimax", "minimax-cn"]],
    [/^kimi/i, ["moonshotai", "moonshotai-cn"]],
    [/^glm/i, ["zai"]],
    [/^gemini/i, ["google"]],
    [/^grok/i, ["xai"]],
    [/^laguna/i, ["poolside"]],
];

/**
 * Resolve the catalog entry of the underlying vendor for a model ID.
 * Returns undefined when the model has no known vendor mapping or the vendor
 * section has no matching entry.
 */
function getVendorProviderEntry(modelId: string): ModelsDevEntry | undefined {
    for (const [pattern, providerIds] of VENDOR_PROVIDER_CANDIDATES) {
        if (!pattern.test(modelId)) continue;
        for (const providerId of providerIds) {
            const entry = getCatalogProviderModelEntry(providerId, modelId);
            if (entry) return entry;
        }
        return undefined;
    }
    return undefined;
}

/**
 * Resolved model metadata. Every field that the catalog can supply has a
 * conservative default, so the object is always complete.
 */
export interface ModelMeta {
    displayName: string;
    vision: boolean;
    thinkingMode: "switchable" | "always" | "adaptive";
    supportedReasoningEfforts: string[];
    defaultReasoningEffort: string;
    contextLength: number;
    maxOutputTokens: number;
    apiMode: "openai" | "anthropic";
    supportsTemperature: boolean;
    toolCalling: boolean;
    baseUrl: string;
    thinkingBudget?: { min?: number; max?: number };
    status?: string;
    cost: { cache_read: number; input: number; output: number };
}

/**
 * Resolve the provider for a model ID. CommandCode exposes all models from
 * one OpenAI/Anthropic-compatible provider endpoint.
 */
export function resolveProviderForModelId(modelId: string): ProviderId {
    void modelId;
    return "commandcode";
}

/**
 * Resolve model metadata from the catalog with conservative defaults.
 * Per field: provider-specific entry → vendor entry → global entry → default.
 */
function resolveFromCatalog(providerId: ProviderId, modelId: string): ModelMeta {
    const providerEntry = getCatalogProviderModelEntry(providerId, modelId);
    const vendorEntry = getVendorProviderEntry(modelId);
    const globalEntry = lookupModelDevEntry(modelId);
    const entry: ModelsDevEntry | undefined = providerEntry ?? vendorEntry ?? globalEntry;

    const thinkingMode = entry ? inferThinkingMode(entry) : "switchable";
    const rawEfforts = entry ? inferReasoningEfforts(entry) : undefined;
    // Normalize: "none"/"disabled" effort values are represented by the "disabled" picker option
    const supportedReasoningEfforts = (rawEfforts ?? []).filter((e) => e !== "none" && e !== "disabled");

    return {
        displayName: entry?.name ?? modelId,
        vision: entry ? inferVision(entry) : false,
        thinkingMode,
        supportedReasoningEfforts,
        defaultReasoningEffort: entry ? inferDefaultReasoningEffort(entry) : "enabled",
        contextLength: entry?.limit?.context ?? DEFAULT_CONTEXT_LENGTH,
        maxOutputTokens: entry?.limit?.output ?? DEFAULT_MAX_TOKENS,
        // Claude uses CommandCode's Anthropic endpoint; all other listed
        // models use the OpenAI-compatible endpoint. This intentionally wins
        // over stale provider metadata from an unrelated catalog.
        apiMode: /^(?:anthropic\/)?claude[-/]/i.test(modelId) ? "anthropic" : "openai",
        supportsTemperature: entry?.temperature ?? true,
        toolCalling: entry?.tool_call ?? true,
        baseUrl: getCatalogProviderBaseUrl(providerId, FALLBACK_BASE_URLS[providerId]),
        thinkingBudget: entry ? inferThinkingBudget(entry) : undefined,
        status: entry?.status,
        cost: entry?.cost ?? { cache_read: 0, input: 0, output: 0 },
    };
}

/**
 * Apply per-model overrides. Override wins per field when present.
 */
function applyOverride(meta: ModelMeta, override?: ModelMetaOverride): ModelMeta {
    if (!override) return meta;
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
export function resolveModelMeta(providerId: ProviderId, modelId: string): ModelMeta {
    return applyOverride(resolveFromCatalog(providerId, modelId), MODEL_OVERRIDES[modelId]);
}

/**
 * Build the reasoning effort enum (values/labels/descriptions/default) for a model.
 */
function buildReasoningEnum(meta: ModelMeta): {
    enumValues: string[];
    enumItemLabels: string[];
    enumDescriptions: string[];
    defaultEffort: string;
} {
    const hasEfforts = meta.supportedReasoningEfforts.length > 0;
    let enumValues: string[];
    if (hasEfforts) {
        if (meta.thinkingMode === "switchable") {
            enumValues = ["disabled", ...meta.supportedReasoningEfforts];
        } else {
            enumValues = [...meta.supportedReasoningEfforts];
        }
    } else {
        if (meta.thinkingMode === "switchable") {
            enumValues = ["disabled", "enabled"];
        } else if (meta.thinkingMode === "adaptive") {
            enumValues = ["disabled", "adaptive"];
        } else {
            enumValues = ["enabled"];
        }
    }

    // Fall back to the last enum value when the requested default is not selectable
    // (e.g. "enabled" for an adaptive model).
    const defaultEffort = enumValues.includes(meta.defaultReasoningEffort)
        ? meta.defaultReasoningEffort
        : enumValues[enumValues.length - 1];

    const getLabel = (e: string): string => {
        switch (e) {
            case 'disabled': return l10n("Disabled");
            case 'adaptive': return l10n("Adaptive");
            case 'enabled': return l10n("Thinking");
            case 'low': return l10n("Low");
            case 'medium': return l10n("Medium");
            case 'high': return l10n("High");
            case 'xhigh': return l10n("Extra High");
            case 'max': return l10n("Maximum");
            default: return e.charAt(0).toUpperCase() + e.slice(1);
        }
    };
    const getDesc = (e: string): string => {
        switch (e) {
            case 'disabled': return l10n("Do not enable thinking");
            case 'adaptive': return l10n("Automatically decide when to think");
            case 'enabled': return l10n("Enable thinking");
            case 'low': return l10n("Reduce thinking, faster response");
            case 'medium': return l10n("Balance thinking and speed");
            case 'high': return l10n("Deeper thinking, slower response");
            case 'xhigh': return l10n("Very deep thinking, slower response");
            case 'max': return l10n("Maximum thinking depth, slowest response");
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
export const VISION_PROXY_LATEST_ALIAS = "qwen-plus-latest";

/**
 * Compare two model versions numerically (e.g. "3.10" > "3.9").
 */
/**
 * Resolve the vision proxy model ID.
 *
 * The special value "qwen-plus-latest" resolves to a current CommandCode
 * vision-capable model. Any explicit model ID is returned unchanged.
 */
export async function resolveVisionProxyModelId(configuredId: string): Promise<string> {
    if (configuredId !== VISION_PROXY_LATEST_ALIAS) {
        return configuredId;
    }
    return "Qwen/Qwen3.7-Plus";
}

/**
 * Check whether a model is marked as deprecated in the catalog.
 * Deprecated models are hidden from the model picker unless the user opts in.
 */
export function isModelDeprecated(providerId: ProviderId, modelId: string): boolean {
    return resolveModelMeta(providerId, modelId).status === "deprecated";
}

/**
 * Build a LanguageModelChatInformation entry (model picker) for a model.
 */
export function buildCatalogModelInfo(providerId: ProviderId, modelId: string): LanguageModelChatInformation {
    const meta = resolveModelMeta(providerId, modelId);
    const label = PROVIDER_LABELS[providerId];
    // Deprecated models keep a visible marker when shown (opt-in setting)
    const deprecatedPrefix = meta.status === "deprecated" ? l10n("[Depr] ") : "";
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
                    title: l10n("Reasoning Effort"),
                    enum: enumValues,
                    enumItemLabels: enumItemLabels,
                    enumDescriptions: enumDescriptions,
                    default: defaultEffort,
                    group: "navigation",
                },
            },
        },
    } satisfies LanguageModelChatInformation;
}

/**
 * Build the CommandCodeModelItem request config for a model.
 * The provider (Go vs Zen) is resolved from the model ID.
 */
export function getCatalogModelConfig(modelId: string): CommandCodeModelItem {
    const providerId = resolveProviderForModelId(modelId);
    const meta = resolveModelMeta(providerId, modelId);
    const override = MODEL_OVERRIDES[modelId];

    const config: CommandCodeModelItem = {
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
