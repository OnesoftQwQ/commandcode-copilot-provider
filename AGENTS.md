# CommandCode Copilot Provider

这是一个基于 `opencode-go-copilot` 改造的独立 VS Code 扩展，将 CommandCode Provider API 接入 GitHub Copilot Chat。

## 关键约定

- 所有改动完成后运行 `npm run compile`。
- CommandCode API 根地址是 `https://api.commandcode.ai/provider/v1/`。
- `/chat/completions` 用于 OpenAI/开源模型；Claude 模型使用 `/messages`。
- 模型列表以 `/models` 为准；API 不可用时使用 `src/provideModel.ts` 的兜底列表。
- API key 存在 VS Code SecretStorage 的 `commandcode.apiKey` 中。
- `commandcode.zeroDataRetention` 开启时发送 `x-cmd-zdr: 1`。
- 不要把 CommandCode API key 写入仓库、日志或测试文件。

## 目录

- `src/extension.ts`：扩展激活、命令和 provider 注册。
- `src/provider.ts`：VS Code `LanguageModelChatProvider`，负责请求、重试、取消和视觉代理。
- `src/apiModelList.ts`：CommandCode `/models` 动态发现。
- `src/provideModel.ts`：实时模型列表与内置兜底列表。
- `src/catalogModels.ts`：模型元数据、推理能力和端点模式解析。
- `src/openai/`、`src/anthropic/`：两种兼容协议的请求和流式响应处理。
- `src/statusBar.ts`：输入、输出和缓存 token 统计。

## 构建

```bash
npm install
npm run compile
npm run build
```
