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
exports.RESOURCE_LINK_MIME = void 0;
exports.getModelProviderId = getModelProviderId;
exports.normalizeUserModels = normalizeUserModels;
exports.parseModelId = parseModelId;
exports.mapRole = mapRole;
exports.convertToolsToOpenAI = convertToolsToOpenAI;
exports.createRetryConfig = createRetryConfig;
exports.executeWithRetry = executeWithRetry;
exports.isImageMimeType = isImageMimeType;
exports.isResourceLinkMimeType = isResourceLinkMimeType;
exports.parseResourceLinkData = parseResourceLinkData;
exports.guessImageMimeTypeFromUri = guessImageMimeTypeFromUri;
exports.resolveResourceLinkToImage = resolveResourceLinkToImage;
exports.storeDataUriImages = storeDataUriImages;
exports.replaceDataUriImages = replaceDataUriImages;
exports.createDataUrl = createDataUrl;
exports.isToolResultPart = isToolResultPart;
exports.collectToolResultText = collectToolResultText;
exports.tryParseJSONObject = tryParseJSONObject;
exports.delay = delay;
const vscode = __importStar(require("vscode"));
const RETRY_MAX_ATTEMPTS = 3;
const RETRY_INTERVAL_MS = 1000;
const RETRY_BACKOFF_FACTOR = 2;
const RETRY_MAX_INTERVAL_MS = 60000;
// HTTP status codes that should trigger a retry
const RETRYABLE_STATUS_CODES = [429, 500, 502, 503, 504];
// Network error patterns to retry
const networkErrorPatterns = [
    "fetch failed",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "ECONNREFUSED",
    "timeout",
    "TIMEOUT",
    "network error",
    "NetworkError",
];
function getModelProviderId(model) {
    if (!model || typeof model !== "object") {
        return "";
    }
    const obj = model;
    const pick = (v) => (typeof v === "string" ? v.trim() : "");
    return (pick(obj.owned_by) ||
        pick(obj.provide) ||
        pick(obj.provider) ||
        pick(obj.ownedBy) ||
        pick(obj.owner) ||
        pick(obj.vendor));
}
function normalizeUserModels(models) {
    const list = Array.isArray(models) ? models : [];
    const out = [];
    for (const item of list) {
        if (!item || typeof item !== "object") {
            continue;
        }
        const provider = getModelProviderId(item);
        out.push({ ...item, owned_by: provider });
    }
    return out;
}
/**
 * Parse a model ID that may contain a configuration ID separator.
 * Format: "baseId::configId" or just "baseId"
 */
function parseModelId(modelId) {
    const parts = modelId.split("::");
    if (parts.length >= 2) {
        return {
            baseId: parts[0],
            configId: parts.slice(1).join("::"),
        };
    }
    return {
        baseId: modelId,
    };
}
/**
 * Map VS Code message role to OpenAI message role string.
 */
function mapRole(message) {
    const USER = vscode.LanguageModelChatMessageRole.User;
    const ASSISTANT = vscode.LanguageModelChatMessageRole.Assistant;
    const r = message.role;
    if (r === USER) {
        return "user";
    }
    if (r === ASSISTANT) {
        return "assistant";
    }
    return "system";
}
/**
 * Convert VS Code tool definitions to OpenAI function tool definitions.
 */
function convertToolsToOpenAI(options) {
    if (!options?.tools || options.tools.length === 0) {
        return {};
    }
    const tools = options.tools.map((tool) => {
        const def = {
            type: "function",
            function: {
                name: tool.name,
                description: tool.description,
            },
        };
        // Use the tool's inputSchema as parameters if available
        if (tool.inputSchema) {
            def.function.parameters = tool.inputSchema;
        }
        else {
            def.function.parameters = { type: "object", properties: {} };
        }
        return def;
    });
    // Determine tool_choice mode
    const toolMode = options?.modelOptions
        ?.toolMode;
    let toolChoice;
    if (toolMode === "required") {
        toolChoice = "required";
    }
    else if (toolMode === "none") {
        toolChoice = "none";
    }
    else if (toolMode === "auto") {
        toolChoice = "auto";
    }
    return { tools, tool_choice: toolChoice };
}
/**
 * Create retry configuration from VS Code settings.
 */
