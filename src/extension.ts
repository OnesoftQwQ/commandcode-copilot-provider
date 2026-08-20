import * as vscode from "vscode";
import { CommandCodeChatModelProvider } from "./provider";
import { initStatusBar } from "./statusBar";
import { logger } from "./logger";
import { l10n, l10nFormat } from "./localize";
import type { ModelPreset } from "./types";
import { VersionManager } from "./versionManager";
import { abortCommitGeneration, generateCommitMsg } from "./gitCommit/commitMessageGenerator";
import { TokenizerManager } from "./tokenizer/tokenizerManager";
import { prepareLanguageModelChatInformation } from "./provideModel";
import { formatCustomPresetInput, parseCustomPresetInput } from "./modelPreset";

// ---- Walkthrough / Welcome constants ----

/** memento key tracking whether the welcome walkthrough has been shown. */
const WELCOME_SHOWN_KEY = "commandcode.welcomeShown";

/** Walkthrough contribution ID (publisher.extension#walkthroughId). */
const WALKTHROUGH_ID = "OnesoftQwQ.commandcode-copilot-provider#commandCodeGettingStarted";

export function activate(context: vscode.ExtensionContext) {
    // Initialize logger
    logger.init();
    logger.info("extension.activate", { version: VersionManager.getVersion() });

    // Initialize TokenizerManager with extension path
    TokenizerManager.initialize(context.extensionPath);

    const tokenCountStatusBarItem: vscode.StatusBarItem = initStatusBar(context);
    const provider = new CommandCodeChatModelProvider(context.secrets, tokenCountStatusBarItem);

    // Register the CommandCode provider under the vendor id used in package.json
    context.subscriptions.push(
        vscode.lm.registerLanguageModelChatProvider("commandcode", provider),
        provider,
    );

    // Management command to configure API key
    context.subscriptions.push(
        vscode.commands.registerCommand("commandcode.setApiKey", async () => {
            const existing = await context.secrets.get("commandcode.apiKey");
            const apiKey = await vscode.window.showInputBox({
                title: l10n("CommandCode Provider API Key"),
                prompt: existing ? l10n("Update your CommandCode API key") : l10n("Enter your CommandCode API key"),
                ignoreFocusOut: true,
                password: true,
                value: existing ?? "",
            });
            if (apiKey === undefined) {
                return; // user canceled
            }
            if (!apiKey.trim()) {
                await context.secrets.delete("commandcode.apiKey");
                vscode.window.showInformationMessage(l10n("CommandCode API key cleared."));
                await refreshModels(provider, false);
                return;
            }
            await context.secrets.store("commandcode.apiKey", apiKey.trim());
            vscode.window.showInformationMessage(l10n("CommandCode API key saved."));
            await refreshModels(provider, false);
        })
    );

    // manually trigger model list update command
    context.subscriptions.push(
        vscode.commands.registerCommand("commandcode.updateModelList", async () => {
            try {
                await refreshModels(provider, true);
            } catch (error) {
                if (error instanceof vscode.CancellationError) {
                    vscode.window.showInformationMessage(l10n("CommandCode model list refresh canceled."));
                    return;
                }
                logger.error("models.update.failed", { error: String(error) });
                vscode.window.showErrorMessage(l10n("Failed to update CommandCode model list. See output for details."));
            }
        })
    );

    // Command to open the CommandCode website to get an API key
    context.subscriptions.push(
        vscode.commands.registerCommand("commandcode.getApiKey", async () => {
            await vscode.env.openExternal(vscode.Uri.parse("https://commandcode.ai"));
        })
    );

    // Command to open extension settings
    context.subscriptions.push(
        vscode.commands.registerCommand("commandcode.openSettings", async () => {
            await vscode.commands.executeCommand("workbench.action.openSettings", "@ext:OnesoftQwQ.commandcode-copilot-provider");
        })
    );

    // Register the generateGitCommitMessage command handler
    context.subscriptions.push(
        vscode.commands.registerCommand("commandcode.generateGitCommitMessage", async (scm) => {
            await generateCommitMsg(context.secrets, scm, () => {
                const refreshTokenSource = new vscode.CancellationTokenSource();
                void provider.refreshLanguageModels(refreshTokenSource.token)
                    .catch((error) => logger.error("models.apiKeyRefresh.failed", { error: String(error) }))
                    .finally(() => refreshTokenSource.dispose());
            });
        }),
        vscode.commands.registerCommand("commandcode.abortGitCommitMessage", () => {
            abortCommitGeneration();
        }),
    );

    // Register the setModelPreset command: user can select a preset via QuickPick
    context.subscriptions.push(
        vscode.commands.registerCommand("commandcode.setModelPreset", async () => {
            const resource = vscode.window.activeTextEditor?.document.uri;
            const config = vscode.workspace.getConfiguration("commandcode", resource);
            const presets = config.get<ModelPreset[]>("modelPresets", []);
            const currentPresetId = config.get<string>("modelPreset", "custom");
            const currentTemp = config.get<number | null>("temperature", null);
            const currentTopP = config.get<number | null>("top_p", null);

            interface PresetQuickPickItem extends vscode.QuickPickItem {
                action?: { kind: "preset"; preset: ModelPreset } | { kind: "custom" };
            }

            // Mark the currently active preset with " (当前)"
            const presetItems: PresetQuickPickItem[] = presets
                .filter((preset) => preset.id.trim() && Number.isFinite(preset.temperature))
                .map((preset) => ({
                    label: `${l10n(preset.label)} (${l10nFormat(
                        preset.top_p === undefined ? "temperature: {0}" : "temperature: {0}, top_p: {1}",
                        preset.temperature,
                        ...(preset.top_p === undefined ? [] : [preset.top_p]),
                    )})${preset.id === currentPresetId ? l10n(" (current)") : ""}`,
                    action: { kind: "preset", preset },
                }));

            // Mark custom option with current values if active
            const isCustomActive = currentPresetId === "custom";
            const customLabel = "$(pencil) " + l10n("Custom (manual input)")
                + (isCustomActive
                    ? ` ${l10nFormat("(current, temperature: {0}, top_p: {1})", String(currentTemp ?? "—"), String(currentTopP ?? "—"))}`
                    : "");

            const customItem: PresetQuickPickItem = {
                label: customLabel,
                action: { kind: "custom" },
            };

            const items: PresetQuickPickItem[] = [
                ...presetItems,
                { label: "", kind: vscode.QuickPickItemKind.Separator },
                customItem,
            ];

            const title = l10n("Set Model Preset");

            const picked = await vscode.window.showQuickPick(items, {
                title,
                placeHolder: l10n("Select a preset"),
                ignoreFocusOut: true,
            });

            if (!picked) {
                return;
            }

            if (picked.action?.kind === "preset") {
                // User selected a named preset
                const matchedPreset = picked.action.preset;
                await config.update("modelPreset", matchedPreset.id, getConfigurationTarget(config, "modelPreset"));
                vscode.window.showInformationMessage(
                    matchedPreset.top_p === undefined
                        ? l10nFormat("Set to temperature: {0} ({1})", matchedPreset.temperature, l10n(matchedPreset.label))
                        : l10nFormat(
                            "Set to temp: {0}, top_p: {1} ({2})",
                            matchedPreset.temperature,
                            matchedPreset.top_p,
                            l10n(matchedPreset.label),
                        ),
                );
            } else if (picked.action?.kind === "custom") {
                // User chose "Custom (manual input)"
                const inputValue = await vscode.window.showInputBox({
                    title: l10n("Enter custom temperature"),
                    prompt: l10n("Enter a single number for temperature only (<=2), or two comma-separated numbers for temperature and top_p (temp<=2, top_p<=1), e.g.: 0.7 or 0.7,0.95"),
                    value: formatCustomPresetInput(currentTemp, currentTopP),
                    validateInput: (val: string) => {
                        const parsed = parseCustomPresetInput(val);
                        return parsed.error ? l10n(parsed.error) : null;
                    },
                    ignoreFocusOut: true,
                });
                if (inputValue !== undefined) {
                    const parsed = parseCustomPresetInput(inputValue);
                    if (!parsed.value) {
                        return;
                    }
                    await config.update("modelPreset", "custom", getConfigurationTarget(config, "modelPreset"));
                    await config.update("temperature", parsed.value.temperature, getConfigurationTarget(config, "temperature"));
                    await config.update("top_p", parsed.value.topP ?? null, getConfigurationTarget(config, "top_p"));
                    if (parsed.value.topP !== undefined) {
                        vscode.window.showInformationMessage(
                            l10nFormat("Set to temp: {0}, top_p: {1} (custom)", parsed.value.temperature, parsed.value.topP)
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            l10nFormat("Set to temperature: {0} (custom)", parsed.value.temperature)
                        );
                    }
                }
            }
        })
    );

    // Warm up model discovery on every activation (non-blocking, fire-and-forget).
    // VS Code may fire several activation events at startup; the short refresh
    // interval in prepareLanguageModelChatInformation (default 1 minute) dedupes
    // concurrent calls so the API is not spammed. The models.dev catalog is
    // fetched before the model list. On failure it degrades silently to the
    // built-in model list.
    void prepareLanguageModelChatInformation(
        { silent: true },
        new vscode.CancellationTokenSource().token,
        context.secrets
    ).catch((error) => {
        logger.error("models.warmup.failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    });

    const modelDiscoverySettings = [
        "commandcode.enableAutoModelDiscovery",
        "commandcode.showDeprecatedModels",
        "commandcode.modelsDevMirrorUrl",
        "commandcode.modelsDevMirrorToken",
    ];
    let settingsRefreshTokenSource: vscode.CancellationTokenSource | undefined;
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((event) => {
        if (!modelDiscoverySettings.some((key) => event.affectsConfiguration(key))) {
            return;
        }
        settingsRefreshTokenSource?.cancel();
        settingsRefreshTokenSource?.dispose();
        settingsRefreshTokenSource = new vscode.CancellationTokenSource();
        void provider.refreshLanguageModels(settingsRefreshTokenSource.token).catch((error) => {
            if (!(error instanceof vscode.CancellationError)) {
                logger.error("models.settingsRefresh.failed", { error: String(error) });
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
        dispose: () => logger.dispose(),
    });
}

/**
 * Show the welcome walkthrough on first activation if no API key is configured.
 * Once shown (or if a key already exists) the flag is persisted so it won't
 * reappear after subsequent reloads.
 */
async function showWelcomeIfNeeded(context: vscode.ExtensionContext): Promise<void> {
    try {
        if (context.globalState.get<boolean>(WELCOME_SHOWN_KEY)) {
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
    } catch (error) {
        logger.warn("Failed to show welcome walkthrough", { error: String(error) });
    }
}

export function deactivate() { }

function getConfigurationTarget(
    config: vscode.WorkspaceConfiguration,
    key: string,
): vscode.ConfigurationTarget {
    const inspected = config.inspect(key);
    if (inspected?.workspaceFolderValue !== undefined) {
        return vscode.ConfigurationTarget.WorkspaceFolder;
    }
    if (inspected?.workspaceValue !== undefined) {
        return vscode.ConfigurationTarget.Workspace;
    }
    return vscode.ConfigurationTarget.Global;
}

async function refreshModels(provider: CommandCodeChatModelProvider, announceResult: boolean) {
    const result = await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: l10n("Refreshing CommandCode model list..."),
            cancellable: announceResult,
        },
        async (_progress, token) => provider.refreshLanguageModels(token),
    );

    if (!announceResult) {
        return result;
    }

    if (result.status === "api") {
        vscode.window.showInformationMessage(
            l10nFormat("CommandCode model list updated successfully ({0} models).", result.models.length),
        );
    } else if (result.status === "auto-discovery-disabled") {
        vscode.window.showWarningMessage(l10n("Automatic model discovery is disabled; using the built-in model list."));
    } else if (result.status === "missing-api-key") {
        vscode.window.showWarningMessage(l10n("No CommandCode API key is configured; using the built-in model list."));
    } else {
        vscode.window.showWarningMessage(l10nFormat(
            "Unable to load the live model list; using {0} fallback models.",
            result.models.length,
        ));
    }
    return result;
}
