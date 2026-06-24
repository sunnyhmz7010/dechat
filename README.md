# DeChat

去中心化端到端加密聊天应用。零服务器依赖，消息只存在于浏览器内存/本地加密存储。

## 特性

- **Signal Protocol** - X3DH 密钥协商 + Double Ratchet 消息加密
- **WebRTC P2P** - 浏览器间直连通信，无服务器中转
- **阅后即焚** - 三种计时模式（发送后/阅读后/操作后），可撤销，碎裂动画
- **加密存储** - 普通消息 AES-256-GCM 加密后存入 IndexedDB
- **可选密码** - PBKDF2 密钥派生，12 词中文恢复短语
- **恐慌按钮** - Esc×3 一键销毁所有数据
- **二维码** - 连接码可生成二维码，方便面对面扫码连接
- **NAT 穿透** - 可选配置 STUN/TURN 服务器

## 快速开始

```bash
# 构建 WASM
build.bat

# 启动本地服务器
cd web
npx serve .
```

## 技术栈

| 组件 | 技术 |
|------|------|
| 加密引擎 | Rust → WASM (wasm-pack) |
| 加密算法 | X25519 + Ed25519 + AES-256-GCM + HKDF |
| P2P 通信 | WebRTC DataChannel |
| 本地存储 | IndexedDB (AES-256-GCM 加密) |
| 前端 | 纯 HTML/CSS/JS |

## 部署

本项目是纯静态应用，`web/` 目录可部署到任何静态托管服务：

- GitHub Pages
- Cloudflare Pages
- Netlify
- 任何 HTTP 服务器

## 安全模型

| 威胁 | 防御 |
|------|------|
| 窃听 | Signal Protocol E2E 加密 |
| 中间人 | 用户手动验证连接码指纹 |
| 前向保密 | Double Ratchet 每条消息换密钥 |
| 消息留存 | 仅内存 + 阅后即焚 |
| 设备被缴 | 恐慌按钮一键销毁 |
| 密钥泄露 | IndexedDB 加密存储 |
