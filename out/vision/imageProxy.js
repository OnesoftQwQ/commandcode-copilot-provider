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
exports.callVisionModel = callVisionModel;
exports.callVisionModelMulti = callVisionModelMulti;
const vscode = __importStar(require("vscode"));
const types_1 = require("./types");
/**
 * Build a standard set of request options for vision model calls.
 */
function buildVisionOptions() {
    const options = {};
    const visionThinking = vscode.workspace.getConfiguration().get("commandcode.visionProxyThinking", false);
    if (visionThinking) {
        options.modelOptions = { reasoning_effort: "high" };
    }
    else {
        options.modelOptions = {
            reasoning_effort: "disabled",
            thinking: { type: "disabled" },
        };
    }
    return options;
}
/**
 * Send a message to a vision model, stream output via progress, and return the full text.
 * progress.onThinking is called for thinking/reasoning chunks, progress.onText for text chunks.
 */
async function sendToVisionModel(msg, visionModelId, token, progress) {
    const models = await vscode.lm.selectChatModels({ id: visionModelId });
    if (!models || models.length === 0) {
        throw new Error(`Vision model "${visionModelId}" not found. Check the commandcode.visionProxyModel setting.`);
    }
    const visionModel = models[0];
    const response = await visionModel.sendRequest([msg], buildVisionOptions(), token);
    let result = "";
    for await (const chunk of response.stream) {
        if (chunk instanceof vscode.LanguageModelThinkingPart) {
            const text = Array.isArray(chunk.value) ? chunk.value.join("") : chunk.value;
            if (text) {
                progress?.onThinking?.(text);
            }
        }
        else if (chunk instanceof vscode.LanguageModelTextPart) {
            result += chunk.value;
            progress?.onText?.(chunk.value);
        }
    }
    return result.trim();
}
/**
 * Call a vision-capable model to answer a question about a single image.
 * Streams the output via progress if provided.
 * @param query The specific question to ask about the image.
 * @returns The answer text from the vision model.
 */
async function callVisionModel(imageData, mimeType, visionModelId, query, token, progress) {
    const dataPart = new vscode.LanguageModelDataPart(imageData, mimeType);
    const prompt = query ?? types_1.DEFAULT_VISION_PROMPT;
    const textPart = new vscode.LanguageModelTextPart(prompt);
    const msg = new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, [dataPart, textPart]);
    return sendToVisionModel(msg, visionModelId, token, progress);
}
/**
 * Call a vision-capable model to answer a question about MULTIPLE images.
 * Sends all images + query in a single message so the model can compare them.
 * Streams the output via progress if provided.
 * @param images Array of { data, mimeType } for each image.
 * @param query The comparison/analysis question.
 * @returns The answer text from the vision model.
 */
async function callVisionModelMulti(images, visionModelId, query, token, progress) {
    const prompt = query ?? "Compare and analyze these images. What do you see?";
    const parts = [];
    for (const img of images) {
        parts.push(new vscode.LanguageModelDataPart(img.data, img.mimeType));
    }
    parts.push(new vscode.LanguageModelTextPart(prompt));
    const msg = new vscode.LanguageModelChatMessage(vscode.LanguageModelChatMessageRole.User, parts);
    return sendToVisionModel(msg, visionModelId, token, progress);
}
//# sourceMappingURL=imageProxy.js.map