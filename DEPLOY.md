# PM Agent Web 部署指南

## 部署架构

- **前端**: GitHub Pages (免费)
- **后端**: Render (免费)

---

## 第一步：创建 GitHub 仓库

1. 访问 https://github.com/new
2. 创建仓库 `pm-agent-web`
3. 选择 **Public**
4. 不要初始化 README

---

## 第二步：推送代码到 GitHub

```bash
cd /Users/daizhuoxin/Desktop/Agent/pm-auto-agent/pm-agent-web

# 初始化仓库
git init

# 添加文件
git add .

# 提交
git commit -m "Initial commit: PM Agent with SSE progress"

# 添加远程仓库（替换为你的用户名）
git remote add origin https://github.com/dzx925/pm-agent-web.git

# 推送
git push -u origin main
```

---

## 第三步：部署后端到 Render

1. 访问 https://dashboard.render.com/
2. 点击 **New +** → **Web Service**
3. 选择 **Build and deploy from a Git repository**
4. 连接你的 GitHub 账号，选择 `pm-agent-web` 仓库
5. 配置：
   - **Name**: `pm-agent-api`
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
   - **Plan**: `Free`

6. 添加环境变量：
   - 点击 **Advanced** → **Add Environment Variable**
   - **Key**: `OPENAI_API_KEY`
   - **Value**: 你的 OpenAI API Key

7. 点击 **Create Web Service**

---

## 第四步：部署前端到 GitHub Pages

1. 进入仓库 Settings → Pages
2. **Source**: Deploy from a branch
3. **Branch**: `main` / `frontend` (folder)
4. 点击 **Save**

等待几分钟，访问 `https://dzx925.github.io/pm-agent-web/`

---

## 部署后配置

### 1. 更新前端 API 地址

如果 Render 分配的域名不是 `pm-agent-api.onrender.com`：

编辑 `frontend/app.js` 第一行：
```javascript
const API_BASE_URL = 'https://你的-render-域名.onrender.com';
```

然后提交推送：
```bash
git add frontend/app.js
git commit -m "Update API URL"
git push
```

### 2. CORS 配置

后端已经配置好 CORS，允许所有域名访问。如果需要限制：

编辑 `backend/index.js`：
```javascript
app.use(cors({
    origin: ['https://dzx925.github.io', 'http://localhost:8080']
}));
```

---

## 验证部署

1. 访问前端页面
2. 打开浏览器开发者工具 (F12)
3. 输入业务场景，点击生成
4. 查看 Console 是否有 SSE 事件输出
5. 查看 Network 标签，确认 `/generate` 请求返回流式数据

---

## 故障排除

### 后端启动失败
- 检查 Render 日志
- 确认 `OPENAI_API_KEY` 已设置

### 前端无法连接后端
- 检查 CORS 配置
- 确认 API 地址正确
- 检查 Render 服务是否运行

### SSE 不工作
- 确认后端返回 `Content-Type: text/event-stream`
- 检查是否有代理或防火墙拦截

---

## 免费额度

| 服务 | 限制 |
|------|------|
| Render | 每月 750 小时，15 分钟无活动休眠 |
| GitHub Pages | 每月 100GB 带宽 |
| OpenAI API | 按使用量付费 |

---

## 一键部署脚本（可选）

创建 `deploy.sh`：

```bash
#!/bin/bash
echo "推送到 GitHub..."
git add .
git commit -m "Deploy: $(date)"
git push origin main
echo "完成！Render 会自动部署后端。"
echo "前端地址: https://dzx925.github.io/pm-agent-web/"
```

---

部署完成后告诉我，我可以帮你验证！
