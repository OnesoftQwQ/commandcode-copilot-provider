"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.VISION_TOOL_HISTORY_MIME = void 0;
exports.serializeVisionToolHistory = serializeVisionToolHistory;
exports.deserializeVisionToolHistory = deserializeVisionToolHistory;
exports.toOpenAIVisionToolMessages = toOpenAIVisionToolMessages;
exports.toAnthropicVisionToolMessages = toAnthropicVisionToolMessages;
const types_1 = require("./types");
/**
 * Private MIME type used to persist intercepted vision tool calls in the
 * provider response. VS Code can carry this DataPart into the next request,
 * while the upstream API receives ordinary tool-call/tool-result messages.
 */
exports.VISION_TOOL_HISTORY_MIME = "application/vnd.commandcode.vision-tool-history+json";
function isRecord(value) {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
function isNonNegativeInteger(value) {
    return typeof value === "number" && Number.isInteger(value) && value >= 0;
}
function parseEntry(value) {
    if (!isRecord(value)) {
        return null;
    }
    const { id, name, args, result, reasoningContent } = value;
    if (typeof id !== "string" ||
        id.length === 0 ||
        (name !== types_1.ASK_IMAGE_TOOL_NAME && name !== types_1.ASK_WITH_MULTI_IMAGE_TOOL_NAME) ||
        !isRecord(args) ||
        typeof args.query !== "string" ||
        typeof result !== "string" ||
        (reasoningContent !== undefined && typeof reasoningContent !== "string")) {
        return null;
    }
    if (args.imageIndex !== undefined && !isNonNegativeInteger(args.imageIndex)) {
        return null;
    }
    if (args.imageIndices !== undefined &&
        (!Array.isArray(args.imageIndices) || !args.imageIndices.every(isNonNegativeInteger))) {
        return null;
    }
    return {
        id,
        name,
        args: { ...args },
        result,
        ...(reasoningContent !== undefined ? { reasoningContent } : {}),
    };
}
/** Serialize one completed vision tool call/result for a DataPart. */
function serializeVisionToolHistory(entry) {
    const payload = { version: 1, entry };
    return new TextEncoder().encode(JSON.stringify(payload));
}
/** Decode and validate a persisted vision tool call/result. */
function deserializeVisionToolHistory(data) {
    try {
        const parsed = JSON.parse(new TextDecoder().decode(data));
        if (!isRecord(parsed) || parsed.version !== 1) {
            return null;
        }
        return parseEntry(parsed.entry);
    }
    catch {
        return null;
    }
}
/** Rebuild the standard OpenAI assistant tool-call + tool-result pair. */
function toOpenAIVisionToolMessages(entry) {
    const assistantMessage = {
        role: "assistant",
        tool_calls: [
            {
                id: entry.id,
                type: "function",
                function: {
                    name: entry.name,
                    arguments: JSON.stringify(entry.args),
                },
            },
        ],
    };
    if (entry.reasoningContent !== undefined) {
        assistantMessage.reasoning_content = entry.reasoningContent;
    }
    return [
        assistantMessage,
        {
            role: "tool",
            tool_call_id: entry.id,
            content: entry.result,
        },
    ];
}
/** Rebuild the standard Anthropic assistant tool_use + user tool_result pair. */
function toAnthropicVisionToolMessages(entry) {
    return [
        {
            role: "assistant",
            content: [
                {
                    type: "tool_use",
                    id: entry.id,
                    name: entry.name,
                    input: entry.args,
                },
            ],
        },
        {
            role: "user",
            content: [
                {
                    type: "tool_result",
                    tool_use_id: entry.id,
                    content: entry.result,
                },
            ],
        },
    ];
}
//# sourceMappingURL=historyCodec.js.map