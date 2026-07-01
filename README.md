<div align="center">
  <h1>SealedChat</h1>
  <p>基于 WebRTC 和 Signal Protocol 的去中心化加密聊天应用，无需服务器即可安全通信</p>
</div>

<p align="center">
  <a href="https://github.com/sunnyhmz7010/SealedChat/releases"><img src="https://img.shields.io/github/v/release/sunnyhmz7010/SealedChat?label=Release&color=3b82f6" alt="Release" /></a>
  <a href="https://github.com/sunnyhmz7010/SealedChat/blob/main/LICENSE"><img src="https://img.shields.io/github/license/sunnyhmz7010/SealedChat?color=10b981" alt="License" /></a>
</p>

<p align="center">
  <a href="https://sunnyhmz7010.github.io/sealedchat/">在线预览</a> ·
  <a href="https://github.com/sunnyhmz7010/SealedChat/issues">反馈问题</a> ·
  <a href="https://github.com/sunnyhmz7010/SealedChat">下载源码</a>
</p>

---

## ✨ 为什么做这个应用

在数字时代，隐私聊天变得越来越重要。传统聊天应用依赖中心服务器，存在数据泄露和监控风险。SealedChat 通过以下方式解决这些痛点：

- **零服务器依赖**：所有通信通过 WebRTC P2P 直连，无需信任第三方
- **Signal Protocol**：采用业界最强的端到端加密协议，确保消息安全
- **阅后即焚**：消息可设置自动销毁，防止数据残留
- **恐慌按钮**：紧急情况下一键销毁所有数据

## 🚀 核心能力

- **Signal Protocol E2E 加密**：X3DH 密钥协商 + Double Ratchet 消息加密
- **WebRTC P2P 直连**：浏览器间直接通信，无服务器中转
- **阅后即焚**：三种计时模式（发送后/阅读后/操作后），可撤销，碎裂动画
- **加密存储**：普通消息 AES-256-GCM 加密后存入 IndexedDB
- **可选密码**：PBKDF2 密钥派生，12 词中文恢复短语
- **恐慌按钮**：Esc×3 一键销毁所有数据
- **房间机制**：创建房间生成房间码，其他人输入房间码即可加入
- **多人聊天**：支持 3-5 人 Full Mesh 聊天
- **NAT 穿透**：可选配置 STUN/TURN 服务器

## ⚡ 快速开始

```bash
# 克隆仓库
git clone https://github.com/sunnyhmz7010/sealedchat.git
cd sealedchat

# 构建 WASM
build.bat

# 启动本地服务器
cd web
npx serve .
```

## 📖 使用说明

### 📋 创建房间

1. 点击"创建房间"按钮
2. 系统生成房间码
3. 将房间码发送给对方
4. 等待对方加入

### 🔗 加入房间

1. 点击"加入房间"按钮
2. 输入对方提供的房间码
3. 点击"加入"
4. 连接建立

### 💬 发送消息

- 在输入框输入消息
- 点击发送或按 Enter 键
- 消息将通过 P2P 加密通道传输

### ⏱️ 阅后即焚

1. 点击时钟图标开启阅后即焚
2. 选择计时模式（发送后/阅读后/操作后）
3. 设置销毁时长
4. 发送消息

### 🚨 恐慌按钮

- 按 Esc 键 3 次快速销毁所有数据
- 或点击侧边栏的"销毁"按钮

## 🧠 功能细节

### 🔐 Signal Protocol 实现

SealedChat 完整实现了 Signal Protocol：

- **X3DH (Extended Triple Diffie-Hellman)**：密钥协商协议，确保前向保密
- **Double Ratchet**：消息加密算法，每条消息使用不同密钥
- **PreKey Bundle**：预密钥机制，支持离线消息

### 🛡️ 安全模型

| 威胁 | 防御机制 |
|------|----------|
| 窃听 | Signal Protocol E2E 加密 |
| 中间人 | 用户手动验证连接码指纹 |
| 前向保密 | Double Ratchet 每条消息换密钥 |
| 消息留存 | 仅内存 + 阅后即焚 |
| 设备被缴 | 恐慌按钮（Esc×3）一键销毁 |
| 密钥泄露 | IndexedDB 加密存储 |

### 🏠 房间机制

房间机制基于 WebRTC DataChannel 实现：

1. **创建房间**：生成包含 WebRTC offer 的房间码
2. **加入房间**：解析房间码，生成 WebRTC answer
3. **连接建立**：双方交换 SDP 和 ICE Candidate
4. **消息传输**：通过 DataChannel 直接传输

房间码经过压缩（pako）和 Base62 编码，长度约 200-300 字符。

## 🧱 技术栈

| 组件 | 技术 |
|------|------|
| 加密引擎 | Rust → WASM (wasm-pack) |
| 加密算法 | X25519 + Ed25519 + AES-256-GCM + HKDF |
| P2P 通信 | WebRTC DataChannel |
| 本地存储 | IndexedDB (AES-256-GCM 加密) |
| 前端 | 纯 HTML/CSS/JS |
| 压缩 | pako (zlib) |
| 编码 | Base62 |

## 🗂️ 项目结构

```
sealedchat/
├── .github/
│   └── workflows/
│       └── deploy.yml          # GitHub Actions 部署配置
├── crates/
│   ├── sealedchat-core/        # Rust 核心加密逻辑
│   │   └── src/
│   │       ├── lib.rs
│   │       ├── keys.rs         # 密钥管理
│   │       ├── message.rs      # 消息结构
│   │       ├── session.rs      # 会话管理
│   │       └── signal.rs       # Signal Protocol 实现
│   └── sealedchat-wasm/        # WASM 绑定层
│       └── src/
│           └── lib.rs
├── web/                        # 前端静态资源
│   ├── css/
│   │   └── style.css
│   ├── js/
│   │   ├── app.js              # 主应用逻辑
│   │   ├── storage.js          # 加密存储
│   │   ├── password.js         # 密码管理
│   │   ├── encoding.js         # Base62 编码
│   │   ├── room.js             # 房间机制
│   │   ├── pako.min.js         # 压缩库
│   │   └── qrcode.min.js       # 二维码库
│   ├── index.html
│   ├── manifest.json
│   └── sw.js                   # Service Worker
├── build.bat                   # WASM 构建脚本
├── Cargo.toml                  # Rust 工作区配置
├── AGENTS.md                   # 项目开发规范
└── README.md                   # 项目说明
```

## 👨‍💻 本地开发

### 🧰 环境要求

- Rust 1.70+
- wasm-pack
- Node.js 18+
- 现代浏览器（支持 WebRTC）

### 🔨 开发命令

```bash
# 构建 WASM
build.bat

# 启动本地服务器
cd web && npx serve .

# 运行 Rust 测试
cargo test

# 检查代码
cargo clippy

# 格式化代码
cargo fmt
```

### 🚀 部署

本项目是纯静态应用，`web/` 目录可部署到任何静态托管服务：

- GitHub Pages
- Cloudflare Pages
- Netlify
- 任何 HTTP 服务器

## 🔐 安全报告

如果发现安全问题，请不要公开披露细节。请优先参考仓库中的 [SECURITY.md](./SECURITY.md) 提交安全报告。

## 📄 许可证

本项目基于 [GPL-3.0](./LICENSE) 开源。

## ⭐ 星标历史

[![Star History Chart](https://api.star-history.com/svg?repos=sunnyhmz7010/sealedchat&type=Date)](https://star-history.com/#sunnyhmz7010/sealedchat&Date)

<div align="center"><sub>Built with ❤️ by Sunny</sub></div>
