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

async function runModelPass(secrets: vscode.SecretStorage): Promise<LanguageModelChatInformation[]> {
    // Metadata is optional. Loading it improves names, limits, vision flags,
    // and reasoning controls, but never prevents the provider from working.
    await ensureModelsDevLoaded();

    const config = vscode.workspace.getConfiguration("commandcode");
    const enableAutoDiscovery = config.get<boolean>("enableAutoModelDiscovery", true);
    let modelIds: string[] = [...DEFAULT_COMMANDCODE_MODEL_IDS];
    let modelSource = "fallback";

    if (enableAutoDiscovery) {
        const apiKey = await secrets.get("commandcode.apiKey");
        const liveIds = await getApiModelIds(apiKey);
        if (liveIds.size > 0) {
            modelIds = [...liveIds];
            modelSource = "api";
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
    return infos;
}

async function waitForPendingUpdate(token: CancellationToken): Promise<void> {
    while (isUpdatingModels && !token.isCancellationRequested) {
        await delay(200, token);
    }
}

export function resetAutoDiscoveryState(): void {
    isUpdatingModels = false;
    lastModelsUpdate = 0;
    cachedModelInfos = null;
    clearApiModelCache();
    clearModelsDevCache();
    logger.info("models.discovery", { action: "reset" });
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
    const now = Date.now();

    if (isUpdatingModels) {
        await waitForPendingUpdate(token);
    } else if (now - lastModelsUpdate >= updateInterval) {
        isUpdatingModels = true;
        try {
            cachedModelInfos = await runModelPass(secrets);
            lastModelsUpdate = Date.now();
        } catch (error) {
            logger.error("models.discovery", {
                action: "error",
                error: error instanceof Error ? error.message : String(error),
            });
        } finally {
            isUpdatingModels = false;
        }
    }

    return cachedModelInfos ?? [];
}
