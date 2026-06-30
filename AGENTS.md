# AGENTS.md

## 项目概况

| 维度 | 内容 |
|------|------|
| 产品定位 | 去中心化端到端加密聊天应用，零服务器依赖 |
| 核心协议 | Signal Protocol（X3DH + Double Ratchet） |
| 通信方式 | WebRTC P2P 直连 |
| 存储模式 | 仅内存 + IndexedDB 加密存储 |

### 技术栈

| 层级 | 技术 |
|------|------|
| 加密引擎 | Rust → WASM (wasm-pack) |
| 加密算法 | X25519 + Ed25519 + AES-256-GCM + HKDF |
| P2P 通信 | WebRTC DataChannel |
| 本地存储 | IndexedDB (AES-256-GCM 加密) |
| 前端 | 纯 HTML/CSS/JS |

### 关键路径

| 目录 | 用途 |
|------|------|
| `crates/dechat-core` | Rust 核心加密逻辑 |
| `crates/dechat-wasm` | WASM 绑定层 |
| `web/` | 前端静态资源 |

## 架构约束

### 安全模型

| 威胁 | 防御机制 |
|------|----------|
| 窃听 | Signal Protocol E2E 加密 |
| 中间人 | 用户手动验证连接码指纹 |
| 前向保密 | Double Ratchet 每条消息换密钥 |
| 消息留存 | 仅内存 + 阅后即焚 |
| 设备被缴 | 恐慌按钮（Esc×3）一键销毁 |
| 密钥泄露 | IndexedDB 加密存储 |

### 产品约束

- 纯静态应用，`web/` 目录可部署到任何静态托管服务
- 不依赖后端服务器，所有通信 P2P 直连
- 消息仅存在于浏览器内存/本地加密存储

## 开发规范

### 命令速查

| 场景 | 命令 |
|------|------|
| 构建 WASM | `build.bat` |
| 启动本地服务器 | `cd web && npx serve .` |

### 部署

支持部署到：
- GitHub Pages
- Cloudflare Pages
- Netlify
- 任何 HTTP 服务器
