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
exports.generateCommitMsg = generateCommitMsg;
exports.abortCommitGeneration = abortCommitGeneration;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const vscode = __importStar(require("vscode"));
const gitUtils_1 = require("./gitUtils");
const openaiApi_1 = require("../openai/openaiApi");
const anthropicApi_1 = require("../anthropic/anthropicApi");
const catalogModels_1 = require("../catalogModels");
const modelsDev_1 = require("../modelsDev");
const logger_1 = require("../logger");
const localize_1 = require("../localize");
let activeCommitGeneration;
const DEFAULT_PROMPT = {
    system: "You are a helpful assistant that generates concise, informative git commit messages based on git diffs.\n\nGuidelines:\n- By default, use conventional commit format: <type>(<scope>): <description>\n- If reference commits are provided below, match their style and language instead\n- Keep the subject line under 72 characters\n- Use the imperative mood (\"add\" not \"added\" / \"adds\")\n- CRITICAL: Output ONLY the commit message itself — no preamble, no introduction, no explanations, no backticks\n- If the diff is large, focus on the most important changes",
    user: "Notes from developer (ignore if not relevant): {{USER_CURRENT_INPUT}}",
    styleReference: "\n\nRecent commit messages in this repository (match their style):\n{{RECENT_COMMITS}}",
};
async function generateCommitMsg(secrets, scm, onApiKeyChanged) {
    if (activeCommitGeneration) {
        vscode.window.showInformationMessage((0, localize_1.l10n)("A commit message is already being generated."));
        return;
    }
    const session = { cancellation: new vscode.CancellationTokenSource() };
    activeCommitGeneration = session;
    await vscode.commands.executeCommand("setContext", "commandcode.isGeneratingCommit", true);
    try {
        throwIfCanceled(session.cancellation.token);
        const gitExtension = vscode.extensions.getExtension("vscode.git")?.exports;
        if (!gitExtension) {
            throw new Error((0, localize_1.l10n)("Git extension not found"));
        }
        const git = gitExtension.getAPI(1);
        if (git.repositories.length === 0) {
            throw new Error((0, localize_1.l10n)("No Git repositories available"));
        }
        if (scm) {
            const repository = git.getRepository(scm.rootUri);
            if (!repository) {
                throw new Error((0, localize_1.l10n)("Repository not found for provided SCM"));
            }
            await generateCommitMsgForRepository(secrets, repository, session, onApiKeyChanged);
            return;
        }
        await orchestrateWorkspaceCommitMsgGeneration(secrets, git.repositories, session, onApiKeyChanged);
    }
    catch (error) {
        if (isCancellationError(error, session.cancellation.token)) {
            vscode.window.showInformationMessage((0, localize_1.l10n)("Commit message generation canceled."));
            return;
        }
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error("commit.error", { error: errorMessage });
        vscode.window.showErrorMessage(`${(0, localize_1.l10n)("[Commit Generation Failed]")} ${errorMessage}`);
    }
    finally {
        if (activeCommitGeneration === session) {
            activeCommitGeneration = undefined;
        }
        session.abortController?.abort();
        session.cancellation.dispose();
        await vscode.commands.executeCommand("setContext", "commandcode.isGeneratingCommit", false);
    }
}
async function orchestrateWorkspaceCommitMsgGeneration(secrets, repos, session, onApiKeyChanged) {
    const reposWithChanges = await filterForReposWithChanges(repos, session.cancellation.token);
    if (reposWithChanges.length === 0) {
        vscode.window.showInformationMessage((0, localize_1.l10n)("No changes found in any workspace repositories."));
        return;
    }
    if (reposWithChanges.length === 1) {
        const repo = reposWithChanges[0];
        await generateCommitMsgForRepository(secrets, repo, session, onApiKeyChanged);
        return;
    }
    const selection = await promptRepoSelection(reposWithChanges, session.cancellation.token);
    if (!selection) {
        throwIfCanceled(session.cancellation.token);
        return;
    }
    if (selection.repo === null) {
        for (const repo of reposWithChanges) {
            throwIfCanceled(session.cancellation.token);
            try {
                await generateCommitMsgForRepository(secrets, repo, session, onApiKeyChanged);
            }
            catch (error) {
                if (isCancellationError(error, session.cancellation.token)) {
                    throw error;
                }
                const repoName = path.basename(repo.rootUri.fsPath) || (0, localize_1.l10n)("repository");
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger_1.logger.error("commit.repository.error", { repository: repo.rootUri.fsPath, error: errorMessage });
                vscode.window.showErrorMessage((0, localize_1.l10nFormat)("Failed to generate a commit message for {0}: {1}", repoName, errorMessage));
            }
        }
    }
    else {
        await generateCommitMsgForRepository(secrets, selection.repo, session, onApiKeyChanged);
    }
}
async function filterForReposWithChanges(repos, token) {
    const reposWithChanges = [];
    for (const repo of repos) {
        throwIfCanceled(token);
        try {
            const gitDiff = await (0, gitUtils_1.getGitDiff)(repo.rootUri.fsPath);
            throwIfCanceled(token);
            if (gitDiff) {
                reposWithChanges.push(repo);
            }
        }
        catch (error) {
            if (isCancellationError(error, token)) {
                throw error;
            }
            // Skip repositories with errors
        }
    }
    return reposWithChanges;
}
async function promptRepoSelection(repos, token) {
    const repoItems = repos.map((repo) => ({
        label: repo.rootUri.fsPath.split(path.sep).pop() || repo.rootUri.fsPath,
        description: repo.rootUri.fsPath,
        repo: repo,
    }));
    repoItems.unshift({
        label: `$(git-commit) ${(0, localize_1.l10n)("Generate for all repositories with changes")}`,
        description: (0, localize_1.l10nFormat)("Generate commit messages for {0} repositories", repos.length),
        repo: null,
    });
    return await vscode.window.showQuickPick(repoItems, {
        placeHolder: (0, localize_1.l10n)("Select repository for commit message generation"),
        ignoreFocusOut: true,
    }, token);
}
async function generateCommitMsgForRepository(secrets, repository, session, onApiKeyChanged) {
    const inputBox = repository.inputBox;
    const repoPath = repository.rootUri.fsPath;
    const gitDiff = await (0, gitUtils_1.getGitDiff)(repoPath);
    throwIfCanceled(session.cancellation.token);
    if (!gitDiff) {
        throw new Error((0, localize_1.l10nFormat)("No changes in repository {0} for commit message", repoPath.split(path.sep).pop() || (0, localize_1.l10n)("repository")));
    }
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.SourceControl,
        title: (0, localize_1.l10nFormat)("Generating commit message for {0}...", repoPath.split(path.sep).pop() || (0, localize_1.l10n)("repository")),
        cancellable: true,
    }, async (_, token) => {
        const cancellation = token.onCancellationRequested(() => session.cancellation.cancel());
        try {
            return await performCommitMsgGeneration(secrets, gitDiff, inputBox, session, repoPath, onApiKeyChanged);
        }
        finally {
            cancellation.dispose();
        }
    });
}
async function ensureApiKey(secrets, token, onApiKeyChanged) {
    let apiKey = await secrets.get("commandcode.apiKey");
    if (!apiKey) {
        const entered = await vscode.window.showInputBox({
            title: (0, localize_1.l10n)("CommandCode Provider API Key"),
            prompt: (0, localize_1.l10n)("Enter your CommandCode API key"),
            ignoreFocusOut: true,
            password: true,
        }, token);
        if (entered === undefined) {
            throwIfCanceled(token);
            throw new vscode.CancellationError();
        }
        if (!entered.trim()) {
            throw new vscode.CancellationError();
        }
        apiKey = entered.trim();
        await secrets.store("commandcode.apiKey", apiKey);
        await onApiKeyChanged?.();
    }
    return apiKey;
}
async function performCommitMsgGeneration(secrets, gitDiff, inputBox, session, repoPath, onApiKeyChanged) {
    const startTime = Date.now();
    let modelId;
    try {
        throwIfCanceled(session.cancellation.token);
        const config = vscode.workspace.getConfiguration();
        const customSystemPrompt = config.get("commandcode.commitMessagePrompt", "");
        let systemPrompt = customSystemPrompt || DEFAULT_PROMPT.system;
        // Fetch recent commits for style reference
        const recentCommitsCount = config.get("commandcode.recentCommitsCount", 10);
        const includeCommitDiff = config.get("commandcode.commitIncludeCommitDiff", false);
        if (recentCommitsCount > 0 && repoPath) {
            const recentCommits = await (0, gitUtils_1.getRecentCommits)(repoPath, recentCommitsCount, { includeDiff: includeCommitDiff });
            throwIfCanceled(session.cancellation.token);
            if (recentCommits) {
                const styleRef = includeCommitDiff
                    ? "\n\nRecent commit messages and their changes in this repository (match their style):\n{{RECENT_COMMITS}}"
                    : DEFAULT_PROMPT.styleReference;
                systemPrompt += styleRef.replace("{{RECENT_COMMITS}}", recentCommits);
            }
        }
        const prompts = [];
        // Attach AGENTS.md and README.md context
        const attachContextFiles = config.get("commandcode.commitAttachContextFiles", true);
        if (attachContextFiles && repoPath) {
            const contextFiles = ["AGENTS.md", "README.md"];
            for (const fileName of contextFiles) {
                const filePath = path.join(repoPath, fileName);
                try {
                    if (fs.existsSync(filePath)) {
                        const content = fs.readFileSync(filePath, "utf-8").trim();
                        if (content) {
                            const truncated = content.length > 8000
                                ? content.substring(0, 8000) + "\n\n[Content truncated due to size]"
                                : content;
                            prompts.push(`[File: ${fileName}]\n${truncated}`);
                        }
                    }
                }
                catch {
                    // Skip files that can't be read
                }
            }
        }
        const currentInput = inputBox.value?.trim() || "";
        if (currentInput) {
            prompts.push(DEFAULT_PROMPT.user.replace("{{USER_CURRENT_INPUT}}", currentInput));
        }
        const truncatedDiff = gitDiff.length > 5000 ? gitDiff.substring(0, 5000) + "\n\n[Diff truncated due to size]" : gitDiff;
        prompts.push(truncatedDiff);
        const prompt = prompts.join("\n\n");
        // Use model from config or the current CommandCode default.
        const commitModelId = config.get("commandcode.commitModel", "deepseek/deepseek-v4-flash");
        // Fetch full model config (apiMode, max_completion_tokens, extra, etc.)
        // Shallow copy to avoid mutating the shared resolved config.
        const selectedModel = {
            ...(0, catalogModels_1.getCatalogModelConfig)(commitModelId)
        };
        // Commit messages are simple tasks — disable thinking to speed up generation.
        selectedModel.enable_thinking = false;
        // Cap max_completion_tokens to avoid proxy 500 errors with oversized values
        if (selectedModel.max_completion_tokens && selectedModel.max_completion_tokens > 8192) {
            selectedModel.max_completion_tokens = 8192;
        }
        modelId = selectedModel.id;
        logger_1.logger.info("commit.start", { modelId });
        const apiKey = await ensureApiKey(secrets, session.cancellation.token, onApiKeyChanged);
        throwIfCanceled(session.cancellation.token);
        if (!apiKey) {
            throw new Error((0, localize_1.l10n)("CommandCode API key not found"));
        }
        const baseUrl = selectedModel.baseUrl || (0, modelsDev_1.getCatalogProviderBaseUrl)("commandcode", "https://api.commandcode.ai/provider/v1/");
        if (!baseUrl || !baseUrl.startsWith("http")) {
            throw new Error((0, localize_1.l10n)("Invalid base URL configuration."));
        }
        {
            const url = new URL(baseUrl);
            if (url.protocol === "http:") {
                const host = url.hostname.toLowerCase();
                const isLocal = host === "localhost" || host === "127.0.0.1" || host === "::1"
                    || host.startsWith("192.168.") || host.startsWith("10.")
                    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
                    || host === "0.0.0.0";
                if (!isLocal) {
                    throw new Error((0, localize_1.l10n)("Plain HTTP is only allowed for localhost or private network addresses. Use HTTPS for remote endpoints."));
                }
            }
        }
        // Apply language instruction: auto mode lets the model infer from style reference
        const commitLanguage = config.get("commandcode.commitLanguage", "auto");
        if (commitLanguage !== "auto") {
            systemPrompt += ` Generate commit message in ${commitLanguage}.`;
        }
        const messages = [{ role: "user", content: prompt }];
        // Use the appropriate API based on model config
        const apiMode = selectedModel.apiMode || "openai";
        const apiInstance = apiMode === "anthropic"
            ? new anthropicApi_1.AnthropicApi(modelId)
            : new openaiApi_1.OpenaiApi(modelId);
        const abortController = new AbortController();
        session.abortController = abortController;
        const cancellation = session.cancellation.token.onCancellationRequested(() => abortController.abort());
        const stream = apiInstance.createMessage(selectedModel, systemPrompt, messages, baseUrl, apiKey, abortController.signal);
        let response = "";
        try {
            for await (const chunk of stream) {
                abortController.signal.throwIfAborted();
                if (chunk.type === "text") {
                    response += chunk.text;
                    const partialMessage = extractCommitMessage(response);
                    if (partialMessage) {
                        inputBox.value = partialMessage;
                    }
                }
            }
        }
        finally {
            cancellation.dispose();
            if (session.abortController === abortController) {
                session.abortController = undefined;
            }
        }
        const finalMessage = removeThinkTags(extractCommitMessage(response));
        if (!finalMessage) {
            throw new Error((0, localize_1.l10n)("empty API response"));
        }
        inputBox.value = finalMessage;
        logger_1.logger.info("commit.end", { modelId, durationMs: Date.now() - startTime });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        if (isCancellationError(error, session.cancellation.token)) {
            logger_1.logger.info("commit.canceled", { modelId: modelId ?? "unknown" });
        }
        else {
            logger_1.logger.error("commit.error", { modelId: modelId ?? "unknown", error: errorMessage });
        }
        throw error;
    }
}
function abortCommitGeneration() {
    activeCommitGeneration?.cancellation.cancel();
    activeCommitGeneration?.abortController?.abort();
}
function throwIfCanceled(token) {
    if (token.isCancellationRequested) {
        throw new vscode.CancellationError();
    }
}
function isCancellationError(error, token) {
    return token.isCancellationRequested
        || error instanceof vscode.CancellationError
        || (error instanceof DOMException && error.name === "AbortError")
        || (error instanceof Error && error.name === "AbortError");
}
function extractCommitMessage(str) {
    return str
        .trim()
        .replace(/^```[^\n]*\n?|```$/g, "")
        .trim();
}
function removeThinkTags(text) {
    const regex = /<think>.*?<\/think>/gs;
    return text.replace(regex, "").trim();
}
//# sourceMappingURL=commitMessageGenerator.js.map