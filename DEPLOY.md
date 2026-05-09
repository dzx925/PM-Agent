# PM Agent 部署指南

## 部署架构

- **前端**: GitHub Pages (免费)
- **后端**: Render (免费)

---

## 前提条件

1. GitHub 账号
2. Render 账号（使用 GitHub 登录）
3. SiliconFlow API Key（从 https://siliconflow.cn 获取）

---

## 第一步：创建 GitHub 仓库

1. 访问 https://github.com/new
2. 创建仓库 `PM-Agent`
3. 选择 **Public**
4. 不要初始化 README

---

## 第二步：推送代码到 GitHub

```bash
cd /path/to/PM-Agent

# 初始化仓库
git init

# 添加文件
git add .

# 提交
git commit -m "Initial commit: PM Agent"

# 添加远程仓库（替换为你的用户名）
git remote add origin https://github.com/你的用户名/PM-Agent.git

# 推送
git push -u origin main
```

---

## 第三步：部署后端到 Render

1. 访问 https://dashboard.render.com/
2. 点击 **New +** → **Web Service**
3. 选择 **Build and deploy from a Git repository**
4. 连接你的 GitHub 账号，选择 `PM-Agent` 仓库
5. 配置：
   - **Name**: `pm-agent-api`
   - **Runtime**: `Node`
   - **Build Command**: `npm install`
   - **Start Command**: `node index.js`
   - **Plan**: `Free`

6. 添加环境变量：
   - 点击 **Advanced** → **Add Environment Variable**
   - **Key**: `SILICONFLOW_API_KEY`
   - **Value**: 你的 SiliconFlow API Key

7. 点击 **Create Web Service**

---

## 第四步：部署前端到 GitHub Pages

1. 进入仓库 Settings → Pages
2. **Source**: Deploy from a branch
3. **Branch**: `main` / `root`
4. 点击 **Save**

等待几分钟，访问 `https://你的用户名.github.io/PM-Agent/`

---

## 部署后配置

### 1. 更新前端 API 地址

如果 Render 分配的域名不是 `pm-agent-api.onrender.com`：

编辑 `index.js` 中的 CORS 配置：
```javascript
app.use(cors({
    origin: ['https://你的用户名.github.io', 'http://localhost:3000']
}));
```

然后提交推送：
```bash
git add index.js
git commit -m "Update CORS origin"
git push
```

### 2. 验证部署

1. 访问前端页面 `https://你的用户名.github.io/PM-Agent/`
2. 打开浏览器开发者工具 (F12)
3. 输入业务场景，点击生成
4. 查看 Console 是否有输出
5. 查看 Network 标签，确认 `/generate` 请求正常

---

## 故障排除

### 后端启动失败
- 检查 Render 日志
- 确认 `SILICONFLOW_API_KEY` 已设置
- 确认 `npm install` 成功执行

### 前端无法连接后端
- 检查 CORS 配置
- 确认 API 地址正确
- 检查 Render 服务是否运行

### 模型调用失败
- 检查 SiliconFlow API Key 是否有效
- 检查模型是否开始收费（错误提示会告知）
- 检查 `utils/model-router.js` 中的模型列表

---

## 免费额度

| 服务 | 限制 |
|------|------|
| Render | 每月 750 小时，15 分钟无活动休眠 |
| GitHub Pages | 每月 100GB 带宽 |
| SiliconFlow | 免费模型：GLM-4-9B、Qwen3-8B |

---

## 一键部署脚本

使用已有的 `deploy.sh`：

```bash
chmod +x deploy.sh
./deploy.sh
```

或手动推送：
```bash
git add .
git commit -m "Deploy: $(date)"
git push origin main
```

---

部署完成后告诉我，我可以帮你验证！
