# PM Agent Web

PM 全流程自动化工具 - 输入业务场景，自动生成 ToB 原型 + PRD。

## 项目结构

```
pm-agent-web/
├── frontend/          # GitHub Pages 前端
│   ├── index.html     # 主页面
│   ├── style.css      # 样式
│   └── app.js         # 交互逻辑
├── backend/           # Render 后端
│   ├── index.js       # Express 服务
│   ├── package.json   # 依赖配置
│   └── README.md      # 后端部署说明
└── README.md          # 本文件
```

## 快速部署指南

### 第一步：部署后端（Render）

1. 创建 GitHub 仓库 `pm-agent-backend`
2. 将 `backend/` 目录内容推送到该仓库
3. 登录 [render.com](https://render.com) → New Web Service
4. 选择仓库，配置：
   - Runtime: Node
   - Build: `npm install`
   - Start: `npm start`
5. 添加环境变量 `OPENAI_API_KEY`
6. 部署，记录 URL（如 `https://pm-agent-api.onrender.com`）

详细步骤见 [backend/README.md](./backend/README.md)

### 第二步：部署前端（GitHub Pages）

1. 修改 `frontend/app.js` 中的 API 地址：
   ```javascript
   const API_BASE_URL = 'https://你的-render-地址';
   ```

2. 创建 GitHub 仓库 `pm-agent-frontend`
3. 将 `frontend/` 目录内容推送到该仓库
4. 开启 GitHub Pages：
   - Settings → Pages → Source: Deploy from a branch
   - Branch: main / root
5. 访问 `https://你的用户名.github.io/pm-agent-frontend`

### 第三步：使用

1. 打开前端页面
2. 输入业务场景（如"帮我做一个客户管理CRM系统"）
3. 点击"开始生成"
4. 等待 30-60 秒，查看结果
5. 下载 HTML 原型和 Markdown PRD

## 技术栈

| 组件 | 技术 | 部署平台 |
|------|------|---------|
| 前端 | 原生 HTML/CSS/JS | GitHub Pages |
| 后端 | Node.js + Express | Render |
| AI | OpenAI GPT-4o | - |
| Skill | GitHub Raw | GitHub |

## 费用

| 项目 | 费用 |
|------|------|
| GitHub Pages | 免费 |
| Render | 免费（750小时/月）|
| OpenAI API | 按调用量付费 |

## 注意事项

1. **Render 冷启动**：免费版 15 分钟无访问会休眠，首次请求可能慢
2. **API Key 安全**：务必在 Render 环境变量中配置，不要泄露
3. **Skill 更新**：修改 GitHub 上的 SKILL.md 后，重启 Render 服务生效

## 自定义

### 修改 Skill

直接修改你的 GitHub 仓库：
- https://github.com/dzx925/prototype-skill
- https://github.com/dzx925/pm-prd-skills

### 更换 AI 模型

修改 `backend/index.js` 中的 `model` 参数：
```javascript
model: 'gpt-4o',  // 可改为 gpt-4o-mini, gpt-4 等
```

### 添加密码保护

在 `backend/index.js` 中添加简单的 API Key 验证：
```javascript
const apiKey = req.headers['x-api-key'];
if (apiKey !== process.env.API_KEY) {
  return res.status(401).json({ error: 'Unauthorized' });
}
```

## 问题排查

| 问题 | 解决方案 |
|------|---------|
| 生成失败 | 检查 Render 日志，确认 OpenAI API Key 有效 |
| 页面空白 | 检查浏览器控制台，确认 API 地址正确 |
| 跨域错误 | 确认后端 CORS 配置正确 |
| Skill 未更新 | 重启 Render 服务，清除缓存 |

## 许可证

MIT
