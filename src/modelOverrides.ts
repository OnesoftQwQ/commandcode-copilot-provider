/**
 * Optional per-model adjustments for CommandCode.
 *
 * CommandCode exposes the native model IDs through one API and the live
 * `/models` endpoint is the source of truth. Keep this table empty by
 * default so metadata from OpenCode-specific routing does not leak into the
 * CommandCode adapter. It remains an extension point for future quirks.
 */
export interface ModelMetaOverride {
    displayName?: string;
    vision?: boolean;
    thinkingMode?: "switchable" | "always" | "adaptive";
    supportedReasoningEfforts?: string[];
    defaultReasoningEffort?: string;
    contextLength?: number;
    maxOutputTokens?: number;
    apiMode?: "openai" | "anthropic";
    supportsTemperature?: boolean;
    toolCalling?: boolean;
    baseUrl?: string;
    extra?: Record<string, unknown>;
    thinkingBudget?: { min?: number; max?: number };
    includeReasoningInRequest?: boolean;
    status?: string;
    cost?: { cache_read: number; input: number; output: number };
}

export const MODEL_OVERRIDES: Record<string, ModelMetaOverride> = {};
