# PM Agent

PM 全流程自动化工具 - 输入业务场景，自动生成 ToB 原型 + PRD。

## 项目结构

```
PM-Agent/
├── AGENT.md              # Agent 配置和工作流程
├── index.html            # 主页面（GitHub Pages 前端）
├── chat-index.html       # 聊天式交互页面
├── index.js              # Express 后端服务
├── chat-server.js        # WebSocket 聊天服务
├── app-v2.js             # 前端交互逻辑 v2
├── chat-app.js           # 聊天页面交互逻辑
├── style.css             # 样式文件
├── chat-style.css        # 聊天页面样式
├── utils/
│   └── model-router.js   # SiliconFlow 模型路由工具
├── package.json          # 依赖配置
├── deploy.sh             # 部署脚本
├── DEPLOY.md             # 部署指南
└── README.md             # 本文件
```

## 快速开始

### 方式一：本地运行

```bash
# 1. 克隆仓库
git clone https://github.com/dzx925/PM-Agent.git
cd PM-Agent

# 2. 安装依赖
npm install

# 3. 设置环境变量
export SILICONFLOW_API_KEY="your-api-key"

# 4. 启动服务
node index.js

# 5. 打开 http://localhost:3000
```

### 方式二：部署到 Render + GitHub Pages

详见 [DEPLOY.md](./DEPLOY.md)

## 使用说明

1. 打开页面（本地或 GitHub Pages）
2. 输入业务场景（如"帮我做一个客户管理CRM系统"）
3. 点击"开始生成"
4. 等待生成完成，查看结果
5. 下载 HTML 原型和 Markdown PRD

## 技术栈

| 组件 | 技术 | 部署平台 |
|------|------|---------|
| 前端 | 原生 HTML/CSS/JS | GitHub Pages |
| 后端 | Node.js + Express | Render |
| AI | SiliconFlow API (GLM-4-9B / Qwen3-8B) | - |
| Skill | GitHub Raw | GitHub |

## 费用

| 项目 | 费用 |
|------|------|
| GitHub Pages | 免费 |
| Render | 免费（750小时/月）|
| SiliconFlow | 免费模型（GLM-4-9B、Qwen3-8B）|

## 环境变量

| 变量名 | 说明 | 必需 |
|--------|------|------|
| `SILICONFLOW_API_KEY` | SiliconFlow API Key | 是 |
| `GITHUB_ACTIONS` | 自动识别 GitHub 环境 | 否 |

## 模型路由说明

本项目使用 `utils/model-router.js` 自动管理模型调用：

- **本地/Trae 环境**：直接使用默认模型
- **GitHub Actions 环境**：自动在免费模型间切换（GLM-4-9B → Qwen3-8B）
- **模型失效时**：自动提示检查模型是否开始收费

## Skill 仓库

- [prototype-skill](https://github.com/dzx925/prototype-skill) - 原型生成 Skill
- [pm-prd-skills](https://github.com/dzx925/pm-prd-skills) - PRD 生成相关 Skills

## 自定义

### 更换 AI 模型

修改 `utils/model-router.js` 中的模型列表：
```javascript
this.models = [
  { id: 'THUDM/GLM-4-9B-0414', name: 'GLM-4-9B' },
  { id: 'Qwen/Qwen3-8B', name: 'Qwen3-8B' }
];
```

### 修改 Skill

直接修改你的 GitHub Skill 仓库，修改后重启服务生效。

## 问题排查

| 问题 | 解决方案 |
|------|---------|
| 生成失败 | 检查日志，确认 `SILICONFLOW_API_KEY` 有效 |
| 模型调用失败 | 检查模型是否开始收费，或更换其他免费模型 |
| 页面空白 | 检查浏览器控制台，确认 API 地址正确 |
| 跨域错误 | 确认后端 CORS 配置正确 |
| Skill 未更新 | 重启服务，清除缓存 |

## 许可证

MIT