function createRetryConfig() {
    const config = vscode.workspace.getConfiguration("commandcode.retry");
    const enabled = config.get("enabled", true);
    const maxAttempts = config.get("max_attempts", RETRY_MAX_ATTEMPTS);
    const intervalMs = config.get("interval_ms", RETRY_INTERVAL_MS);
    const additionalStatusCodes = config.get("status_codes", []);
    return {
        enabled,
        maxAttempts,
        intervalMs,
        backoffFactor: RETRY_BACKOFF_FACTOR,
        maxIntervalMs: RETRY_MAX_INTERVAL_MS,
        statusCodes: [...RETRYABLE_STATUS_CODES, ...additionalStatusCodes],
    };
}
/**
 * Execute an async function with retry logic.
 */
async function executeWithRetry(fn, retryConfig) {
    if (!retryConfig.enabled) {
        return fn();
    }
    let lastError;
    let delay = retryConfig.intervalMs;
    for (let attempt = 1; attempt <= retryConfig.maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt === retryConfig.maxAttempts) {
                break;
            }
            // Check if error is retryable
            const isRetryable = isRetryableError(lastError, retryConfig.statusCodes);
            if (!isRetryable) {
                break;
            }
            // Wait before retrying
            await new Promise((resolve) => setTimeout(resolve, delay));
            // Exponential backoff
            delay = Math.min(delay * retryConfig.backoffFactor, retryConfig.maxIntervalMs);
        }
    }
    throw lastError;
}
function isRetryableError(error, retryableStatusCodes) {
    const message = error.message.toLowerCase();
    // Check network error patterns
    for (const pattern of networkErrorPatterns) {
        if (message.includes(pattern.toLowerCase())) {
            return true;
        }
    }
    // Check HTTP status codes in error message
    for (const code of retryableStatusCodes) {
        if (message.includes(`[${code}]`) || message.includes(`status ${code}`)) {
            return true;
        }
    }
    return false;
}
/**
 * Check if a mime type is an image type.
 */
function isImageMimeType(mimeType) {
    return mimeType.startsWith("image/");
}
/**
 * VS Code MIME type for MCP tool result resource links.
 * The data is a JSON string: { "uri": string, "underlyingMimeType"?: string }.
 * @see https://github.com/microsoft/vscode/blob/main/src/vs/workbench/contrib/mcp/common/mcpTypes.ts
 */
exports.RESOURCE_LINK_MIME = "application/vnd.code.resource-link";
/**
 * Check if a mime type is an MCP resource-link data part.
 */
function isResourceLinkMimeType(mimeType) {
    return mimeType === exports.RESOURCE_LINK_MIME;
}
/**
 * Parse the JSON payload of an MCP resource-link data part.
 * Returns null when the payload is not a valid resource link.
 */
function parseResourceLinkData(data) {
    try {
        const parsed = JSON.parse(new TextDecoder().decode(data));
        if (parsed && typeof parsed === "object" && typeof parsed.uri === "string") {
            const uri = parsed.uri;
            const underlying = parsed.underlyingMimeType;
            return {
                uri,
                ...(typeof underlying === "string" ? { underlyingMimeType: underlying } : {}),
            };
        }
    }
    catch {
        // ignore malformed payloads
    }
    return null;
}
const RESOURCE_LINK_EXT_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
};
/**
 * Guess an image MIME type from a resource URI path extension.
 */
function guessImageMimeTypeFromUri(uri) {
    try {
        const pathname = vscode.Uri.parse(uri).path.toLowerCase();
        const ext = pathname.slice(pathname.lastIndexOf("."));
        return RESOURCE_LINK_EXT_MIME[ext];
    }
    catch {
        return undefined;
    }
}
/**
 * Resolve an MCP resource-link data part to actual image bytes when possible.
 * VS Code registers a file system provider for `vscode-chat-response-resource://`
 * URIs, so images can be read back while the chat session is alive.
 * Returns null when the link is not an image or cannot be read.
 */
async function resolveResourceLinkToImage(data) {
    const link = parseResourceLinkData(data);
    if (!link) {
        return null;
    }
    const mimeType = link.underlyingMimeType || guessImageMimeTypeFromUri(link.uri);
    if (!mimeType || !isImageMimeType(mimeType)) {
        return null;
    }
    try {
        const uri = vscode.Uri.parse(link.uri);
        const bytes = await vscode.workspace.fs.readFile(uri);
        if (!bytes || bytes.length === 0) {
            return null;
        }
        return { data: bytes, mimeType };
    }
    catch {
        // Resource may be gone (session disposed) or scheme not readable.
        return null;
    }
}
/**
 * Regex pattern to match data URI encoded images in text.
 * Matches: data:image/{format};base64,{base64_data}
 */
