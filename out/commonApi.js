"use strict";
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
exports.CommonApi = void 0;
const vscode = __importStar(require("vscode"));
const vscode_1 = require("vscode");
const utils_1 = require("./utils");
const versionManager_1 = require("./versionManager");
const types_1 = require("./vision/types");
const logger_1 = require("./logger");
class CommonApi {
    /** Buffer for assembling streamed tool calls by index. */
    _toolCallBuffers = new Map();
    /** Indices for which a tool call has been fully emitted. */
    _completedToolCallIndices = new Set();
    /** Track if we emitted any assistant text before seeing tool calls (SSE-like begin-tool-calls hint). */
    _hasEmittedAssistantText = false;
    /** Track if we emitted any text. */
    _hasEmittedText = false;
    /** Track if we emitted any thinking text. */
    _hasEmittedThinking = false;
    /** Track if we emitted the begin-tool-calls whitespace flush. */
    _emittedBeginToolCallsHint = false;
    // XML think block parsing state
    _xmlThinkActive = false;
    _xmlThinkDetectionAttempted = false;
    // Thinking content state management
    _currentThinkingId = null;
    /** Buffer for accumulating thinking content before emitting. */
    _thinkingBuffer = "";
    /** Timer for delayed flushing of thinking buffer. */
    _thinkingFlushTimer = null;
    /** System prompts to include in requests. */
    _systemContent;
    /** Set the model ID for logging purposes. */
    _modelId = "";
    /** Callback for streaming usage updates (prompt/completion/cache tokens). */
    _onUsage;
    set onUsage(callback) {
        this._onUsage = callback;
    }
    /**
     * When an ask_image tool call is intercepted during streaming,
     * this holds the parsed tool call info for the provider to handle.
     */
    interceptedToolCall = null;
    /**
     * Captures the reasoning_content from the streaming response so it can be
     * echoed back in the next round's assistant message. DeepSeek thinking mode
     * requires the original reasoning_content to be passed back verbatim.
     * Reset to "" at the start of each streaming round.
     */
    _capturedReasoningContent = "";
    /**
     * Locally stored images collected during convertMessages.
     * Lives on the instance only — no global Map, automatically GC'd.
     */
    _localImages = [];
    /**
     * Store the converted API messages so the provider can reference them
     * when building the second round (tool call + result) request.
     */
    _originalApiMessages = null;
    /**
     * Get the stored images associated with this instance, if any.
     */
    getStoredImage(imageIndex) {
        if (imageIndex < 0 || imageIndex >= this._localImages.length)
            return undefined;
        return this._localImages[imageIndex];
    }
    constructor(modelId) {
        this._modelId = modelId;
    }
    /**
     * Try to emit a buffered tool call when a valid name and JSON arguments are available.
     * @param index The tool call index from the stream.
     * @param progress Progress reporter for parts.
     */
    async tryEmitBufferedToolCall(index, progress) {
        const buf = this._toolCallBuffers.get(index);
        if (!buf) {
            return;
        }
        if (!buf.name) {
            return;
        }
        // Skip ask_image / ask_with_multi_image — handled by provider via interceptedToolCall
        if (buf.name === types_1.ASK_IMAGE_TOOL_NAME || buf.name === types_1.ASK_WITH_MULTI_IMAGE_TOOL_NAME) {
            return;
        }
        const canParse = (0, utils_1.tryParseJSONObject)(buf.args);
        if (!canParse.ok) {
            return;
        }
        const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
        let parameters = canParse.value;
        parameters = this.adjustReadFileParameters(buf.name, parameters);
        progress.report(new vscode_1.LanguageModelToolCallPart(id, buf.name, parameters));
        this._toolCallBuffers.delete(index);
        this._completedToolCallIndices.add(index);
    }
    /**
     * Flush all buffered tool calls, optionally throwing if arguments are not valid JSON.
     * @param progress Progress reporter for parts.
     * @param throwOnInvalid If true, throw when a tool call has invalid JSON args.
     */
    async flushToolCallBuffers(progress, throwOnInvalid) {
        if (this._toolCallBuffers.size === 0) {
            return;
        }
        for (const [idx, buf] of Array.from(this._toolCallBuffers.entries())) {
            // Intercept ask_image / ask_with_multi_image — store on instance for provider to handle
            if (buf.name === types_1.ASK_IMAGE_TOOL_NAME || buf.name === types_1.ASK_WITH_MULTI_IMAGE_TOOL_NAME) {
                const argsText = buf.args.trim() || "{}";
                const parsed = (0, utils_1.tryParseJSONObject)(argsText);
                if (parsed.ok) {
                    this.interceptedToolCall = {
                        id: buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`,
                        name: buf.name,
                        args: parsed.value,
                    };
                }
                this._toolCallBuffers.delete(idx);
                this._completedToolCallIndices.add(idx);
                continue;
            }
            const argsText = buf.args.trim() || "{}";
            const parsed = (0, utils_1.tryParseJSONObject)(argsText);
            if (!parsed.ok) {
                if (throwOnInvalid) {
                    console.error("[CommandCode] Invalid JSON for tool call", {
                        idx,
                        snippet: (buf.args || "").slice(0, 200),
                    });
                    throw new Error("Invalid JSON for tool call");
                }
                continue;
            }
            const id = buf.id ?? `call_${Math.random().toString(36).slice(2, 10)}`;
            const name = buf.name ?? "unknown_tool";
            let parameters = parsed.value;
            parameters = this.adjustReadFileParameters(name, parameters);
            progress.report(new vscode_1.LanguageModelToolCallPart(id, name, parameters));
            this._toolCallBuffers.delete(idx);
            this._completedToolCallIndices.add(idx);
        }
    }
    /**
     * Adjust read_file tool parameters to default to reading configurable number of lines.
     * @param toolName The name of the tool being called.
     * @param parameters The tool parameters.
     * @returns Adjusted parameters.
     */
    adjustReadFileParameters(toolName, parameters) {
        if (toolName !== "read_file") {
            return parameters;
        }
        const config = vscode.workspace.getConfiguration();
        const defaultLines = config.get("commandcode.readFileLines", 0);
        if (defaultLines <= 0) {
            return parameters;
        }
        const startLine = typeof parameters.startLine === "number" ? parameters.startLine : 1;
        const endLine = typeof parameters.endLine === "number" ? parameters.endLine : startLine;
        if (endLine < startLine + defaultLines) {
            return { ...parameters, endLine: startLine + defaultLines };
        }
        return parameters;
    }
    /**
     * Reset mutable streaming state. Must be called at the start of each
     * processStreamingResponse invocation to prevent state carryover between
     * rounds (e.g., first round → vision proxy → second round).
     * Optional fields like _onUsage and _capturedReasoningContent are left as-is
     * because they are intentionally managed across rounds.
     */
    _resetStreamState() {
        this._toolCallBuffers.clear();
        this._completedToolCallIndices.clear();
        this._hasEmittedAssistantText = false;
        this._hasEmittedText = false;
        this._hasEmittedThinking = false;
        this._emittedBeginToolCallsHint = false;
        this._xmlThinkActive = false;
        this._xmlThinkDetectionAttempted = false;
        this._currentThinkingId = null;
        this._thinkingBuffer = "";
        if (this._thinkingFlushTimer) {
            clearTimeout(this._thinkingFlushTimer);
            this._thinkingFlushTimer = null;
        }
        this.interceptedToolCall = null;
    }
    /**
     * Report to VS Code for ending thinking
     * @param progress Progress reporter for parts
     */
    reportEndThinking(progress) {
        if (!this._currentThinkingId) {
            return;
        }
        try {
            this.flushThinkingBuffer(progress);
            progress.report(new vscode_1.LanguageModelThinkingPart("", this._currentThinkingId));
        }
        catch (e) {
            console.error("[CommandCode] Failed to end thinking sequence:", e);
        }
        this._currentThinkingId = null;
        this._thinkingBuffer = "";
        if (this._thinkingFlushTimer) {
            clearTimeout(this._thinkingFlushTimer);
            this._thinkingFlushTimer = null;
        }
    }
    /**
     * Generate a unique thinking ID based on request start time and random suffix
     */
    generateThinkingId() {
        return `thinking_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    }
    /**
     * Buffer and schedule a flush for thinking content.
     * @param text The thinking text to buffer
     * @param progress Progress reporter for parts
     */
    bufferThinkingContent(text, progress) {
        this._hasEmittedThinking = true;
        if (!this._currentThinkingId) {
            this._currentThinkingId = this.generateThinkingId();
        }
        this._thinkingBuffer += text;
        if (!this._thinkingFlushTimer) {
            this._thinkingFlushTimer = setTimeout(() => {
                this.flushThinkingBuffer(progress);
            }, 100);
        }
    }
    /**
     * Flush the thinking buffer to the progress reporter.
     * @param progress Progress reporter for parts.
     */
    flushThinkingBuffer(progress) {
        if (this._thinkingFlushTimer) {
            clearTimeout(this._thinkingFlushTimer);
            this._thinkingFlushTimer = null;
        }
        if (this._thinkingBuffer && this._currentThinkingId) {
            const text = this._thinkingBuffer;
            this._thinkingBuffer = "";
            progress.report(new vscode_1.LanguageModelThinkingPart(text, this._currentThinkingId));
        }
    }
    /**
     * Process XML think blocks in text content.
     * @param content The text content to process.
     * @param progress Progress reporter for parts.
     * @returns Object indicating whether any think blocks were emitted.
     */
    processXmlThinkBlocks(content, progress) {
        if (!content.includes("꽁") && !content.includes("ground") && !this._xmlThinkActive) {
            return { emittedAny: false };
        }
        this._xmlThinkDetectionAttempted = true;
        let remaining = content;
        let emittedAny = false;
        while (remaining.length > 0) {
            if (this._xmlThinkActive) {
                const endIdx = remaining.indexOf("꽁");
                if (endIdx === -1) {
                    this.bufferThinkingContent(remaining, progress);
                    emittedAny = true;
                    break;
                }
                else {
                    const thinkText = remaining.slice(0, endIdx);
                    if (thinkText) {
                        this.bufferThinkingContent(thinkText, progress);
                        emittedAny = true;
                    }
                    this.reportEndThinking(progress);
                    this._xmlThinkActive = false;
                    remaining = remaining.slice(endIdx + 8);
                }
            }
            else {
                const startIdx = remaining.indexOf("꽁");
                if (startIdx === -1) {
                    if (!emittedAny) {
                        return { emittedAny: false };
                    }
                    // Emit remaining text after think block
                    this.reportEndThinking(progress);
                    if (remaining.trim()) {
                        progress.report(new vscode.LanguageModelTextPart(remaining));
                    }
                    break;
                }
                else {
                    // Emit text before 꽁 tag
                    const beforeThink = remaining.slice(0, startIdx);
                    if (beforeThink.trim()) {
                        this.reportEndThinking(progress);
                        progress.report(new vscode.LanguageModelTextPart(beforeThink));
                    }
                    this._xmlThinkActive = true;
                    remaining = remaining.slice(startIdx + 7);
                }
            }
        }
        return { emittedAny };
    }
    /**
     * Process regular text content (non-XML-think).
     * @param content Text content to process.
     * @param progress Progress reporter for parts.
     * @returns Object indicating whether any text was emitted.
     */
    processTextContent(content, progress) {
        if (!content) {
            return { emittedAny: false };
        }
        progress.report(new vscode.LanguageModelTextPart(content));
        return { emittedAny: true };
    }
    /**
     * Prepare headers for API request.
     * @param apiKey The API key to use.
     * @param apiMode The apiMode (affects header format).
     * @param customHeaders Optional custom headers from model config.
     * @returns Headers object.
     */
    static prepareHeaders(apiKey, apiMode, customHeaders) {
        // Internal override for testing or contingency (e.g. if the API ever gates access by User-Agent again).
        const customUserAgent = process.env.COMMANDCODE_USER_AGENT ?? "";
        const userAgent = customUserAgent.trim() || versionManager_1.VersionManager.getUserAgent();
        const headers = {
            "Content-Type": "application/json",
            "User-Agent": userAgent,
            "Accept": "*/*",
            "Accept-Encoding": "gzip, deflate, br, zstd",
        };
        if (vscode.workspace.getConfiguration("commandcode").get("zeroDataRetention", false)) {
            headers["x-cmd-zdr"] = "1";
        }
        logger_1.logger.debug("prepareHeaders", {
            apiMode: apiMode,
            headersUsed: headers,
            customHeadersProvided: customHeaders ? Object.keys(customHeaders) : [],
        });
        // Provider-specific header formats
        if (apiMode === "anthropic") {
            headers["x-api-key"] = apiKey;
            headers["anthropic-version"] = "2023-06-01";
        }
        else {
            // OpenAI-compatible API uses Bearer auth
            headers["Authorization"] = `Bearer ${apiKey}`;
        }
        // Merge custom headers if provided
        if (customHeaders) {
            for (const [key, value] of Object.entries(customHeaders)) {
                headers[key] = value;
            }
        }
        return headers;
    }
}
exports.CommonApi = CommonApi;
//# sourceMappingURL=commonApi.js.map