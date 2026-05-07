# PM Agent 后端服务

部署到 Render 的 Node.js 后端服务，提供原型和 PRD 生成 API。

## 部署步骤

### 1. 推送代码到 GitHub

```bash
cd backend
git init
git add .
git commit -m "Initial commit"
git remote add origin https://github.com/你的用户名/pm-agent-backend.git
git push -u origin main
```

### 2. 在 Render 创建服务

1. 登录 [render.com](https://render.com)
2. 点击 **New +** → **Web Service**
3. 选择你的 GitHub 仓库
4. 配置如下：

| 配置项 | 值 |
|--------|-----|
| Name | pm-agent-api |
| Runtime | Node |
| Build Command | `npm install` |
| Start Command | `npm start` |
| Plan | Free |

### 3. 配置环境变量

在 Render Dashboard → 你的服务 → Environment 中添加：

```
OPENAI_API_KEY=你的OpenAI API Key
```

### 4. 部署

点击 **Deploy**，等待部署完成。

部署成功后，会获得一个 URL：
```
https://pm-agent-api.onrender.com
```

### 5. 验证部署

访问健康检查接口：
```
https://pm-agent-api.onrender.com/health
```

应该返回：
```json
{
  "status": "ok",
  "timestamp": "...",
  "cache": {
    "prototype": "loaded",
    "prd": "loaded"
  }
}
```

## API 文档

### POST /generate

生成原型和 PRD。

**请求体：**
```json
{
  "scene": "帮我做一个客户管理CRM系统"
}
```

**响应：**
```json
{
  "html": "<html>...</html>",
  "prd": "# PRD 标题..."
}
```

### GET /health

健康检查。

## 注意事项

1. **冷启动**：Render 免费版 15 分钟无访问会休眠，首次请求可能需要 30 秒唤醒
2. **API Key**：务必在环境变量中配置，不要硬编码
3. **Skill 更新**：修改 GitHub 上的 SKILL.md 后，重启 Render 服务即可生效
