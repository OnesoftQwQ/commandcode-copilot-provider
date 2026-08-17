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
/**
 * Git commit message generator module.
 */
let commitGenerationAbortController;
const DEFAULT_PROMPT = {
    system: "You are a helpful assistant that generates concise, informative git commit messages based on git diffs.\n\nGuidelines:\n- By default, use conventional commit format: <type>(<scope>): <description>\n- If reference commits are provided below, match their style and language instead\n- Keep the subject line under 72 characters\n- Use the imperative mood (\"add\" not \"added\" / \"adds\")\n- CRITICAL: Output ONLY the commit message itself — no preamble, no introduction, no explanations, no backticks\n- If the diff is large, focus on the most important changes",
    user: "Notes from developer (ignore if not relevant): {{USER_CURRENT_INPUT}}",
    styleReference: "\n\nRecent commit messages in this repository (match their style):\n{{RECENT_COMMITS}}",
};
async function generateCommitMsg(secrets, scm) {
    try {
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
            await generateCommitMsgForRepository(secrets, repository);
            return;
        }
        await orchestrateWorkspaceCommitMsgGeneration(secrets, git.repositories);
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`${(0, localize_1.l10n)("[Commit Generation Failed]")} ${errorMessage}`);
    }
}
async function orchestrateWorkspaceCommitMsgGeneration(secrets, repos) {
    const reposWithChanges = await filterForReposWithChanges(repos);
    if (reposWithChanges.length === 0) {
        vscode.window.showInformationMessage((0, localize_1.l10n)("No changes found in any workspace repositories."));
        return;
    }
    if (reposWithChanges.length === 1) {
        const repo = reposWithChanges[0];
        await generateCommitMsgForRepository(secrets, repo);
        return;
    }
    const selection = await promptRepoSelection(reposWithChanges);
    if (!selection) {
        return;
    }
    if (selection.repo === null) {
        for (const repo of reposWithChanges) {
            try {
                await generateCommitMsgForRepository(secrets, repo);
            }
            catch (error) {
                console.error(`Failed to generate commit message for ${repo.rootUri.fsPath}:`, error);
            }
        }
    }
    else {
        await generateCommitMsgForRepository(secrets, selection.repo);
    }
}
async function filterForReposWithChanges(repos) {
    const reposWithChanges = [];
    for (const repo of repos) {
        try {
            const gitDiff = await (0, gitUtils_1.getGitDiff)(repo.rootUri.fsPath);
            if (gitDiff) {
                reposWithChanges.push(repo);
            }
        }
        catch {
            // Skip repositories with errors
        }
    }
    return reposWithChanges;
}
async function promptRepoSelection(repos) {
    const repoItems = repos.map((repo) => ({
        label: repo.rootUri.fsPath.split(path.sep).pop() || repo.rootUri.fsPath,
        description: repo.rootUri.fsPath,
        repo: repo,
    }));
    repoItems.unshift({
        label: "$(git-commit) Generate for all repositories with changes",
        description: `Generate commit messages for ${repos.length} repositories`,
        repo: null,
    });
    return await vscode.window.showQuickPick(repoItems, {
        placeHolder: "Select repository for commit message generation",
    });
}
async function generateCommitMsgForRepository(secrets, repository) {
    const inputBox = repository.inputBox;
    const repoPath = repository.rootUri.fsPath;
    const gitDiff = await (0, gitUtils_1.getGitDiff)(repoPath);
    if (!gitDiff) {
        throw new Error(`No changes in repository ${repoPath.split(path.sep).pop() || "repository"} for commit message`);
    }
    await vscode.window.withProgress({
        location: vscode.ProgressLocation.SourceControl,
        title: `Generating commit message for ${repoPath.split(path.sep).pop() || "repository"}...`,
        cancellable: true,
    }, (_, token) => {
        token.onCancellationRequested(() => {
            commitGenerationAbortController?.abort();
        });
        return performCommitMsgGeneration(secrets, gitDiff, inputBox, repoPath);
    });
}
async function ensureApiKey(secrets) {
    let apiKey = await secrets.get("commandcode.apiKey");
    if (!apiKey) {
        const entered = await vscode.window.showInputBox({
            title: (0, localize_1.l10n)("CommandCode Provider API Key"),
            prompt: (0, localize_1.l10n)("Enter your CommandCode API key"),
            ignoreFocusOut: true,
            password: true,
        });
        if (entered && entered.trim()) {
            apiKey = entered.trim();
            await secrets.store("commandcode.apiKey", apiKey);
        }
    }
    return apiKey;
}
async function performCommitMsgGeneration(secrets, gitDiff, inputBox, repoPath) {
    const startTime = Date.now();
    let modelId;
    try {
        vscode.commands.executeCommand("setContext", "commandcode.isGeneratingCommit", true);
        const config = vscode.workspace.getConfiguration();
        const customSystemPrompt = config.get("commandcode.commitMessagePrompt", "");
        let systemPrompt = customSystemPrompt || DEFAULT_PROMPT.system;
        // Fetch recent commits for style reference
        const recentCommitsCount = config.get("commandcode.recentCommitsCount", 10);
        const includeCommitDiff = config.get("commandcode.commitIncludeCommitDiff", false);
        if (recentCommitsCount > 0 && repoPath) {
            const recentCommits = await (0, gitUtils_1.getRecentCommits)(repoPath, recentCommitsCount, { includeDiff: includeCommitDiff });
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
        const apiKey = await ensureApiKey(secrets);
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
        commitGenerationAbortController = new AbortController();
        const stream = apiInstance.createMessage(selectedModel, systemPrompt, messages, baseUrl, apiKey, commitGenerationAbortController.signal);
        let response = "";
        for await (const chunk of stream) {
            commitGenerationAbortController.signal.throwIfAborted();
            if (chunk.type === "text") {
                response += chunk.text;
                inputBox.value = extractCommitMessage(response);
            }
        }
        inputBox.value = removeThinkTags(inputBox.value);
        if (!inputBox.value) {
            throw new Error((0, localize_1.l10n)("empty API response"));
        }
        logger_1.logger.info("commit.end", { modelId, durationMs: Date.now() - startTime });
    }
    catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        logger_1.logger.error("commit.error", { modelId: modelId ?? "unknown", error: errorMessage });
        vscode.window.showErrorMessage(`${(0, localize_1.l10n)("Failed to generate commit message:")} ${errorMessage}`);
    }
    finally {
        vscode.commands.executeCommand("setContext", "commandcode.isGeneratingCommit", false);
    }
}
function abortCommitGeneration() {
    commitGenerationAbortController?.abort();
    vscode.commands.executeCommand("setContext", "commandcode.isGeneratingCommit", false);
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