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
const modelPreset_1 = require("./modelPreset");
// ---- Walkthrough / Welcome constants ----
/** memento key tracking whether the welcome walkthrough has been shown. */
const WELCOME_SHOWN_KEY = "commandcode.welcomeShown";
/** Walkthrough contribution ID (publisher.extension#walkthroughId). */
const WALKTHROUGH_ID = "OnesoftQwQ.commandcode-copilot-provider#commandCodeGettingStarted";
function activate(context) {
    // Initialize logger
    logger_1.logger.init();
    logger_1.logger.info("extension.activate", { version: versionManager_1.VersionManager.getVersion() });
    // Initialize TokenizerManager with extension path
    tokenizerManager_1.TokenizerManager.initialize(context.extensionPath);
    const tokenCountStatusBarItem = (0, statusBar_1.initStatusBar)(context);
    const provider = new provider_1.CommandCodeChatModelProvider(context.secrets, tokenCountStatusBarItem);
    // Register the CommandCode provider under the vendor id used in package.json
    context.subscriptions.push(vscode.lm.registerLanguageModelChatProvider("commandcode", provider), provider);
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
            await refreshModels(provider, false);
            return;
        }
        await context.secrets.store("commandcode.apiKey", apiKey.trim());
        vscode.window.showInformationMessage((0, localize_1.l10n)("CommandCode API key saved."));
        await refreshModels(provider, false);
    }));
    // manually trigger model list update command
    context.subscriptions.push(vscode.commands.registerCommand("commandcode.updateModelList", async () => {
        try {
            await refreshModels(provider, true);
        }
        catch (error) {
            if (error instanceof vscode.CancellationError) {
                vscode.window.showInformationMessage((0, localize_1.l10n)("CommandCode model list refresh canceled."));
                return;
            }
            logger_1.logger.error("models.update.failed", { error: String(error) });
            vscode.window.showErrorMessage((0, localize_1.l10n)("Failed to update CommandCode model list. See output for details."));
        }
    }));
    // Command to open the CommandCode website to get an API key
    context.subscriptions.push(vscode.commands.registerCommand("commandcode.getApiKey", async () => {
        await vscode.env.openExternal(vscode.Uri.parse("https://commandcode.ai"));
    }));
    // Command to open extension settings
    context.subscriptions.push(vscode.commands.registerCommand("commandcode.openSettings", async () => {
        await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:OnesoftQwQ.commandcode-copilot-provider");
    }));
    // Register the generateGitCommitMessage command handler
    context.subscriptions.push(vscode.commands.registerCommand("commandcode.generateGitCommitMessage", async (scm) => {
        await (0, commitMessageGenerator_1.generateCommitMsg)(context.secrets, scm, () => {
            const refreshTokenSource = new vscode.CancellationTokenSource();
            void provider.refreshLanguageModels(refreshTokenSource.token)
                .catch((error) => logger_1.logger.error("models.apiKeyRefresh.failed", { error: String(error) }))
                .finally(() => refreshTokenSource.dispose());
        });
    }), vscode.commands.registerCommand("commandcode.abortGitCommitMessage", () => {
        (0, commitMessageGenerator_1.abortCommitGeneration)();
    }));
    // Register the setModelPreset command: user can select a preset via QuickPick
    context.subscriptions.push(vscode.commands.registerCommand("commandcode.setModelPreset", async () => {
        const resource = vscode.window.activeTextEditor?.document.uri;
        const config = vscode.workspace.getConfiguration("commandcode", resource);
        const presets = config.get("modelPresets", []);
        const currentPresetId = config.get("modelPreset", "custom");
        const currentTemp = config.get("temperature", null);
        const currentTopP = config.get("top_p", null);
        // Mark the currently active preset with " (当前)"
        const presetItems = presets
            .filter((preset) => preset.id.trim() && Number.isFinite(preset.temperature))
            .map((preset) => ({
            label: `${(0, localize_1.l10n)(preset.label)} (${(0, localize_1.l10nFormat)(preset.top_p === undefined ? "temperature: {0}" : "temperature: {0}, top_p: {1}", preset.temperature, ...(preset.top_p === undefined ? [] : [preset.top_p]))})${preset.id === currentPresetId ? (0, localize_1.l10n)(" (current)") : ""}`,
            action: { kind: "preset", preset },
        }));
        // Mark custom option with current values if active
        const isCustomActive = currentPresetId === "custom";
        const customLabel = "$(pencil) " + (0, localize_1.l10n)("Custom (manual input)")
            + (isCustomActive
                ? ` ${(0, localize_1.l10nFormat)("(current, temperature: {0}, top_p: {1})", String(currentTemp ?? "—"), String(currentTopP ?? "—"))}`
                : "");
        const customItem = {
            label: customLabel,
            action: { kind: "custom" },
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
        if (picked.action?.kind === "preset") {
            // User selected a named preset
            const matchedPreset = picked.action.preset;
            await config.update("modelPreset", matchedPreset.id, getConfigurationTarget(config, "modelPreset"));
            vscode.window.showInformationMessage(matchedPreset.top_p === undefined
                ? (0, localize_1.l10nFormat)("Set to temperature: {0} ({1})", matchedPreset.temperature, (0, localize_1.l10n)(matchedPreset.label))
                : (0, localize_1.l10nFormat)("Set to temp: {0}, top_p: {1} ({2})", matchedPreset.temperature, matchedPreset.top_p, (0, localize_1.l10n)(matchedPreset.label)));
        }
        else if (picked.action?.kind === "custom") {
            // User chose "Custom (manual input)"
            const inputValue = await vscode.window.showInputBox({
                title: (0, localize_1.l10n)("Enter custom temperature"),
                prompt: (0, localize_1.l10n)("Enter a single number for temperature only (<=2), or two comma-separated numbers for temperature and top_p (temp<=2, top_p<=1), e.g.: 0.7 or 0.7,0.95"),
                value: (0, modelPreset_1.formatCustomPresetInput)(currentTemp, currentTopP),
                validateInput: (val) => {
                    const parsed = (0, modelPreset_1.parseCustomPresetInput)(val);
                    return parsed.error ? (0, localize_1.l10n)(parsed.error) : null;
                },
                ignoreFocusOut: true,
            });
            if (inputValue !== undefined) {
                const parsed = (0, modelPreset_1.parseCustomPresetInput)(inputValue);
                if (!parsed.value) {
                    return;
                }
                await config.update("modelPreset", "custom", getConfigurationTarget(config, "modelPreset"));
                await config.update("temperature", parsed.value.temperature, getConfigurationTarget(config, "temperature"));
                await config.update("top_p", parsed.value.topP ?? null, getConfigurationTarget(config, "top_p"));
                if (parsed.value.topP !== undefined) {
                    vscode.window.showInformationMessage((0, localize_1.l10nFormat)("Set to temp: {0}, top_p: {1} (custom)", parsed.value.temperature, parsed.value.topP));
                }
                else {
                    vscode.window.showInformationMessage((0, localize_1.l10nFormat)("Set to temperature: {0} (custom)", parsed.value.temperature));
                }
            }
        }
    }));
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
    const modelDiscoverySettings = [
        "commandcode.enableAutoModelDiscovery",
        "commandcode.showDeprecatedModels",
        "commandcode.modelsDevMirrorUrl",
        "commandcode.modelsDevMirrorToken",
    ];
    let settingsRefreshTokenSource;
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (!modelDiscoverySettings.some((key) => event.affectsConfiguration(key))) {
            return;
        }
        settingsRefreshTokenSource?.cancel();
        settingsRefreshTokenSource?.dispose();
        settingsRefreshTokenSource = new vscode.CancellationTokenSource();
        void provider.refreshLanguageModels(settingsRefreshTokenSource.token).catch((error) => {
            if (!(error instanceof vscode.CancellationError)) {
                logger_1.logger.error("models.settingsRefresh.failed", { error: String(error) });
            }
        });
    }));
    context.subscriptions.push({
        dispose: () => {
            settingsRefreshTokenSource?.cancel();
            settingsRefreshTokenSource?.dispose();
        },
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
function getConfigurationTarget(config, key) {
    const inspected = config.inspect(key);
    if (inspected?.workspaceFolderValue !== undefined) {
        return vscode.ConfigurationTarget.WorkspaceFolder;
    }
    if (inspected?.workspaceValue !== undefined) {
        return vscode.ConfigurationTarget.Workspace;
    }
    return vscode.ConfigurationTarget.Global;
}
async function refreshModels(provider, announceResult) {
    const result = await vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: (0, localize_1.l10n)("Refreshing CommandCode model list..."),
        cancellable: announceResult,
    }, async (_progress, token) => provider.refreshLanguageModels(token));
    if (!announceResult) {
        return result;
    }
    if (result.status === "api") {
        vscode.window.showInformationMessage((0, localize_1.l10nFormat)("CommandCode model list updated successfully ({0} models).", result.models.length));
    }
    else if (result.status === "auto-discovery-disabled") {
        vscode.window.showWarningMessage((0, localize_1.l10n)("Automatic model discovery is disabled; using the built-in model list."));
    }
    else if (result.status === "missing-api-key") {
        vscode.window.showWarningMessage((0, localize_1.l10n)("No CommandCode API key is configured; using the built-in model list."));
    }
    else {
        vscode.window.showWarningMessage((0, localize_1.l10nFormat)("Unable to load the live model list; using {0} fallback models.", result.models.length));
    }
    return result;
}
//# sourceMappingURL=extension.js.map