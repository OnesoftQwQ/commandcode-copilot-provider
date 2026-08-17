import * as vscode from "vscode";
import { LanguageModelChatRequestMessage, LanguageModelChatTool } from "vscode";
import { countMessageTokens, countToolTokens } from "./provideToken";
import { l10n, l10nFormat } from "./localize";
import { logger } from "./logger";
import type { StreamUsage } from "./commonApi";

// CommandCode does not expose a plan-usage endpoint in its Provider API, so
// the status bar is intentionally limited to request/token telemetry returned
// by the API itself.
let cumulativeInputTokens = 0;
let cumulativeOutputTokens = 0;
let cumulativeCacheHitTokens = 0;
let cumulativeCacheMissTokens = 0;

export function initStatusBar(context: vscode.ExtensionContext, _secrets: vscode.SecretStorage): vscode.StatusBarItem {
    void _secrets;
    resetCumulativeCounters();

    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    item.name = l10n("Token Usage");
    item.text = "$(symbol-numeric) CommandCode";
    item.tooltip = l10n("Token usage");
    context.subscriptions.push(item);
    item.show();
    logger.debug("statusBar.init", { provider: "commandcode" });
    return item;
}

export function formatTokenCount(value: number): string {
    if (value >= 1_000_000_000) return (value / 1_000_000_000).toFixed(1) + "B";
    if (value >= 1_000_000) return (value / 1_000_000).toFixed(1) + "M";
    if (value >= 1_000) return (value / 1_000).toFixed(1) + "K";
    return value.toLocaleString();
}

function updateStatusBarText(item: vscode.StatusBarItem): void {
    item.text = "$(symbol-numeric) CommandCode";
}

export async function updateContextStatusBar(
    messages: readonly LanguageModelChatRequestMessage[],
    tools: readonly LanguageModelChatTool[] | undefined,
    statusBarItem: vscode.StatusBarItem,
    modelConfig: { includeReasoningInRequest: boolean },
): Promise<number> {
    try {
        const assistantRole = vscode.LanguageModelChatMessageRole.Assistant as unknown as number;
        if (!messages.some((message) => (message.role as unknown as number) === assistantRole)) {
            resetCumulativeCounters();
        }

        let totalTokens = 0;
        for (const message of messages) {
            totalTokens += await countMessageTokens(message, modelConfig);
        }
        if (tools && tools.length > 0) {
            totalTokens += await countToolTokens(tools);
        }
        updateStatusBarText(statusBarItem);
        updateCumulativeTooltip(statusBarItem);
        return totalTokens;
    } catch {
        updateStatusBarText(statusBarItem);
        return 0;
    }
}

export function updateStatusBarWithApiPrompt(statusBarItem: vscode.StatusBarItem): void {
    updateStatusBarText(statusBarItem);
    updateCumulativeTooltip(statusBarItem);
}

function resetCumulativeCounters(): void {
    cumulativeInputTokens = 0;
    cumulativeOutputTokens = 0;
    cumulativeCacheHitTokens = 0;
    cumulativeCacheMissTokens = 0;
}

export function recordUsage(usage: StreamUsage): void {
    cumulativeInputTokens += usage.promptTokens;
    cumulativeOutputTokens += usage.completionTokens;
    if (usage.cacheHitTokens !== undefined) cumulativeCacheHitTokens += usage.cacheHitTokens;
    if (usage.cacheMissTokens !== undefined) cumulativeCacheMissTokens += usage.cacheMissTokens;
}

export function updateCumulativeTooltip(statusBarItem: vscode.StatusBarItem): void {
    const lines: string[] = [];
    let inputLine = `↑ ${formatTokenCount(cumulativeInputTokens)}`;
    if (cumulativeCacheHitTokens > 0 || cumulativeCacheMissTokens > 0) {
        const totalCache = cumulativeCacheHitTokens + cumulativeCacheMissTokens;
        const hitRate = totalCache > 0 ? Math.round((cumulativeCacheHitTokens / totalCache) * 100) : 0;
        inputLine += ` ${l10nFormat("({0} cached, {1}%)", formatTokenCount(cumulativeCacheHitTokens), hitRate)}`;
    }
    lines.push(inputLine);
    lines.push(`↓ ${formatTokenCount(cumulativeOutputTokens)}`);
    statusBarItem.tooltip = lines.join("\n");
}
