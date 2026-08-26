# AurisAI

Windows 桌面应用：手动录音（系统环回 + 麦克风）→ 本地 Whisper 转写 → 手动发送到 DeepSeek。

仅支持 Windows。录音需用户点击开始；不自动开会、不自动调用 DeepSeek。

## 环境要求

- Windows 10/11
- [Node.js](https://nodejs.org/) 18+
- [Rust](https://rustup.rs/) stable
- Visual Studio Build Tools（含「使用 C++ 的桌面开发」）——编译 Tauri / WASAPI 需要

## 首次运行

```bash
npm install
npm run tauri dev
```

### 1. 准备 Whisper（本地转写）

本应用通过 **whisper.cpp 官方 CLI** 转写（不内嵌编译 whisper，避免 libclang/CMake 依赖）。

1. 从 [whisper.cpp Releases](https://github.com/ggerganov/whisper.cpp/releases) 下载 Windows 预编译包，找到 `whisper-cli.exe`。
2. 下载模型（短语音推荐 `ggml-base.bin`）：  
   https://huggingface.co/ggerganov/whisper.cpp
3. 在应用 **设置** 中填写：
   - Whisper CLI → `whisper-cli.exe` 路径
   - 模型路径 → `ggml-base.bin` 路径
   - 语言默认 `zh`

### 2. 配置 DeepSeek

在 **设置** 中填写：

- API Key（[DeepSeek 开放平台](https://platform.deepseek.com/)）
- Base URL 默认 `https://api.deepseek.com`
- 模型默认 `deepseek-chat`

设置保存在本机 `%APPDATA%\com.jghooo.aurisai\settings.json`，不会打进安装包。

## 使用

1. 打开腾讯会议 / 微信语音 / 钉钉等（状态栏会提示是否检测到）。
2. 点击 **开始录音**（默认同时录扬声器环回 + 麦克风）。
3. 点击 **停止并转写**，等待本地 Whisper 出字。
4. 核对/编辑转写后，点击 **发送本段转写到 DeepSeek**，或在下方追问。
5. **新会话** 清空当前 DeepSeek 对话历史。

录音文件：`%APPDATA%\com.jghooo.aurisai\recordings\`

## 打包给他人

```bash
npm run tauri build
```

安装包在 `src-tauri/target/release/bundle/nsis/`。

注意：

- 安装包 **不含** Whisper CLI 与模型；接收方需自行下载并在设置中指定路径。
- DeepSeek Key 需各自在设置中填写。

## 合规

仅用于你自己参加的会议。录音时界面有明显「正在录音」提示；请遵守当地法律与会议对方知情同意要求。

## 技术栈

- Tauri 2 + React + TypeScript
- WASAPI 环回 / 麦克风采集（`wasapi`）
- 本地 Whisper：`whisper-cli.exe`（whisper.cpp）
- DeepSeek Chat Completions API
