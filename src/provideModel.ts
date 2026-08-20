import * as vscode from "vscode";
import { CancellationToken, LanguageModelChatInformation, PrepareLanguageModelChatModelOptions } from "vscode";

import { logger } from "./logger";
import { getApiModelIds, clearApiModelCache } from "./apiModelList";
import { ensureModelsDevLoaded, clearModelsDevCache } from "./modelsDev";
import { buildCatalogModelInfo, isModelDeprecated } from "./catalogModels";
import { delay } from "./utils";

const COMMANDCODE_PROVIDER_ID = "commandcode" as const;

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
] as const;

let isUpdatingModels = false;
let lastModelsUpdate = 0;
let cachedModelInfos: LanguageModelChatInformation[] | null = null;
let lastRefreshResult: ModelRefreshResult | null = null;
let forcedRefreshQueue: Promise<void> = Promise.resolve();

export type ModelRefreshStatus =
    | "api"
    | "cached"
    | "stale"
    | "missing-api-key"
    | "auto-discovery-disabled"
    | "api-empty"
    | "api-error";

export interface ModelRefreshResult {
    models: LanguageModelChatInformation[];
    status: ModelRefreshStatus;
    error?: string;
}

async function runModelPass(secrets: vscode.SecretStorage, token: CancellationToken): Promise<ModelRefreshResult> {
    // Metadata is optional. Loading it improves names, limits, vision flags,
    // and reasoning controls, but never prevents the provider from working.
    await ensureModelsDevLoaded();

    const config = vscode.workspace.getConfiguration("commandcode");
    const enableAutoDiscovery = config.get<boolean>("enableAutoModelDiscovery", true);
    let modelIds: string[] = [...DEFAULT_COMMANDCODE_MODEL_IDS];
    let modelSource = "fallback";
    let status: ModelRefreshStatus = "auto-discovery-disabled";
    let refreshError: string | undefined;

    if (enableAutoDiscovery) {
        const apiKey = await secrets.get("commandcode.apiKey");
        const abortController = new AbortController();
        const cancellation = token.onCancellationRequested(() => abortController.abort());
        const apiResult = await getApiModelIds(apiKey, abortController.signal).finally(() => cancellation.dispose());
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

    const showDeprecated = config.get<boolean>("showDeprecatedModels", false);
    const uniqueIds = [...new Set(modelIds)];
    const infos = uniqueIds
        .filter((id) => showDeprecated || !isModelDeprecated(COMMANDCODE_PROVIDER_ID, id))
        .map((id) => buildCatalogModelInfo(COMMANDCODE_PROVIDER_ID, id));

    logger.info("models.discovery", {
        action: "commandcode_loaded",
        count: infos.length,
        source: modelSource,
        ids: infos.map((info) => info.id).join(", "),
    });
    return { models: infos, status, error: refreshError };
}

async function waitForPendingUpdate(token: CancellationToken): Promise<void> {
    while (isUpdatingModels && !token.isCancellationRequested) {
        await delay(200, token);
    }
}

export function resetAutoDiscoveryState(): void {
    lastModelsUpdate = 0;
    cachedModelInfos = null;
    lastRefreshResult = null;
    clearApiModelCache();
    clearModelsDevCache();
    logger.info("models.discovery", { action: "reset" });
}

async function updateModelCache(token: CancellationToken, secrets: vscode.SecretStorage): Promise<ModelRefreshResult> {
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
    } catch (error) {
        logger.error("models.discovery", {
            action: "error",
            error: error instanceof Error ? error.message : String(error),
        });
        throw error;
    } finally {
        isUpdatingModels = false;
    }
}

export async function forceRefreshLanguageModelChatInformation(
    token: CancellationToken,
    secrets: vscode.SecretStorage,
): Promise<ModelRefreshResult> {
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

export async function prepareLanguageModelChatInformation(
    _options: PrepareLanguageModelChatModelOptions,
    token: CancellationToken,
    secrets: vscode.SecretStorage,
): Promise<LanguageModelChatInformation[]> {
    if (token.isCancellationRequested) {
        return cachedModelInfos ?? [];
    }

    const updateInterval = vscode.workspace.getConfiguration("commandcode")
        .get<number>("modelsDevUpdateInterval", 60 * 1000);
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
        } catch (error) {
            if (error instanceof vscode.CancellationError) {
                return cachedModelInfos ?? [];
            }
            return cachedModelInfos ?? lastRefreshResult?.models ?? [];
        }
    }

    return cachedModelInfos ?? [];
}
