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
exports.OpenaiApi = void 0;
const vscode = __importStar(require("vscode"));
const utils_1 = require("../utils");
const commonApi_1 = require("../commonApi");
const logger_1 = require("../logger");
const types_1 = require("../vision/types");
const historyPart_1 = require("../vision/historyPart");
const historyCodec_1 = require("../vision/historyCodec");
class OpenaiApi extends commonApi_1.CommonApi {
    constructor(modelId) {
        super(modelId);
    }
    /**
     * Whether images were found during convertMessages for ask_image tool.
     */
    _hasImages = false;
    /**
     * Convert VS Code chat request messages into OpenAI-compatible message objects.
     * For non-vision models, images are replaced with text references and stored
     * in instance-local _localImages for the ask_image tool.
     */
    async convertMessages(messages, modelConfig) {
        const modelSupportsVision = modelConfig.vision !== false;
        const out = [];
        let imageIndex = 0;
        // Collect images to instance-local array if model doesn't support vision
        const imagesToStore = [];
        if (!modelSupportsVision) {
            for (const m of messages) {
                for (const part of m.content ?? []) {
                    if (part instanceof vscode.LanguageModelDataPart && (0, utils_1.isImageMimeType)(part.mimeType)) {
                        imagesToStore.push({
                            data: part.data,
                            mimeType: part.mimeType,
                        });
                    }
                    // Also scan inside tool result content for images
                    // (e.g., when view_image tool returns an image in a previous turn)
                    if ((0, utils_1.isToolResultPart)(part)) {
                        const toolContent = part.content;
                        if (toolContent) {
                            for (const inner of toolContent) {
                                if (inner instanceof vscode.LanguageModelDataPart && (0, utils_1.isImageMimeType)(inner.mimeType)) {
                                    imagesToStore.push({
                                        data: inner.data,
                                        mimeType: inner.mimeType,
                                    });
                                }
                                else if (inner instanceof vscode.LanguageModelTextPart) {
                                    // Scan text for base64 data URI images
                                    (0, utils_1.storeDataUriImages)(inner.value, imagesToStore);
                                }
                                else if (inner instanceof vscode.LanguageModelDataPart && (0, utils_1.isResourceLinkMimeType)(inner.mimeType)) {
                                    // MCP tools may return images as resource links
                                    // (application/vnd.code.resource-link); resolve them
                                    // to actual image bytes for the ask_image proxy.
                                    const stored = await (0, utils_1.resolveResourceLinkToImage)(inner.data);
                                    if (stored) {
                                        imagesToStore.push(stored);
                                    }
                                }
                            }
                        }
                    }
                    // Scan direct text parts for base64 data URI images
                    if (part instanceof vscode.LanguageModelTextPart) {
                        (0, utils_1.storeDataUriImages)(part.value, imagesToStore);
                    }
                }
            }
            if (imagesToStore.length > 0) {
                this._localImages = imagesToStore;
                this._hasImages = true;
            }
        }
        for (const m of messages) {
            const role = (0, utils_1.mapRole)(m);
            const textParts = [];
            const imageParts = [];
            const toolCalls = [];
            const toolResults = [];
            const reasoningParts = [];
            const visionToolHistory = [];
            for (const part of m.content ?? []) {
                const historyEntry = (0, historyPart_1.parseVisionToolHistoryPart)(part);
                if (historyEntry) {
                    visionToolHistory.push(historyEntry);
                }
                else if (part instanceof vscode.LanguageModelTextPart) {
                    if (modelSupportsVision) {
                        textParts.push(part.value);
                    }
                    else {
                        // Replace data URI images with references, and track imageIndex
                        const result = (0, utils_1.replaceDataUriImages)(part.value, imageIndex);
                        imageIndex += result.count;
                        textParts.push(result.text);
                    }
                }
                else if (part instanceof vscode.LanguageModelDataPart && (0, utils_1.isImageMimeType)(part.mimeType)) {
                    if (modelSupportsVision) {
                        imageParts.push(part);
                    }
                    else {
                        // For non-vision models, replace image with text reference
                        // Use strong directive language so the model knows it MUST use ask_image
                        textParts.push(`\n[The user sent an image (imageIndex=${imageIndex}). I am a text-only model and CANNOT see images directly. I MUST call the ask_image tool to learn about it.\n\nRecommended strategy:\n1. First call ask_image for a brief description to get an overview of the image.\n2. Then call ask_image again with specific questions about details you need (e.g., colors, text content, UI elements, error messages, or any other visible information).\n]`);
                        imageIndex++;
                    }
                }
                else if (part instanceof vscode.LanguageModelToolCallPart) {
                    const id = part.callId || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
                    let args = "{}";
                    try {
                        args = JSON.stringify(part.input ?? {});
                    }
                    catch {
                        args = "{}";
                    }
                    toolCalls.push({ id, type: "function", function: { name: part.name, arguments: args } });
                }
                else if ((0, utils_1.isToolResultPart)(part)) {
                    const callId = part.callId ?? "";
                    const toolContent = part.content;
                    const toolTexts = [];
                    const toolImages = [];
                    if (toolContent) {
                        for (const inner of toolContent) {
                            if (inner instanceof vscode.LanguageModelTextPart) {
                                if (modelSupportsVision) {
                                    toolTexts.push(inner.value);
                                }
                                else {
                                    const result = (0, utils_1.replaceDataUriImages)(inner.value, imageIndex);
                                    imageIndex += result.count;
                                    toolTexts.push(result.text);
                                }
                            }
                            else if (inner instanceof vscode.LanguageModelDataPart && (0, utils_1.isImageMimeType)(inner.mimeType)) {
                                if (modelSupportsVision) {
                                    // Vision models receive the actual image content
                                    // (e.g. the built-in view_image tool result).
                                    toolImages.push({
                                        type: "image_url",
                                        image_url: { url: (0, utils_1.createDataUrl)(inner) },
                                    });
                                }
                                else {
                                    toolTexts.push(`\n[Image data from tool call (imageIndex=${imageIndex}). I am a text-only model and CANNOT see images directly. I MUST call the ask_image tool to learn about it.\n\nRecommended strategy:\n1. First call ask_image for a brief description to get an overview of the image.\n2. Then call ask_image again with specific questions about details you need (e.g., colors, text content, UI elements, error messages, or any other visible information).\n]`);
                                    imageIndex++;
                                }
                            }
                            else if (inner instanceof vscode.LanguageModelDataPart && (0, utils_1.isResourceLinkMimeType)(inner.mimeType)) {
                                // MCP tools may return images as resource links
                                // (application/vnd.code.resource-link) instead of raw
                                // image data; resolve the link and pass the image through.
                                const stored = await (0, utils_1.resolveResourceLinkToImage)(inner.data);
                                if (stored) {
                                    if (modelSupportsVision) {
                                        toolImages.push({
                                            type: "image_url",
                                            image_url: {
                                                url: (0, utils_1.createDataUrl)(new vscode.LanguageModelDataPart(stored.data, stored.mimeType)),
                                            },
                                        });
                                    }
                                    else {
                                        toolTexts.push(`\n[Image data from tool call (imageIndex=${imageIndex}). I am a text-only model and CANNOT see images directly. I MUST call the ask_image tool to learn about it.\n\nRecommended strategy:\n1. First call ask_image for a brief description to get an overview of the image.\n2. Then call ask_image again with specific questions about details you need (e.g., colors, text content, UI elements, error messages, or any other visible information).\n]`);
                                        imageIndex++;
                                    }
                                }
                                else {
                                    const link = (0, utils_1.parseResourceLinkData)(inner.data);
                                    toolTexts.push(link
                                        ? `\n[Tool returned an unresolvable resource link: ${link.uri}]`
                                        : "");
                                }
                            }
                        }
                    }
                    const joinedText = toolTexts.join("\n").trim();
                    let content;
                    if (toolImages.length > 0) {
                        const parts = [];
                        if (joinedText) {
                            parts.push({ type: "text", text: joinedText });
                        }
                        parts.push(...toolImages);
                        content = parts;
                    }
                    else {
                        content = joinedText;
                    }
                    toolResults.push({ callId, content });
                }
                else if (part instanceof vscode.LanguageModelThinkingPart) {
                    const content = Array.isArray(part.value) ? part.value.join("") : part.value;
                    reasoningParts.push(content);
                }
            }
            const joinedText = textParts.join("").trim();
            const joinedThinking = reasoningParts.join("").trim();
            // Persisted ask_image calls are restored as ordinary API messages.
            // Put them before this message's normal content so that a DataPart
            // appended after the previous assistant text still forms the valid
            // sequence: assistant tool_call → tool result → assistant text.
            for (const entry of visionToolHistory) {
                out.push(...(0, historyCodec_1.toOpenAIVisionToolMessages)(entry));
            }
            // process assistant message
            if (role === "assistant") {
                const assistantMessage = {
                    role: "assistant",
                };
                if (joinedText) {
                    assistantMessage.content = joinedText;
                }
                // Always set reasoning_content when includeReasoningInRequest is true
                // and reasoning parts exist — even if empty string, DeepSeek requires
                // round-tripping for context continuity across conversation turns.
                if (modelConfig.includeReasoningInRequest && reasoningParts.length > 0) {
                    assistantMessage.reasoning_content = joinedThinking;
                }
                if (toolCalls.length > 0) {
                    assistantMessage.tool_calls = toolCalls;
                }
                // Must have content or tool_calls — reasoning_content alone is rejected
                // by providers that require content/tool_calls to be set (e.g. DeepSeek).
                if (assistantMessage.content || assistantMessage.tool_calls) {
                    out.push(assistantMessage);
                }
            }
            // process tool result messages
            for (const tr of toolResults) {
                out.push({ role: "tool", tool_call_id: tr.callId, content: tr.content || "" });
            }
            // process user messages
            if (role === "user") {
                if (imageParts.length > 0) {
                    // multi-modal message
                    const contentArray = [];
                    if (joinedText) {
                        contentArray.push({
                            type: "text",
                            text: joinedText,
                        });
                    }
                    for (const imagePart of imageParts) {
                        const dataUrl = (0, utils_1.createDataUrl)(imagePart);
                        contentArray.push({
                            type: "image_url",
                            image_url: {
                                url: dataUrl,
                            },
                        });
                    }
                    out.push({ role, content: contentArray });
                }
                else {
                    // text-only message
                    if (joinedText) {
                        out.push({ role, content: joinedText });
                    }
                }
            }
            // process system messages
            if (role === "system" && joinedText) {
                out.push({ role, content: joinedText });
            }
        }
        this._originalApiMessages = out;
        return out;
    }
    prepareRequestBody(rb, um, options) {
        // temperature
        if (um?.temperature !== undefined && um.temperature !== null) {
            if (um.supportsTemperature !== false) {
                rb.temperature = um.temperature;
            }
        }
        // top_p
        if (um?.top_p !== undefined && um.top_p !== null) {
            rb.top_p = um.top_p;
        }
        // max_tokens / max_completion_tokens (mutually exclusive)
        if (um?.max_completion_tokens !== undefined) {
            rb.max_completion_tokens = um.max_completion_tokens;
        }
        else if (um?.max_tokens !== undefined) {
            rb.max_tokens = um.max_tokens;
        }
        // OpenAI reasoning configuration (only set when thinking is enabled)
        // Skip reasoning_effort for "adaptive" — it's not a standard API value
        if (um?.enable_thinking !== false && um?.reasoning_effort !== undefined && um.reasoning_effort !== 'adaptive') {
            rb.reasoning_effort = um.reasoning_effort;
        }
        // Thinking mode (OpenAI-compatible format: {"thinking": {"type": "enabled"}})
        if (um?.enable_thinking === true) {
            if (um?.reasoning_effort === 'adaptive') {
                rb.thinking = { type: "adaptive" };
            }
            else {
                rb.thinking = { type: "enabled" };
                if (um?.thinking_budget !== undefined) {
                    rb.thinking.budget_tokens = um.thinking_budget;
                }
            }
        }
        else {
            rb.thinking = { type: "disabled" };
        }
        // OpenRouter/CommandCode reasoning configuration
        if (um?.reasoning !== undefined && um.reasoning.enabled !== false) {
            const reasoningObj = {};
            const effort = um.reasoning.effort;
            if (effort && effort !== "auto") {
                reasoningObj.effort = effort;
            }
            else {
                reasoningObj.max_tokens = um.reasoning.max_tokens || 2000;
            }
            if (um.reasoning.exclude !== undefined) {
                reasoningObj.exclude = um.reasoning.exclude;
            }
            rb.reasoning = reasoningObj;
        }
        // stop
        if (options?.modelOptions) {
            const mo = options.modelOptions;
            if (typeof mo.stop === "string" || Array.isArray(mo.stop)) {
                rb.stop = mo.stop;
            }
        }
        // tools
        const toolConfig = (0, utils_1.convertToolsToOpenAI)(options);
        const toolsList = [];
        if (toolConfig.tools) {
            toolsList.push(...toolConfig.tools);
        }
        // Inject ask_image + ask_with_multi_image for non-vision models with stored images
        if (this._hasImages) {
            toolsList.push(types_1.ASK_IMAGE_TOOL_DEF);
            if (this._localImages.length >= 2) {
                toolsList.push(types_1.ASK_WITH_MULTI_IMAGE_TOOL_DEF);
            }
        }
        if (toolsList.length > 0) {
            rb.tools = toolsList;
        }
        if (this._hasImages) {
            // Set to "auto" so the model can freely choose to call ask_image.
            // Some providers (DeepSeek) reject forced function tool_choice.
            // The converted messages already contain strong directives telling the
            // model it MUST use ask_image, and the tool definition is available.
            rb.tool_choice = "auto";
        }
        else if (toolConfig.tool_choice) {
            rb.tool_choice = toolConfig.tool_choice;
        }
        // Extra model parameters
        if (um?.top_k !== undefined) {
            rb.top_k = um.top_k;
        }
        if (um?.min_p !== undefined) {
            rb.min_p = um.min_p;
        }
        if (um?.frequency_penalty !== undefined) {
            rb.frequency_penalty = um.frequency_penalty;
        }
        if (um?.presence_penalty !== undefined) {
            rb.presence_penalty = um.presence_penalty;
        }
        if (um?.repetition_penalty !== undefined) {
            rb.repetition_penalty = um.repetition_penalty;
        }
        // Extra body parameters (filter reserved keys with warning)
        const OPENAI_RESERVED_EXTRA_KEYS = new Set([
            "model", "messages", "stream", "temperature", "top_p",
            "max_tokens", "max_completion_tokens", "tools", "tool_choice", "stop",
            "reasoning_effort", "thinking", "top_k", "min_p",
            "frequency_penalty", "presence_penalty", "repetition_penalty",
            "stream_options", "reasoning",
        ]);
        if (um?.extra && typeof um.extra === "object") {
            for (const [key, value] of Object.entries(um.extra)) {
                if (OPENAI_RESERVED_EXTRA_KEYS.has(key)) {
                    logger_1.logger.warn("extra.conflict", { key, file: "openaiApi" });
                    continue;
                }
                if (value !== undefined) {
                    rb[key] = value;
                }
            }
        }
        return rb;
    }
    /**
     * Read and parse the SSE streaming response and report parts.
     */
    async processStreamingResponse(responseBody, progress, token) {
        const modelId = this._modelId;
        logger_1.logger.debug("openai.stream.start", { modelId });
        // Reset mutable state to prevent carryover from previous rounds
        this._resetStreamState();
        const reader = responseBody.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let cancelDisposable;
        // Immediately cancel the stream when user cancels, so reader.read() won't stay pending
        if (token.onCancellationRequested) {
            cancelDisposable = token.onCancellationRequested(() => {
                reader.cancel().catch(() => { });
            });
        }
        try {
            while (true) {
                if (token.isCancellationRequested) {
                    break;
                }
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                    if (!line.startsWith("data:")) {
                        continue;
                    }
                    const data = line.slice(5).trim();
                    logger_1.logger.debug("openai.stream.chunk", { modelId, data });
                    if (data === "[DONE]") {
                        await this.flushToolCallBuffers(progress, false);
                        continue;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        // Capture usage from stream_options: include_usage chunks (final chunk with no choices)
                        const usageData = parsed.usage;
                        if (usageData) {
                            let cacheHitTokens;
                            let cacheMissTokens;
                            // OpenAI format: prompt_tokens_details.cached_tokens
                            const details = usageData.prompt_tokens_details;
                            if (details && typeof details.cached_tokens === "number") {
                                cacheHitTokens = details.cached_tokens;
                                cacheMissTokens = (usageData.prompt_tokens ?? 0) - cacheHitTokens;
                            }
                            // DeepSeek format: prompt_cache_hit_tokens / prompt_cache_miss_tokens (overrides OpenAI)
                            if (typeof usageData.prompt_cache_hit_tokens === "number") {
                                cacheHitTokens = usageData.prompt_cache_hit_tokens;
                            }
                            if (typeof usageData.prompt_cache_miss_tokens === "number") {
                                cacheMissTokens = usageData.prompt_cache_miss_tokens;
                            }
                            const usage = {
                                promptTokens: usageData.prompt_tokens ?? 0,
                                completionTokens: usageData.completion_tokens ?? 0,
                                cacheHitTokens,
                                cacheMissTokens,
                            };
                            this._onUsage?.(usage);
                        }
                        await this.processDelta(parsed, progress);
                    }
                    catch (e) {
                        console.error("[CommandCode] Failed to parse SSE chunk:", e, "data:", data);
                        logger_1.logger.error("openai.stream.chunk.error", {
                            modelId,
                            error: e instanceof Error ? e.message : String(e),
                            data,
                        });
                    }
                }
            }
            logger_1.logger.debug("openai.stream.done", { modelId });
        }
        catch (e) {
            console.error("[CommandCode] Streaming response error:", e);
            logger_1.logger.error("openai.stream.error", { modelId, error: e instanceof Error ? e.message : String(e) });
            throw e;
        }
        finally {
            cancelDisposable?.dispose();
            reader.releaseLock();
            this.reportEndThinking(progress);
        }
    }
    /**
     * Handle a single streamed delta chunk, emitting text and tool call parts.
     */
    async processDelta(delta, progress) {
        let emitted = false;
        const choice = delta.choices?.[0];
        if (!choice) {
            return false;
        }
        const deltaObj = choice.delta;
        // Process thinking content first (before regular text content)
        try {
            let maybeThinking = choice?.thinking ??
                deltaObj?.thinking ??
                deltaObj?.reasoning ??
                deltaObj?.reasoning_content;
            // OpenRouter reasoning_details array handling
            const maybeReasoningDetails = deltaObj?.reasoning_details ??
                choice?.reasoning_details;
            if (maybeReasoningDetails && Array.isArray(maybeReasoningDetails) && maybeReasoningDetails.length > 0) {
                const details = maybeReasoningDetails;
                const sortedDetails = details.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
                for (const detail of sortedDetails) {
                    let extractedText = "";
                    if (detail.type === "reasoning.summary") {
                        extractedText = detail.summary;
                    }
                    else if (detail.type === "reasoning.text") {
                        extractedText = detail.text;
                    }
                    else if (detail.type === "reasoning.encrypted") {
                        extractedText = "[REDACTED]";
                    }
                    else {
                        extractedText = JSON.stringify(detail);
                    }
                    if (extractedText) {
                        this.bufferThinkingContent(extractedText, progress);
                        emitted = true;
                    }
                }
                maybeThinking = null;
            }
            if (maybeThinking !== undefined && maybeThinking !== null) {
                let text = "";
                if (maybeThinking && typeof maybeThinking === "object") {
                    const mt = maybeThinking;
                    text = typeof mt["text"] === "string" ? mt["text"] : JSON.stringify(mt);
                }
                else if (typeof maybeThinking === "string") {
                    text = maybeThinking;
                }
                if (text) {
                    // Accumulate reasoning content for echo-back in tool call proxy rounds
                    // DeepSeek thinking mode requires raw reasoning_content to be passed back verbatim
                    this._capturedReasoningContent += text;
                    this.bufferThinkingContent(text, progress);
                    emitted = true;
                }
            }
        }
        catch (e) {
            console.error("[CommandCode] Failed to process thinking/reasoning_details:", e);
        }
        if (deltaObj?.content) {
            const content = String(deltaObj.content);
            const xmlRes = this.processXmlThinkBlocks(content, progress);
            if (xmlRes.emittedAny) {
                emitted = true;
            }
            else {
                this.reportEndThinking(progress);
                const res = this.processTextContent(content, progress);
                if (res.emittedAny) {
                    this._hasEmittedAssistantText = true;
                    emitted = true;
                }
            }
        }
        if (deltaObj?.tool_calls) {
            this.reportEndThinking(progress);
            const toolCalls = deltaObj.tool_calls;
            if (!this._emittedBeginToolCallsHint && this._hasEmittedAssistantText && toolCalls.length > 0) {
                progress.report(new vscode.LanguageModelTextPart(" "));
                this._emittedBeginToolCallsHint = true;
            }
            for (const tc of toolCalls) {
                const idx = tc.index ?? 0;
                if (this._completedToolCallIndices.has(idx)) {
                    continue;
                }
                const buf = this._toolCallBuffers.get(idx) ?? { args: "" };
                if (tc.id && typeof tc.id === "string") {
                    buf.id = tc.id;
                }
                const func = tc.function;
                if (func?.name && typeof func.name === "string") {
                    buf.name = func.name;
                }
                if (typeof func?.arguments === "string") {
                    buf.args += func.arguments;
                }
                this._toolCallBuffers.set(idx, buf);
                await this.tryEmitBufferedToolCall(idx, progress);
            }
        }
        const finish = choice.finish_reason ?? undefined;
        if (finish === "tool_calls" || finish === "stop") {
            await this.flushToolCallBuffers(progress, true);
        }
        return emitted;
    }
    /**
     * Create a non-streaming chat message (for Git commit generation).
     */
    async *createMessage(model, systemPrompt, messages, baseUrl, apiKey, signal) {
        const openaiMessages = [...messages];
        if (systemPrompt) {
            openaiMessages.unshift({ role: "system", content: systemPrompt });
        }
        let requestBody = {
            model: model.id,
            messages: openaiMessages,
            stream: true,
        };
        requestBody = this.prepareRequestBody(requestBody, model, undefined);
        const headers = commonApi_1.CommonApi.prepareHeaders(apiKey, model.apiMode ?? "openai", model.headers);
        const url = `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
        const response = await fetch(url, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody),
            signal,
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: [${response.status}] ${response.statusText}${errorText ? `\n${errorText}` : ""}\nURL: ${url}`);
        }
        if (!response.body) {
            throw new Error("No response body from API");
        }
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        // Cancel the reader immediately when abort signal fires
        if (signal) {
            signal.addEventListener("abort", () => {
                reader.cancel().catch(() => { });
            });
        }
        try {
            while (true) {
                const { done, value } = await reader.read();
                if (done) {
                    break;
                }
                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split("\n");
                buffer = lines.pop() || "";
                for (const line of lines) {
                    if (!line.startsWith("data:")) {
                        continue;
                    }
                    const data = line.slice(5).trim();
                    if (data === "[DONE]") {
                        continue;
                    }
                    try {
                        const parsed = JSON.parse(data);
                        const choice = parsed.choices?.[0];
                        if (choice?.delta) {
                            const deltaObj = choice.delta;
                            const content = deltaObj.content;
                            if (content) {
                                yield { type: "text", text: content };
                            }
                        }
                    }
                    catch {
                        // Skip unparseable chunks
                    }
                }
            }
        }
        finally {
            reader.releaseLock();
        }
    }
}
exports.OpenaiApi = OpenaiApi;
//# sourceMappingURL=openaiApi.js.map