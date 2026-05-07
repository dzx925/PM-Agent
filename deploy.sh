#!/bin/bash

# PM Agent Web 一键部署脚本
# 使用方法: ./deploy.sh

echo "========================================"
echo "  PM Agent Web 部署脚本"
echo "========================================"
echo ""

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# 检查命令是否存在
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 检查必要工具
echo "检查必要工具..."
if ! command_exists git; then
    echo -e "${RED}错误: 未安装 git${NC}"
    exit 1
fi

echo -e "${GREEN}✓ git 已安装${NC}"
echo ""

# 获取用户输入
echo "请输入以下信息:"
echo ""

read -p "你的 GitHub 用户名: " GITHUB_USERNAME
read -p "后端仓库名称 (默认: pm-agent-backend): " BACKEND_REPO
BACKEND_REPO=${BACKEND_REPO:-pm-agent-backend}

read -p "前端仓库名称 (默认: pm-agent-frontend): " FRONTEND_REPO
FRONTEND_REPO=${FRONTEND_REPO:-pm-agent-frontend}

echo ""
echo "========================================"
echo "  部署后端到 GitHub"
echo "========================================"
echo ""

# 部署后端
cd backend

if [ -d ".git" ]; then
    echo "后端目录已有 git 仓库，跳过初始化"
else
    echo "初始化后端 git 仓库..."
    git init
    git add .
    git commit -m "Initial commit"
fi

# 检查远程仓库
if git remote | grep -q "origin"; then
    echo "远程仓库已存在，更新 URL..."
    git remote set-url origin "https://github.com/$GITHUB_USERNAME/$BACKEND_REPO.git"
else
    echo "添加远程仓库..."
    git remote add origin "https://github.com/$GITHUB_USERNAME/$BACKEND_REPO.git"
fi

echo ""
echo -e "${YELLOW}请先在 GitHub 创建仓库: $BACKEND_REPO${NC}"
echo -e "${YELLOW}创建后按回车继续...${NC}"
read

echo "推送后端代码..."
git push -u origin main || git push -u origin master

echo ""
echo -e "${GREEN}✓ 后端代码已推送到 GitHub${NC}"
echo ""

cd ..

# 修改前端 API 地址
echo "========================================"
echo "  配置前端 API 地址"
echo "========================================"
echo ""

read -p "你的 Render 后端地址 (如 https://pm-agent-api.onrender.com): " API_URL

# 更新前端 API 地址
sed -i.bak "s|const API_BASE_URL = '.*';|const API_BASE_URL = '$API_URL';|" frontend/app.js
rm frontend/app.js.bak

echo -e "${GREEN}✓ 前端 API 地址已更新${NC}"
echo ""

# 部署前端
echo "========================================"
echo "  部署前端到 GitHub"
echo "========================================"
echo ""

cd frontend

if [ -d ".git" ]; then
    echo "前端目录已有 git 仓库，跳过初始化"
else
    echo "初始化前端 git 仓库..."
    git init
    git add .
    git commit -m "Initial commit"
fi

# 检查远程仓库
if git remote | grep -q "origin"; then
    echo "远程仓库已存在，更新 URL..."
    git remote set-url origin "https://github.com/$GITHUB_USERNAME/$FRONTEND_REPO.git"
else
    echo "添加远程仓库..."
    git remote add origin "https://github.com/$GITHUB_USERNAME/$FRONTEND_REPO.git"
fi

echo ""
echo -e "${YELLOW}请先在 GitHub 创建仓库: $FRONTEND_REPO${NC}"
echo -e "${YELLOW}创建后按回车继续...${NC}"
read

echo "推送前端代码..."
git push -u origin main || git push -u origin master

echo ""
echo -e "${GREEN}✓ 前端代码已推送到 GitHub${NC}"
echo ""

cd ..

# 完成
echo "========================================"
echo "  部署完成!"
echo "========================================"
echo ""
echo -e "${GREEN}后端仓库: https://github.com/$GITHUB_USERNAME/$BACKEND_REPO${NC}"
echo -e "${GREEN}前端仓库: https://github.com/$GITHUB_USERNAME/$FRONTEND_REPO${NC}"
echo ""
echo "下一步:"
echo "1. 在 Render 部署后端 (https://render.com)"
echo "2. 在 GitHub Pages 开启前端部署"
echo "3. 配置 OpenAI API Key"
echo ""
echo "详细步骤见 README.md"
echo ""
