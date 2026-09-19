# AurisAI

Windows 桌面应用：登录后开面，实时听题（系统环回 + 麦克风）发到 AurisAIApi。闲聊和出答都走账户接口，本机不保存生成密钥。

仅支持 Windows。

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

后端默认 `http://127.0.0.1:8089`。在 **设置** 中填写接口 / 开面 WebSocket 地址。生成密钥只在服务端配置。

设置保存在本机 `%APPDATA%\com.jghooo.aurisai\settings.json`，不会打进安装包。

## 使用

1. 用邮箱登录（与网站同一账户）。
2. 在「我的」填写简历和 JD。
3. 打开腾讯会议 / Zoom 等，点 **开始面试**，对方说话时出字。
4. 听题区「出答本题」或手输问题生成本场短答。下方输入框是闲聊，不是出答。

## 打包给他人

```bash
npm run tauri build
```

安装包在 `src-tauri/target/release/bundle/nsis/`。生成密钥由平台配置，用户不用填。

## 合规

仅用于你自己参加的面试。开面时界面有「面试进行中」提示；请遵守当地法律与对方知情同意要求。

## 技术栈

- Tauri 2 + React + TypeScript
- WASAPI 环回 / 麦克风采集（`wasapi`）
- AurisAIApi 实时听题（阿里云 NLS）
- AurisAIApi 账户闲聊与本场出答（平台代生成）
