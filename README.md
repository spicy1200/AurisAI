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

「我的」里的套餐购买、联系客服、帮助会用系统浏览器打开官网。`npm run tauri dev` 默认 `http://localhost:5173`（需先启动 AurisAIWeb），安装包默认生产站点（`.env.production` 的 `VITE_WEB_BASE`）。

设置保存在本机 `%APPDATA%\com.jghooo.aurisai\settings.json`，不会打进安装包。

## 使用

1. 用邮箱登录（与网站同一账户）。
2. 在「我的」填写简历和 JD。
3. 打开腾讯会议 / Zoom 等，点 **开始面试**，对方说话时出字。
4. 听题区「出答本题」或手输问题生成本场短答。下方输入框是闲聊，不是出答。

## 打包给他人

### 本地打包

```bash
npm run tauri build
```

安装包在 `src-tauri/target/release/bundle/nsis/`。生成密钥由平台配置，用户不用填。

### GitHub Actions 发版（推荐）

1. 将 `package.json`、`src-tauri/tauri.conf.json`、`src-tauri/Cargo.toml` 中的版本号改成一致（例如 `0.1.0`），提交并推送。
2. 打 tag 并推送：

```bash
git tag v0.1.0
git push origin v0.1.0
```

3. 在仓库 **Actions** 查看 `Release Windows` 工作流；完成后到 **Releases** 下载 `AurisAI_*_x64-setup.exe`。

也可在 Actions 里手动运行该工作流，并填写已有 tag（例如 `v0.1.0`）重打安装包。

当前安装包**未做代码签名**，首次运行可能被 Windows SmartScreen 拦截，选择「仍要运行」即可。

## 合规

仅用于你自己参加的面试。开面时界面有「面试进行中」提示；请遵守当地法律与对方知情同意要求。

## 技术栈

- Tauri 2 + React + TypeScript
- WASAPI 环回 / 麦克风采集（`wasapi`）
- AurisAIApi 实时听题（阿里云 NLS）
- AurisAIApi 账户闲聊与本场出答（平台代生成）
