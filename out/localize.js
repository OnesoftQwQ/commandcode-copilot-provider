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
exports.l10n = l10n;
exports.l10nFormat = l10nFormat;
const vscode = __importStar(require("vscode"));
const zhCN = {
    // statusBar
    "Token Usage": "Token 使用量",
    "Token usage": "Token 使用量",
    "Input": "输入",
    "Output": "输出",
    // extension.ts - API key prompts
    "CommandCode Provider API Key": "CommandCode 提供商 API 密钥",
    "Update your CommandCode API key": "更新您的 CommandCode API 密钥",
    "Enter your CommandCode API key": "输入您的 CommandCode API 密钥",
    "CommandCode API key cleared.": "CommandCode API 密钥已清除。",
    "CommandCode API key saved.": "CommandCode API 密钥已保存。",
    "Refreshing CommandCode model list...": "正在刷新 CommandCode 模型列表...",
    "CommandCode model list refresh canceled.": "已取消刷新 CommandCode 模型列表。",
    "CommandCode model list updated successfully ({0} models).": "CommandCode 模型列表已更新（{0} 个模型）。",
    "Failed to update CommandCode model list. See output for details.": "更新 CommandCode 模型列表失败，请查看输出了解详情。",
    "Automatic model discovery is disabled; using the built-in model list.": "自动模型发现已关闭，正在使用内置模型列表。",
    "No CommandCode API key is configured; using the built-in model list.": "尚未配置 CommandCode API 密钥，正在使用内置模型列表。",
    "Unable to load the live model list; using {0} fallback models.": "无法加载实时模型列表，正在使用 {0} 个备用模型。",
    // provider.ts
    "CommandCode API key not found": "未找到 CommandCode API 密钥",
    "Invalid base URL configuration.": "无效的 Base URL 配置。",
    "Plain HTTP is only allowed for localhost or private network addresses. Use HTTPS for remote endpoints.": "纯 HTTP 仅允许用于本地或私有网络地址，远程端点请使用 HTTPS。",
    // statusBar cache tooltip
    "Cache": "缓存",
    "({0} cached, {1}%)": "(已缓存 {0}, 命中率 {1}%)",
    "No changes found in any workspace repositories.": "在任何工作区仓库中均未发现更改。",
    "A commit message is already being generated.": "已有一个提交消息生成任务正在运行。",
    "Commit message generation canceled.": "已取消生成提交消息。",
    "repository": "仓库",
    "Failed to generate a commit message for {0}: {1}": "为 {0} 生成提交消息失败：{1}",
    "Generate for all repositories with changes": "为所有有更改的仓库生成",
    "Generate commit messages for {0} repositories": "为 {0} 个仓库生成提交消息",
    "Select repository for commit message generation": "选择要生成提交消息的仓库",
    "No changes in repository {0} for commit message": "仓库 {0} 中没有可用于生成提交消息的更改",
    "Generating commit message for {0}...": "正在为 {0} 生成提交消息...",
    "Git extension not found": "未找到 Git 扩展",
    "No Git repositories available": "没有可用的 Git 仓库",
    "Repository not found for provided SCM": "未找到指定 SCM 对应的仓库",
    "No models configured for commit message generation. Please set 'useForCommitGeneration' to true for at least one model in your configuration.": "未配置用于生成提交消息的模型。请在配置中将至少一个模型的 'useForCommitGeneration' 设为 true。",
    "{0} is no longer available as a free model. Please use a different model.": "{0} 已结束免费使用，请使用其他模型。",
    "Failed to generate commit message:": "生成提交消息失败：",
    "[Commit Generation Failed]": "[提交生成失败]",
    "empty API response": "API 返回为空",
    // Timeout error
    "Request timed out. The generation took too long. You can increase the timeout in settings (commandcode.requestTimeout).": "请求超时，生成内容过长。您可以在设置中增加超时时间（commandcode.requestTimeout）。",
    "The connection was closed by the server. The generation took too long. Please try again or request shorter content.": "服务端连接被关闭，生成内容过长时间过长。请重试或请求较短的内容。",
    // reasoning effort labels (keys are English fallback text)
    "Disabled": "禁用思考",
    "Adaptive": "自动",
    "Thinking": "思考",
    "Low": "低",
    "Medium": "中",
    "High": "高",
    "Extra High": "超高",
    "Maximum": "最高",
    // reasoning effort descriptions (keys are English fallback text)
    "Do not enable thinking": "不启用思考",
    "Automatically decide when to think": "自动决定何时思考",
    "Enable thinking": "启用思考",
    "Reduce thinking, faster response": "减少思考，更快响应",
    "Balance thinking and speed": "平衡思考与速度",
    "Deeper thinking, slower response": "更深入思考，响应较慢",
    "Very deep thinking, slower response": "非常深入的思考，响应很慢",
    "Maximum thinking depth, slowest response": "最大思考深度，响应最慢",
    // reasoning effort title (key is English fallback text)
    "Reasoning Effort": "推理强度",
    // deprecated model marker (shown when commandcode.showDeprecatedModels is enabled)
    "[Depr] ": "[已弃用] ",
    // vision proxy
    "Querying vision model: \"{0}\"": "正在根据图片提问：{0}",
    "The image you sent was flagged as sensitive by the content moderation system. Please try a different image.": "您发送的图片被内容审核系统判定为敏感，请尝试更换图片。",
    // extension.ts - model preset (setModelPreset command)
    "Custom (manual input)": "自定义 (手动输入)",
    " (current)": " (当前)",
    "(current, temperature: {0}, top_p: {1})": "(当前, 温度: {0}, top_p: {1})",
    "temperature: {0}": "温度: {0}",
    "temperature: {0}, top_p: {1}": "温度: {0}, top_p: {1}",
    "Set Model Preset": "设置模型预设",
    "Select a preset": "选择一个档位",
    "Enter custom temperature": "输入自定义温度",
    "Enter a single number for temperature only (<=2), or two comma-separated numbers for temperature and top_p (temp<=2, top_p<=1), e.g.: 0.7 or 0.7,0.95": "输入一个数字只设温度 (<=2), 输入两个数字用英文逗号分隔同时设温度和 top_p (温度<=2, top_p<=1), 如: 0.7 或 0.7,0.95",
    "Please enter at least temperature value": "请至少输入一个温度值",
    "Please enter at most two numbers separated by a comma": "最多输入两个数值, 用英文逗号分隔",
    "Temperature must be between 0.0 and 2.0": "温度必须在 0.0 到 2.0 之间",
    "top_p must be between 0.0 and 1.0": "top_p 必须在 0.0 到 1.0 之间",
    "Precise": "精确",
    "Balanced": "均衡",
    "Creative": "创意",
    "Extra Creative": "极具创意",
    "Set to temperature: {0} ({1})": "已设为温度 {0} ({1})",
    "Set to temperature: {0} (custom)": "已设为温度 {0} (自定义)",
    "Set to temp: {0}, top_p: {1} (custom)": "已设为温度 {0}, top_p {1} (自定义)",
    "Set to temp: {0}, top_p: {1} ({2})": "已设为温度 {0}, top_p {1} ({2})",
};
/**
 * Get the localized string for the given key.
 * Falls back to the key itself if no translation is available.
 */
function l10n(key) {
    const language = vscode.env.language;
    if (language.toLowerCase() === "zh-cn" || language.toLowerCase().startsWith("zh")) {
        if (zhCN[key]) {
            return zhCN[key];
        }
    }
    return key;
}
/**
 * Format a localized string with replacements.
 * Usage: l10nFormat("Token Usage: {0} / {1}", "12.5K", "1M")
 */
function l10nFormat(template, ...args) {
    let str = l10n(template);
    for (let i = 0; i < args.length; i++) {
        str = str.replace(`{${i}}`, String(args[i]));
    }
    return str;
}
//# sourceMappingURL=localize.js.map