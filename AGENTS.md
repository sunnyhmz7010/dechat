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
| 压缩 | pako (zlib) |
| 编码 | Base62 |

### 关键路径

| 目录 | 用途 |
|------|------|
| `crates/sealedchat-core` | Rust 核心加密逻辑 |
| `crates/sealedchat-wasm` | WASM 绑定层 |
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
| 运行 Rust 测试 | `cargo test` |
| 检查代码 | `cargo clippy` |
| 格式化代码 | `cargo fmt` |

### 测试与验证

| 场景 | 命令 |
|------|------|
| Rust 单元测试 | `cargo test` |
| WASM 构建测试 | `wasm-pack build --target web` |

### 部署

支持部署到：
- GitHub Pages
- Cloudflare Pages
- Netlify
- 任何 HTTP 服务器

### 发布流程

1. 更新版本号 (Cargo.toml)
2. 运行 `cargo test` 确保通过
3. 提交并推送
4. 创建 GitHub Release

### 代码规范

- 使用中文注释
- 遵循 Rust 风格指南
- 提交信息使用中文

## 后续开发计划

| 阶段 | 功能 | 优先级 |
|------|------|--------|
| **Phase 1** | 项目改名 + 房间机制 + 文档 | ✅ 已完成 |
| **Phase 2** | 多人聊天（3-5 人 Full Mesh） | 高 |
| **Phase 3** | 暗色/亮色主题 | 中 |
| **Phase 4** | 消息回填 | 中 |
| **Phase 5** | 多人音视频通话 | 中 |

### Phase 2：多人聊天

- 实现 Full Mesh 连接管理
- 房间创建者作为协调者
- 消息广播给所有 peer
- 更新 UI 显示在线成员

### Phase 3：暗色/亮色主题

- 定义 CSS 变量（颜色系统）
- 实现主题切换按钮
- 保存用户偏好

### Phase 4：消息回填

- 新 peer 加入时请求历史消息
- 现有 peer 响应历史消息请求
- 消息合并去重

### Phase 5：多人音视频通话

- 实现 WebRTC 音视频流
- 实现 Mesh 音视频连接
- 添加音视频 UI
- 实现通话控制
- 实现屏幕共享
