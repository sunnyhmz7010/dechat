# AGENTS.md

## 项目概况

| 维度 | 内容 |
|------|------|
| 产品定位 | 去中心化端到端加密聊天应用，零服务器依赖 |
| 核心协议 | Signal Protocol（X3DH + Double Ratchet） |
| 通信方式 | WebRTC P2P 直连 |
| 存储模式 | 仅内存 + IndexedDB 加密存储 |
| 当前稳定版本 | 尚未发布 |

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

| 用途 | 路径 |
|------|------|
| Rust 核心加密逻辑 | `crates/sealedchat-core/src/` |
| WASM 绑定层 | `crates/sealedchat-wasm/src/` |
| 前端静态资源 | `web/` |
| 主应用逻辑 | `web/js/app.js` |
| 房间机制 | `web/js/room.js` |
| 加密存储 | `web/js/storage.js` |
| 版本号 | `Cargo.toml` (workspace root) |
| 构建脚本 | `build.bat` |

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
- 房间码包含完整 WebRTC offer/answer，经过 pako 压缩 + Base62 编码
- 多人聊天采用 Full Mesh 拓扑，每对 peer 独立建立 P2P 连接

### 信令约束

- 房间码是唯一的"信令"机制，不依赖信令服务器
- 房间码通过带外方式（复制粘贴）交换
- ICE Candidate 必须在生成房间码前收集完毕

## 开发规范

### 命令速查

| 场景 | 命令 |
|------|------|
| 构建 WASM | `build.bat` |
| 启动本地服务器 | `cd web && npx serve .` |
| 运行 Rust 测试 | `cargo test` |
| 检查代码 | `cargo clippy` |
| 格式化代码 | `cargo fmt` |

### 环境约束

- Rust 1.70+
- wasm-pack
- Node.js 18+
- 现代浏览器（支持 WebRTC）

### 测试与验证

| 场景 | 命令 |
|------|------|
| Rust 单元测试 | `cargo test` |
| WASM 构建测试 | `wasm-pack build --target web` |

### 依赖管理

- `Cargo.toml` 定义 workspace 成员，不要随意添加新 crate
- 前端依赖通过 CDN 或本地文件引入，不使用 npm 管理
- `pako` 和 `qrcode` 以 minified JS 文件形式存放在 `web/js/`

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
- 前端代码不使用框架，保持纯 HTML/CSS/JS

## 版本历史

### 版本标签格式

| 类型 | 格式 |
|------|------|
| 稳定版 | `v0.1.0` |
| 预发布 | `v0.1.1-beta.1` |

### 发布流程

1. 更新 `Cargo.toml` 中的版本号
2. 运行 `cargo test` 确保通过
3. 运行 `build.bat` 确保 WASM 构建成功
4. 提交并推送
5. 创建 GitHub Release（标题使用纯标签名，如 `v0.1.0`）

### 发布检查清单

发布时需同步更新：
- `Cargo.toml` 版本号（workspace 下各 crate）
- `README.md`（如功能描述、截图或 URL 有变）

### README 同步规则

- 核心功能变更时，更新「核心能力」和「功能细节」章节
- 安全模型变更时，更新「安全模型」表格
- 技术栈变更时，更新「技术栈」和「项目结构」章节

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
