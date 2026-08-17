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
exports.BaseTokensPerName = exports.BaseTokensPerMessage = void 0;
exports.countMessageTokens = countMessageTokens;
exports.textTokenLength = textTokenLength;
exports.countToolTokens = countToolTokens;
exports.calculateImageTokenCost = calculateImageTokenCost;
exports.calculateNonImageBinaryTokens = calculateNonImageBinaryTokens;
const vscode = __importStar(require("vscode"));
const tokenizerManager_1 = require("./tokenizer/tokenizerManager");
const imageUtils_1 = require("./tokenizer/imageUtils");
const utils_1 = require("./utils");
exports.BaseTokensPerMessage = 3;
exports.BaseTokensPerName = 1;
async function countMessageTokens(text, modelConfig) {
    if (typeof text === "string") {
        return textTokenLength(text);
    }
    else {
        let totalTokens = exports.BaseTokensPerMessage + exports.BaseTokensPerName;
        for (const part of text.content) {
            if (part instanceof vscode.LanguageModelTextPart) {
                totalTokens += await textTokenLength(part.value);
            }
            else if (part instanceof vscode.LanguageModelDataPart) {
                if (part.mimeType.startsWith("image/")) {
                    totalTokens += calculateImageTokenCost((0, utils_1.createDataUrl)(part));
                }
                else if (part.mimeType === "cache_control") {
                    /* ignore */
                }
                else {
                    totalTokens += calculateNonImageBinaryTokens(part.data.byteLength);
                }
            }
            else if (part instanceof vscode.LanguageModelToolCallPart) {
                totalTokens += exports.BaseTokensPerName;
                totalTokens += await textTokenLength(JSON.stringify(part.input));
            }
            else if (part instanceof vscode.LanguageModelToolResultPart) {
                totalTokens += await textTokenLength(JSON.stringify(part.content));
            }
            else if (part instanceof vscode.LanguageModelThinkingPart) {
                if (modelConfig.includeReasoningInRequest) {
                    const thinkingText = Array.isArray(part.value) ? part.value.join("") : part.value;
                    totalTokens += await textTokenLength(thinkingText);
                }
            }
            else {
                console.warn(`Unknown part type: ${JSON.stringify(part)}`);
            }
        }
        return totalTokens;
    }
}
async function textTokenLength(text) {
    try {
        return tokenizerManager_1.tokenizerManager.countTokens(text);
    }
    catch {
        return 0;
    }
}
async function countToolTokens(tools) {
    const baseToolTokens = 16;
    let numTokens = 0;
    if (tools.length) {
        numTokens += baseToolTokens;
    }
    const baseTokensPerTool = 8;
    for (const tool of tools) {
        numTokens += baseTokensPerTool;
        numTokens += await textTokenLength(JSON.stringify(tool));
    }
    return numTokens;
}
/**
 * Calculate token cost for an image based on its dimensions.
 */
function calculateImageTokenCost(dataUrl) {
    try {
        const { width, height } = (0, imageUtils_1.getImageDimensions)(dataUrl);
        // Default: 170 tokens per 512px tile
        const tileSize = 512;
        const tilesX = Math.ceil(width / tileSize);
        const tilesY = Math.ceil(height / tileSize);
        const totalTiles = tilesX * tilesY;
        // Base cost: 85 tokens, plus 170 per tile
        return 85 + 170 * totalTiles;
    }
    catch {
        // Fallback: estimate based on base64 length
        const base64Length = dataUrl.length;
        return Math.ceil(base64Length / 100);
    }
}
/**
 * Calculate token cost for non-image binary data.
 */
function calculateNonImageBinaryTokens(byteLength) {
    // Rough estimate: ~0.75 tokens per byte for binary data
    return Math.ceil(byteLength * 0.75);
}
//# sourceMappingURL=provideToken.js.map