const DATA_URI_IMAGE_RE = /data:image\/(?:png|jpeg|jpg|gif|webp|bmp);base64,([A-Za-z0-9+/=]+)/g;
/**
 * Detect base64-encoded data URI images in text, decode and store them.
 * Used during the image storage pass in convertMessages.
 * @returns The number of data URI images found and stored.
 */
function storeDataUriImages(text, imagesToStore) {
    let count = 0;
    DATA_URI_IMAGE_RE.lastIndex = 0;
    let match;
    while ((match = DATA_URI_IMAGE_RE.exec(text)) !== null) {
        const fullMatch = match[0];
        const base64Data = match[1];
        count++;
        let mimeType = "image/png";
        if (fullMatch.startsWith("data:image/jpeg"))
            mimeType = "image/jpeg";
        else if (fullMatch.startsWith("data:image/gif"))
            mimeType = "image/gif";
        else if (fullMatch.startsWith("data:image/webp"))
            mimeType = "image/webp";
        else if (fullMatch.startsWith("data:image/bmp"))
            mimeType = "image/bmp";
        const binaryStr = atob(base64Data);
        const bytes = new Uint8Array(binaryStr.length);
        for (let i = 0; i < binaryStr.length; i++) {
            bytes[i] = binaryStr.charCodeAt(i);
        }
        imagesToStore.push({ data: bytes, mimeType });
    }
    return count;
}
/**
 * Replace base64-encoded data URI images in text with image index references.
 * Does NOT store images (they should already be stored by the storage pass).
 * @param text The text to scan.
 * @param startIndex The starting imageIndex to assign.
 * @returns { text: string; count: number } The modified text and number of replacements.
 */
function replaceDataUriImages(text, startIndex) {
    let result = text;
    let offset = 0;
    let count = 0;
    let idx = startIndex;
    DATA_URI_IMAGE_RE.lastIndex = 0;
    let match;
    while ((match = DATA_URI_IMAGE_RE.exec(text)) !== null) {
        const fullMatch = match[0];
        count++;
        const before = result.slice(0, match.index + offset);
        const after = result.slice(match.index + offset + fullMatch.length);
        const replacement = `\n[Image data from tool call (imageIndex=${idx}). I am a text-only model and CANNOT see images directly. I MUST call the ask_image tool to learn about it.\n\nRecommended strategy:\n1. First call ask_image for a brief description to get an overview of the image.\n2. Then call ask_image again with specific questions about details you need (e.g., colors, text content, UI elements, error messages, or any other visible information).\n]`;
        result = before + replacement + after;
        offset += replacement.length - fullMatch.length;
        idx++;
    }
    return { text: result, count };
}
/**
 * Create a data URL from a LanguageModelDataPart.
 */
function createDataUrl(part) {
    const base64 = arrayBufferToBase64(part.data);
    return `data:${part.mimeType};base64,${base64}`;
}
function arrayBufferToBase64(buffer) {
    let binary = "";
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}
/**
 * Check if a part is a tool result part.
 */
function isToolResultPart(part) {
    return part instanceof vscode.LanguageModelToolResultPart;
}
/**
 * Collect text content from a tool result part.
 */
function collectToolResultText(part) {
    if (!part.content) {
        return "";
    }
    const texts = [];
    for (const item of part.content) {
        if (item instanceof vscode.LanguageModelTextPart) {
            texts.push(item.value);
        }
    }
    return texts.join("\n").trim();
}
/**
 * Safely try to parse a JSON object from a string.
 * Returns { ok: true, value } or { ok: false }.
 */
function tryParseJSONObject(text) {
    try {
        const parsed = JSON.parse(text);
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
            return { ok: true, value: parsed };
        }
        return { ok: false };
    }
    catch {
        return { ok: false };
    }
}
function delay(ms, token) {
    return new Promise((resolve) => {
        if (token?.isCancellationRequested) {
            return resolve();
        }
        const timer = setTimeout(() => {
            disposable?.dispose();
            resolve();
        }, ms);
        const disposable = token?.onCancellationRequested(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}
//# sourceMappingURL=utils.js.map