# CommandCode Provider for Copilot

将 [CommandCode Provider API](https://commandcode.ai/docs/provider) 接入 VS Code GitHub Copilot Chat 的独立扩展。项目基于 `opencode-go-copilot`，保留其流式输出、工具调用、图片代理、推理控制、提交信息生成和 token 统计能力。

> 本项目不是 CommandCode 官方插件，也不代表 CommandCode 官方立场。

## 快速开始

1. 安装打包后的 `commandcode-copilot-provider-*.vsix`。
2. 在 VS Code 命令面板运行 `CommandCode: Set CommandCode API Key`。
3. 在 Copilot Chat 模型选择器中启用并选择 `CommandCode` 模型。
4. 运行 `CommandCode: Update CommandCode Model List` 可手动刷新模型列表。

API key 从 CommandCode Studio 创建。Go 套餐没有 Provider API 访问权限；GOAT、Pro、Max、Team 以及 Provider API 计划可用，具体套餐和额度以[定价页](https://commandcode.ai/pricing)为准。

## API 适配

默认使用：

```text
https://api.commandcode.ai/provider/v1/
```

- 非 Claude 模型：`POST /chat/completions`，OpenAI 兼容格式。
- Claude 模型：`POST /messages`，Anthropic 兼容格式。
- 模型发现：`GET /models`。
- 认证：`Authorization: Bearer <CMD_API_KEY>` 或 Anthropic 兼容的 `x-api-key`。
- 可选开启 `commandcode.zeroDataRetention`，发送 `x-cmd-zdr: 1`。

扩展优先使用实时 `/models` 列表；网络或 key 不可用时使用内置模型兜底。模型元数据会尽量从 `models.dev` 获取，但不依赖它才能工作。

## 常用设置

```json
{
  "commandcode.commitModel": "deepseek/deepseek-v4-flash",
  "commandcode.requestTimeout": 600000,
  "commandcode.enableAutoModelDiscovery": true,
  "commandcode.visionProxyModel": "Qwen/Qwen3.7-Plus",
  "commandcode.zeroDataRetention": false
}
```

支持的能力还包括温度/`top_p` 预设、推理强度、Git 提交消息、`ask_image` 视觉代理和高级 token 指示器。

## 开发

```bash
npm install
npm run compile
npm run build
```

`npm run build` 会生成可安装的 VSIX 文件。

## License

MIT。基于 [opencode-go-copilot](https://github.com/OnesoftQwQ/opencode-go-copilot) 制作。
