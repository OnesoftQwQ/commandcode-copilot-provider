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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const provider_1 = require("./provider");
const statusBar_1 = require("./statusBar");
const logger_1 = require("./logger");
const localize_1 = require("./localize");
const versionManager_1 = require("./versionManager");
const commitMessageGenerator_1 = require("./gitCommit/commitMessageGenerator");
const tokenizerManager_1 = require("./tokenizer/tokenizerManager");
const provideModel_1 = require("./provideModel");
// ---- Walkthrough / Welcome constants ----
/** memento key tracking whether the welcome walkthrough has been shown. */
const WELCOME_SHOWN_KEY = "commandcode.welcomeShown";
/** Walkthrough contribution ID (publisher.extension#walkthroughId). */
const WALKTHROUGH_ID = "OnesoftQwQ.commandcode-copilot-provider#commandCodeGettingStarted";
function activate(context) {
    // Initialize logger
    logger_1.logger.init();
    logger_1.logger.info("extension.activate", { version: versionManager_1.VersionManager.getVersion() });
    // Management command to configure API key
    context.subscriptions.push(vscode.commands.registerCommand("commandcode.setApiKey", async () => {
        const existing = await context.secrets.get("commandcode.apiKey");
        const apiKey = await vscode.window.showInputBox({
            title: (0, localize_1.l10n)("CommandCode Provider API Key"),
            prompt: existing ? (0, localize_1.l10n)("Update your CommandCode API key") : (0, localize_1.l10n)("Enter your CommandCode API key"),
            ignoreFocusOut: true,
            password: true,
            value: existing ?? "",
        });
        if (apiKey === undefined) {
            return; // user canceled
        }
        if (!apiKey.trim()) {
            await context.secrets.delete("commandcode.apiKey");
            vscode.window.showInformationMessage((0, localize_1.l10n)("CommandCode API key cleared."));
            return;
        }
        await context.secrets.store("commandcode.apiKey", apiKey.trim());
        vscode.window.showInformationMessage((0, localize_1.l10n)("CommandCode API key saved."));
    }));
    // manually trigger model list update command
    context.subscriptions.push(vscode.commands.registerCommand("commandcode.updateModelList", async () => {
        try {
            // dummy silent option, not used
            (0, provideModel_1.resetAutoDiscoveryState)();
            await (0, provideModel_1.prepareLanguageModelChatInformation)({ silent: true }, new vscode.CancellationTokenSource().token, context.secrets);
            vscode.window.showInformationMessage((0, localize_1.l10n)("CommandCode model list updated successfully."));
        }
        catch (error) {
            logger_1.logger.error("models.update.failed", { error: String(error) });
            vscode.window.showErrorMessage((0, localize_1.l10n)("Failed to update CommandCode model list. See output for details."));
        }
    }));
    // Command to open the CommandCode website to get an API key
    context.subscriptions.push(vscode.commands.registerCommand("commandcode.getApiKey", () => {
        vscode.env.openExternal(vscode.Uri.parse("https://commandcode.ai"));
    }));
    // Command to open extension settings
    context.subscriptions.push(vscode.commands.registerCommand("commandcode.openSettings", () => {
        vscode.commands.executeCommand("workbench.action.openSettings", "@ext:OnesoftQwQ.commandcode-copilot-provider");
    }));
    // Register the generateGitCommitMessage command handler
    context.subscriptions.push(vscode.commands.registerCommand("commandcode.generateGitCommitMessage", async (scm) => {
        (0, commitMessageGenerator_1.generateCommitMsg)(context.secrets, scm);
    }), vscode.commands.registerCommand("commandcode.abortGitCommitMessage", () => {
        (0, commitMessageGenerator_1.abortCommitGeneration)();
    }));
    // Register the setModelPreset command: user can select a preset via QuickPick
    context.subscriptions.push(vscode.commands.registerCommand("commandcode.setModelPreset", async () => {
        const config = vscode.workspace.getConfiguration();
        const presets = config.get("commandcode.modelPresets", []);
        const currentPresetId = config.get("commandcode.modelPreset", "custom");
        const currentTemp = config.get("commandcode.temperature", null);
        const currentTopP = config.get("commandcode.top_p", null);
        // Mark the currently active preset with " (当前)"
        const presetItems = presets.map((p) => ({
            label: `${(0, localize_1.l10n)(p.label)} (${p.temperature})${p.id === currentPresetId ? (0, localize_1.l10n)(" (current)") : ""}`,
            presetId: p.id,
        }));
        // Mark custom option with current values if active
        const isCustomActive = currentPresetId === "custom";
        const customLabel = "$(pencil) " + (0, localize_1.l10n)("Custom (manual input)")
            + (isCustomActive
                ? ` ${(0, localize_1.l10nFormat)("(current, temperature: {0}, top_p: {1})", String(currentTemp ?? "—"), String(currentTopP ?? "—"))}`
                : "");
        const customItem = {
            label: customLabel,
        };
        const items = [
            ...presetItems,
            { label: "", kind: vscode.QuickPickItemKind.Separator },
            customItem,
        ];
        const title = (0, localize_1.l10n)("Set Model Preset");
        const picked = await vscode.window.showQuickPick(items, {
            title,
            placeHolder: (0, localize_1.l10n)("Select a preset"),
            ignoreFocusOut: true,
        });
        if (!picked) {
            return;
        }
        const presetId = picked.presetId;
        if (presetId) {
            // User selected a named preset
            const matchedPreset = presets.find((p) => p.id === presetId);
            if (matchedPreset) {
                await config.update("commandcode.modelPreset", matchedPreset.id, vscode.ConfigurationTarget.Global);
                await config.update("commandcode.temperature", matchedPreset.temperature, vscode.ConfigurationTarget.Global);
                vscode.window.showInformationMessage((0, localize_1.l10nFormat)("Set to temperature: {0} ({1})", String(matchedPreset.temperature), (0, localize_1.l10n)(matchedPreset.label)));
            }
        }
        else {
            // User chose "Custom (manual input)"
            const currentVal = currentTemp !== null && currentTopP !== null
                ? `${currentTemp},${currentTopP}`
                : "";
            const inputValue = await vscode.window.showInputBox({
                title: (0, localize_1.l10n)("Enter custom temperature"),
                prompt: (0, localize_1.l10n)("Enter a single number for temperature only (<=2), or two comma-separated numbers for temperature and top_p (temp<=2, top_p<=1), e.g.: 0.7 or 0.7,0.95"),
                value: currentVal,
                validateInput: (val) => {
                    const trimmed = val.trim();
                    if (!trimmed) {
                        return (0, localize_1.l10n)("Please enter at least temperature value");
                    }
                    const parts = trimmed.split(",");
                    if (parts.length > 2) {
                        return (0, localize_1.l10n)("Please enter at most two numbers separated by a comma");
                    }
                    const temp = parseFloat(parts[0].trim());
                    if (isNaN(temp) || temp < 0 || temp > 2) {
                        return (0, localize_1.l10n)("Temperature must be between 0.0 and 2.0");
                    }
                    if (parts.length === 2) {
                        const topP = parseFloat(parts[1].trim());
                        if (isNaN(topP) || topP < 0 || topP > 1) {
                            return (0, localize_1.l10n)("top_p must be between 0.0 and 1.0");
                        }
                    }
                    return null;
                },
                ignoreFocusOut: true,
            });
            if (inputValue !== undefined) {
                const trimmed = inputValue.trim();
                const parts = trimmed.split(",");
                const tempNum = parseFloat(parts[0].trim());
                await config.update("commandcode.modelPreset", "custom", vscode.ConfigurationTarget.Global);
                await config.update("commandcode.temperature", tempNum, vscode.ConfigurationTarget.Global);
                if (parts.length === 2) {
                    const topPNum = parseFloat(parts[1].trim());
                    await config.update("commandcode.top_p", topPNum, vscode.ConfigurationTarget.Global);
                    vscode.window.showInformationMessage((0, localize_1.l10nFormat)("Set to temp: {0}, top_p: {1} (custom)", String(tempNum), String(topPNum)));
                }
                else {
                    vscode.window.showInformationMessage((0, localize_1.l10nFormat)("Set to temperature: {0} (custom)", String(tempNum)));
                }
            }
        }
    }));
    // Register the provider after management commands. Provider activation can fail
    // on older VS Code builds or when another extension already owns the vendor id;
    // the API-key command must remain available in either case.
    try {
        tokenizerManager_1.TokenizerManager.initialize(context.extensionPath);
        const tokenCountStatusBarItem = (0, statusBar_1.initStatusBar)(context, context.secrets);
        const provider = new provider_1.CommandCodeChatModelProvider(context.secrets, tokenCountStatusBarItem);
        if (typeof vscode.lm?.registerLanguageModelChatProvider !== "function") {
            throw new Error("VS Code language model provider API is unavailable");
        }
        const registration = vscode.lm.registerLanguageModelChatProvider("commandcode", provider);
        context.subscriptions.push(registration);
    }
    catch (error) {
        logger_1.logger.error("provider.registration.failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    }
    // Warm up model discovery on every activation (non-blocking, fire-and-forget).
    // VS Code may fire several activation events at startup; the short refresh
    // interval in prepareLanguageModelChatInformation (default 1 minute) dedupes
    // concurrent calls so the API is not spammed. The models.dev catalog is
    // fetched before the model list. On failure it degrades silently to the
    // built-in model list.
    void (0, provideModel_1.prepareLanguageModelChatInformation)({ silent: true }, new vscode.CancellationTokenSource().token, context.secrets).catch((error) => {
        logger_1.logger.error("models.warmup.failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    });
    // Show welcome walkthrough on first install (when no API key is configured)
    showWelcomeIfNeeded(context);
    // Dispose logger on deactivate
    context.subscriptions.push({
        dispose: () => logger_1.logger.dispose(),
    });
}
/**
 * Show the welcome walkthrough on first activation if no API key is configured.
 * Once shown (or if a key already exists) the flag is persisted so it won't
 * reappear after subsequent reloads.
 */
async function showWelcomeIfNeeded(context) {
    try {
        if (context.globalState.get(WELCOME_SHOWN_KEY)) {
            return;
        }
        const apiKey = await context.secrets.get("commandcode.apiKey");
        if (apiKey) {
            // API key already set — no need to show welcome
            await context.globalState.update(WELCOME_SHOWN_KEY, true);
            return;
        }
        await vscode.commands.executeCommand("workbench.action.openWalkthrough", WALKTHROUGH_ID, false);
        await context.globalState.update(WELCOME_SHOWN_KEY, true);
    }
    catch (error) {
        logger_1.logger.warn("Failed to show welcome walkthrough", { error: String(error) });
    }
}
function deactivate() { }
//# sourceMappingURL=extension.js.map