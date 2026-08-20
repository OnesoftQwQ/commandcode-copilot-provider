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
exports.resetAutoDiscoveryState = resetAutoDiscoveryState;
exports.forceRefreshLanguageModelChatInformation = forceRefreshLanguageModelChatInformation;
exports.prepareLanguageModelChatInformation = prepareLanguageModelChatInformation;
const vscode = __importStar(require("vscode"));
const logger_1 = require("./logger");
const apiModelList_1 = require("./apiModelList");
const modelsDev_1 = require("./modelsDev");
const catalogModels_1 = require("./catalogModels");
const utils_1 = require("./utils");
const COMMANDCODE_PROVIDER_ID = "commandcode";
// Used before an API key is configured, and as a graceful fallback if the
// live /models endpoint is temporarily unavailable. Once a key is available,
// the live list replaces this list automatically.
const DEFAULT_COMMANDCODE_MODEL_IDS = [
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-v4-pro",
    "claude-sonnet-5",
    "claude-opus-5",
    "claude-haiku-4-5",
    "gpt-5.6-luna",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.5",
    "gpt-5.4-mini",
    "gpt-5.3-codex",
    "Qwen/Qwen3.7-Max",
    "Qwen/Qwen3.7-Plus",
    "Qwen/Qwen3.7-Flash",
    "Qwen/Qwen3.8-Max",
    "MiniMaxAI/MiniMax-M3",
    "MiniMaxAI/MiniMax-M2.7",
    "MiniMaxAI/MiniMax-M2.5",
    "moonshotai/Kimi-K3",
    "moonshotai/Kimi-K2.7-Code",
    "moonshotai/Kimi-K2.7-Code-Highspeed",
    "moonshotai/Kimi-K2.6",
    "poolside/laguna-s-2.1-free",
];
let isUpdatingModels = false;
let lastModelsUpdate = 0;
let cachedModelInfos = null;
let lastRefreshResult = null;
let forcedRefreshQueue = Promise.resolve();
async function runModelPass(secrets, token) {
    // Metadata is optional. Loading it improves names, limits, vision flags,
    // and reasoning controls, but never prevents the provider from working.
    await (0, modelsDev_1.ensureModelsDevLoaded)();
    const config = vscode.workspace.getConfiguration("commandcode");
    const enableAutoDiscovery = config.get("enableAutoModelDiscovery", true);
    let modelIds = [...DEFAULT_COMMANDCODE_MODEL_IDS];
    let modelSource = "fallback";
    let status = "auto-discovery-disabled";
    let refreshError;
    if (enableAutoDiscovery) {
        const apiKey = await secrets.get("commandcode.apiKey");
        const abortController = new AbortController();
        const cancellation = token.onCancellationRequested(() => abortController.abort());
        const apiResult = await (0, apiModelList_1.getApiModelIds)(apiKey, abortController.signal).finally(() => cancellation.dispose());
        refreshError = apiResult.error;
        if (apiResult.ids.size > 0) {
            modelIds = [...apiResult.ids];
            modelSource = "api";
        }
        switch (apiResult.status) {
            case "success":
                status = apiResult.ids.size > 0 ? "api" : "api-empty";
                break;
            case "cached":
                status = "cached";
                break;
            case "stale":
                status = "stale";
                break;
            case "missing-key":
                status = "missing-api-key";
                break;
            case "error":
                status = "api-error";
                break;
        }
    }
    const showDeprecated = config.get("showDeprecatedModels", false);
    const uniqueIds = [...new Set(modelIds)];
    const infos = uniqueIds
        .filter((id) => showDeprecated || !(0, catalogModels_1.isModelDeprecated)(COMMANDCODE_PROVIDER_ID, id))
        .map((id) => (0, catalogModels_1.buildCatalogModelInfo)(COMMANDCODE_PROVIDER_ID, id));
    logger_1.logger.info("models.discovery", {
        action: "commandcode_loaded",
        count: infos.length,
        source: modelSource,
        ids: infos.map((info) => info.id).join(", "),
    });
    return { models: infos, status, error: refreshError };
}
async function waitForPendingUpdate(token) {
    while (isUpdatingModels && !token.isCancellationRequested) {
        await (0, utils_1.delay)(200, token);
    }
}
function resetAutoDiscoveryState() {
    lastModelsUpdate = 0;
    cachedModelInfos = null;
    lastRefreshResult = null;
    (0, apiModelList_1.clearApiModelCache)();
    (0, modelsDev_1.clearModelsDevCache)();
    logger_1.logger.info("models.discovery", { action: "reset" });
}
async function updateModelCache(token, secrets) {
    isUpdatingModels = true;
    try {
        const result = await runModelPass(secrets, token);
        if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        cachedModelInfos = result.models;
        lastRefreshResult = result;
        lastModelsUpdate = Date.now();
        return result;
    }
    catch (error) {
        logger_1.logger.error("models.discovery", {
            action: "error",
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    }
    finally {
        isUpdatingModels = false;
    }
}
async function forceRefreshLanguageModelChatInformation(token, secrets) {
    const refresh = forcedRefreshQueue.then(async () => {
        if (isUpdatingModels) {
            await waitForPendingUpdate(token);
        }
        if (token.isCancellationRequested) {
            throw new vscode.CancellationError();
        }
        resetAutoDiscoveryState();
        return updateModelCache(token, secrets);
    });
    forcedRefreshQueue = refresh.then(() => undefined, () => undefined);
    return refresh;
}
async function prepareLanguageModelChatInformation(_options, token, secrets) {
    if (token.isCancellationRequested) {
        return cachedModelInfos ?? [];
    }
    const updateInterval = vscode.workspace.getConfiguration("commandcode")
        .get("modelsDevUpdateInterval", 60 * 1000);
    while (Date.now() - lastModelsUpdate >= updateInterval) {
        if (token.isCancellationRequested) {
            return cachedModelInfos ?? [];
        }
        if (isUpdatingModels) {
            await waitForPendingUpdate(token);
            continue;
        }
        try {
            await updateModelCache(token, secrets);
        }
        catch (error) {
            if (error instanceof vscode.CancellationError) {
                return cachedModelInfos ?? [];
            }
            return cachedModelInfos ?? lastRefreshResult?.models ?? [];
        }
    }
    return cachedModelInfos ?? [];
}
//# sourceMappingURL=provideModel.js.map