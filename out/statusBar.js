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
exports.initStatusBar = initStatusBar;
exports.formatTokenCount = formatTokenCount;
exports.updateContextStatusBar = updateContextStatusBar;
exports.updateStatusBarWithApiPrompt = updateStatusBarWithApiPrompt;
exports.recordUsage = recordUsage;
exports.updateCumulativeTooltip = updateCumulativeTooltip;
const vscode = __importStar(require("vscode"));
const provideToken_1 = require("./provideToken");
const localize_1 = require("./localize");
const logger_1 = require("./logger");
// CommandCode does not expose a plan-usage endpoint in its Provider API, so
// the status bar is intentionally limited to request/token telemetry returned
// by the API itself.
let cumulativeInputTokens = 0;
let cumulativeOutputTokens = 0;
let cumulativeCacheHitTokens = 0;
let cumulativeCacheMissTokens = 0;
const TOKEN_INDICATOR_SETTING = "commandcode.enableThirdPartyTokenIndicator";
function isTokenIndicatorEnabled() {
    return vscode.workspace.getConfiguration().get(TOKEN_INDICATOR_SETTING, true);
}
function applyStatusBarVisibility(item, resetOnShow = false) {
    if (isTokenIndicatorEnabled()) {
        if (resetOnShow) {
            resetCumulativeCounters();
            updateCumulativeTooltip(item);
        }
        item.show();
    }
    else {
        item.hide();
    }
}
function initStatusBar(context) {
    resetCumulativeCounters();
    const item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
    item.name = (0, localize_1.l10n)("Token Usage");
    item.text = "$(symbol-numeric) CommandCode";
    updateCumulativeTooltip(item);
    context.subscriptions.push(item);
    applyStatusBarVisibility(item);
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (event.affectsConfiguration(TOKEN_INDICATOR_SETTING)) {
            applyStatusBarVisibility(item, isTokenIndicatorEnabled());
        }
    }));
    logger_1.logger.debug("statusBar.init", { provider: "commandcode" });
    return item;
}
function formatTokenCount(value) {
    if (value >= 1_000_000_000)
        return (value / 1_000_000_000).toFixed(1) + "B";
    if (value >= 1_000_000)
        return (value / 1_000_000).toFixed(1) + "M";
    if (value >= 1_000)
        return (value / 1_000).toFixed(1) + "K";
    return value.toLocaleString();
}
function updateStatusBarText(item) {
    item.text = "$(symbol-numeric) CommandCode";
}
async function updateContextStatusBar(messages, tools, statusBarItem, modelConfig) {
    try {
        const assistantRole = vscode.LanguageModelChatMessageRole.Assistant;
        if (!messages.some((message) => message.role === assistantRole)) {
            resetCumulativeCounters();
        }
        let totalTokens = 0;
        for (const message of messages) {
            totalTokens += await (0, provideToken_1.countMessageTokens)(message, modelConfig);
        }
        if (tools && tools.length > 0) {
            totalTokens += await (0, provideToken_1.countToolTokens)(tools);
        }
        updateStatusBarText(statusBarItem);
        updateCumulativeTooltip(statusBarItem);
        return totalTokens;
    }
    catch {
        updateStatusBarText(statusBarItem);
        return 0;
    }
}
function updateStatusBarWithApiPrompt(statusBarItem) {
    updateStatusBarText(statusBarItem);
    updateCumulativeTooltip(statusBarItem);
}
function resetCumulativeCounters() {
    cumulativeInputTokens = 0;
    cumulativeOutputTokens = 0;
    cumulativeCacheHitTokens = 0;
    cumulativeCacheMissTokens = 0;
}
function recordUsage(usage) {
    cumulativeInputTokens += usage.promptTokens;
    cumulativeOutputTokens += usage.completionTokens;
    if (usage.cacheHitTokens !== undefined)
        cumulativeCacheHitTokens += usage.cacheHitTokens;
    if (usage.cacheMissTokens !== undefined)
        cumulativeCacheMissTokens += usage.cacheMissTokens;
}
function updateCumulativeTooltip(statusBarItem) {
    const lines = [];
    let inputLine = `${(0, localize_1.l10n)("Input")}: ${formatTokenCount(cumulativeInputTokens)}`;
    if (cumulativeCacheHitTokens > 0 || cumulativeCacheMissTokens > 0) {
        const totalCache = cumulativeCacheHitTokens + cumulativeCacheMissTokens;
        const hitRate = totalCache > 0 ? Math.round((cumulativeCacheHitTokens / totalCache) * 100) : 0;
        inputLine += ` ${(0, localize_1.l10nFormat)("({0} cached, {1}%)", formatTokenCount(cumulativeCacheHitTokens), hitRate)}`;
    }
    lines.push(inputLine);
    lines.push(`${(0, localize_1.l10n)("Output")}: ${formatTokenCount(cumulativeOutputTokens)}`);
    statusBarItem.tooltip = lines.join("\n");
}
//# sourceMappingURL=statusBar.js.map