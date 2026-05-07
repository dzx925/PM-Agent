const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件 - CORS 配置（允许所有来源）
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// Skill 文件 URL
const SKILL_URLS = {
  prototype: 'https://raw.githubusercontent.com/dzx925/prototype-skill/main/SKILL.md',
  prd: 'https://raw.githubusercontent.com/dzx925/pm-prd-skills/main/prototype-to-prd-orchestrator/SKILL.md'
};

// 缓存 Skill 内容
let skillCache = {
  prototype: null,
  prd: null,
  lastFetch: null
};

// 缓存有效期（1小时）
const CACHE_TTL = 60 * 60 * 1000;

/**
 * 获取 Skill 内容
 */
async function getSkillContent(type) {
  const now = Date.now();
  
  if (skillCache[type] && skillCache.lastFetch && (now - skillCache.lastFetch) < CACHE_TTL) {
    return skillCache[type];
  }
  
  try {
    const response = await axios.get(SKILL_URLS[type], {
      timeout: 10000,
      headers: { 'User-Agent': 'PM-Agent-Backend' }
    });
    
    skillCache[type] = response.data;
    skillCache.lastFetch = now;
    
    return response.data;
  } catch (error) {
    console.error(`获取 ${type} skill 失败:`, error.message);
    throw new Error(`无法加载 ${type} skill`);
  }
}

/**
 * 解析 Skill 工作流程步骤
 */
function parseSkillSteps(skillContent) {
  const steps = [];
  
  // 匹配 "## 工作流程" 部分
  const workflowMatch = skillContent.match(/## 工作流程[\s\S]*?(?=## |\n## |$)/);
  if (workflowMatch) {
    const workflowSection = workflowMatch[0];
    
    // 匹配编号列表项
    const stepRegex = /(\d+)\.\s*\*\*([^*]+)\*\*[:：]\s*(.+?)(?=\n\d+\.|\n## |$)/gs;
    let match;
    
    while ((match = stepRegex.exec(workflowSection)) !== null) {
      steps.push({
        number: parseInt(match[1]),
        title: match[2].trim(),
        description: match[3].trim().replace(/\n/g, ' ')
      });
    }
  }
  
  return steps;
}

/**
 * 调用 SiliconFlow API - 使用免费模型 Qwen2.5-7B-Instruct
 */
async function callSiliconFlow(systemPrompt, userPrompt, apiKey, onProgress = null) {
  const maxRetries = 2;
  const timeout = 180000; // 180秒超时
  
  // 免费模型：GLM-4-9B-0414（永久免费，智谱AI）
  const FREE_MODEL = 'THUDM/GLM-4-9B-0414';
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (onProgress) {
        onProgress(`AI生成中 (免费模型，尝试 ${attempt}/${maxRetries})...`);
      }
      
      const response = await axios.post(
        'https://api.siliconflow.cn/v1/chat/completions',
        {
          model: FREE_MODEL,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          temperature: 0.7,
          max_tokens: 4000
        },
        {
          headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
          },
          timeout: timeout
        }
      );
      
      return response.data.choices[0].message.content;
    } catch (error) {
      console.error(`API调用失败 (尝试 ${attempt}/${maxRetries}):`, error.message);
      
      // 详细记录错误信息
      if (error.response) {
        console.error('错误状态码:', error.response.status);
        console.error('错误详情:', error.response.data);
      }
      
      if (attempt === maxRetries) {
        // 返回更友好的错误信息
        if (error.response?.status === 403) {
          throw new Error('SiliconFlow API Key 无效或已过期，请检查环境变量 OPENAI_API_KEY');
        } else if (error.response?.status === 429) {
          throw new Error('API 请求过于频繁，请稍后再试（免费模型限制：RPM 100, RPS 3）');
        } else if (error.response?.status === 401) {
          throw new Error('API Key 未授权，请检查 SiliconFlow 账户状态');
        }
        throw error;
      }
      
      // 等待后重试
      await sleep(2000 * attempt);
    }
  }
}

/**
 * 发送 SSE 事件
 */
function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

/**
 * 生成 API - SSE 流式响应
 */
app.post('/generate', async (req, res) => {
  const { scene } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;
  
  if (!scene) {
    return res.status(400).json({ error: '请提供业务场景描述' });
  }
  
  if (!apiKey) {
    return res.status(500).json({ error: '服务器未配置 OpenAI API Key' });
  }
  
  // 设置 SSE 头
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  try {
    // 获取 Skill 内容
    sendSSE(res, { type: 'status', message: '加载 Skill 配置...' });
    
    const [prototypeSkill, prdSkill] = await Promise.all([
      getSkillContent('prototype'),
      getSkillContent('prd')
    ]);
    
    // 解析步骤
    const prototypeSteps = parseSkillSteps(prototypeSkill);
    const prdSteps = parseSkillSteps(prdSkill);
    
    console.log('原型步骤:', prototypeSteps.map(s => s.title));
    console.log('PRD步骤:', prdSteps.map(s => s.title));
    
    // 发送步骤信息
    sendSSE(res, { 
      type: 'steps', 
      prototypeSteps,
      prdSteps
    });
    
    // 阶段1: 原型生成（分批调用）
    sendSSE(res, { 
      type: 'phase', 
      phase: 'prototype', 
      name: '原型生成',
      skill: '原型-skill'
    });
    
    // 批次1: 业务理解 + 页面拆解 + 组件设计
    sendSSE(res, {
      type: 'progress',
      phase: 'prototype',
      step: 1,
      totalSteps: 6,
      stepData: { title: '业务分析中...', description: '理解业务场景、拆解页面、设计组件' },
      progress: 10,
      status: 'ai-generating'
    });
    
    const batch1Prompt = `业务场景：${scene}\n\n请分析上述业务场景，完成以下步骤：\n1. 业务理解：提炼目标用户、核心价值、主流程\n2. 页面拆解：确定所需页面/弹窗（列表页、详情页、表单页等）\n3. 组件设计：定义关键字段、控件、校验规则\n\n请用结构化方式输出分析结果。`;
    
    const batch1Result = await callSiliconFlow(prototypeSkill, batch1Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prototype',
        step: 1,
        totalSteps: 6,
        stepData: { title: msg, description: '分析业务场景和页面结构...' },
        progress: 15,
        status: 'ai-generating'
      });
    });
    
    // 批次2: 交互逻辑
    sendSSE(res, {
      type: 'progress',
      phase: 'prototype',
      step: 4,
      totalSteps: 6,
      stepData: { title: '设计交互逻辑...', description: '明确点击、跳转、弹窗、数据联动' },
      progress: 25,
      status: 'ai-generating'
    });
    
    const batch2Prompt = `业务场景：${scene}\n\n前期分析结果：\n${batch1Result.substring(0, 2000)}\n\n请基于以上分析，设计详细的交互逻辑：\n1. 页面间的跳转关系\n2. 按钮点击的响应\n3. 弹窗的触发和关闭\n4. 数据联动规则\n5. 状态变化处理`;
    
    const batch2Result = await callSiliconFlow(prototypeSkill, batch2Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prototype',
        step: 4,
        totalSteps: 6,
        stepData: { title: msg, description: '设计交互逻辑和状态变化...' },
        progress: 30,
        status: 'ai-generating'
      });
    });
    
    // 批次3: 生成原型 + 结构化输出
    sendSSE(res, {
      type: 'progress',
      phase: 'prototype',
      step: 5,
      totalSteps: 6,
      stepData: { title: '生成HTML原型...', description: '输出完整可运行的HTML文件' },
      progress: 40,
      status: 'ai-generating'
    });
    
    const batch3Prompt = `业务场景：${scene}\n\n前期分析：\n${batch1Result.substring(0, 1500)}\n\n交互设计：\n${batch2Result.substring(0, 1500)}\n\n请基于以上所有分析，生成：\n1. 完整的HTML原型（单文件，内联CSS/JS，可直接运行）\n2. 结构化YAML说明\n\nHTML要求：\n- 使用 Tailwind CSS（CDN引入）\n- 包含所有页面和交互\n- 中文界面，ToB风格\n- 代码完整，无外部依赖`;
    
    const batch3Result = await callSiliconFlow(prototypeSkill, batch3Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prototype',
        step: 5,
        totalSteps: 6,
        stepData: { title: msg, description: '生成HTML原型和YAML...' },
        progress: 45,
        status: 'ai-generating'
      });
    });
    
    // 提取 HTML
    const htmlMatch = batch3Result.match(/```html\n?([\s\S]*?)```/) || 
                      batch3Result.match(/<html[\s\S]*?<\/html>/) ||
                      [null, batch3Result];
    const html = htmlMatch[1] ? htmlMatch[1].trim() : batch3Result;
    
    // 标记原型步骤完成
    for (let i = 1; i <= 6; i++) {
      sendSSE(res, {
        type: 'progress',
        phase: 'prototype',
        step: i,
        totalSteps: 6,
        stepData: { title: `步骤${i}完成`, description: '' },
        progress: 45 + Math.round((i / 6) * 5),
        status: 'completed'
      });
    }
    
    // 阶段2: PRD生成（按阶段分批调用）
    sendSSE(res, { 
      type: 'phase', 
      phase: 'prd', 
      name: 'PRD生成',
      skill: 'pm-prd-skills'
    });
    
    // PRD 阶段1: 原型解析 + 业务提炼
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 1,
      totalSteps: 6,
      stepData: { title: '解析原型并提炼业务...', description: '分析HTML结构，提取业务信息' },
      progress: 50,
      status: 'ai-generating'
    });
    
    const prdBatch1Prompt = `业务场景：${scene}\n\nHTML原型（关键部分）：\n\`\`\`html\n${html.substring(0, 2000)}\n...\n\`\`\`\n\n请完成：\n1. 原型解析：提取页面结构、字段、交互、功能模块\n2. 业务提炼：补充角色、目标、痛点、业务场景\n\n输出结构化结果。`;
    
    const prdBatch1Result = await callSiliconFlow(prdSkill, prdBatch1Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 1,
        totalSteps: 6,
        stepData: { title: msg, description: '解析原型结构...' },
        progress: 55,
        status: 'ai-generating'
      });
    });
    
    // PRD 阶段2: 生成业务章节 + 分析章节
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 2,
      totalSteps: 6,
      stepData: { title: '生成业务章节...', description: '编写业务背景、目标、范围' },
      progress: 60,
      status: 'ai-generating'
    });
    
    const prdBatch2Prompt = `业务场景：${scene}\n\n前期分析：\n${prdBatch1Result.substring(0, 2000)}\n\n请生成PRD的业务章节和分析章节：\n1. 业务背景与目标\n2. 用户角色与场景\n3. 需求范围\n4. 竞品分析\n5. 核心功能点`;
    
    const prdBatch2Result = await callSiliconFlow(prdSkill, prdBatch2Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 2,
        totalSteps: 6,
        stepData: { title: msg, description: '编写业务和分析章节...' },
        progress: 65,
        status: 'ai-generating'
      });
    });
    
    // PRD 阶段3: 生成方案框架 + 功能模块
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 3,
      totalSteps: 6,
      stepData: { title: '设计方案框架...', description: '构建功能模块和系统架构' },
      progress: 70,
      status: 'ai-generating'
    });
    
    const prdBatch3Prompt = `业务场景：${scene}\n\n前期分析：\n${prdBatch1Result.substring(0, 1500)}\n\n业务章节：\n${prdBatch2Result.substring(0, 1500)}\n\n请生成：\n1. 方案框架（系统架构、模块划分）\n2. 各功能模块详细设计\n3. 数据模型设计`;
    
    const prdBatch3Result = await callSiliconFlow(prdSkill, prdBatch3Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 3,
        totalSteps: 6,
        stepData: { title: msg, description: '设计功能模块...' },
        progress: 75,
        status: 'ai-generating'
      });
    });
    
    // PRD 阶段4: 生成准备章节 + 计划章节 + 合并优化
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 4,
      totalSteps: 6,
      stepData: { title: '完善PRD文档...', description: '生成准备、计划章节，合并优化' },
      progress: 85,
      status: 'ai-generating'
    });
    
    const prdBatch4Prompt = `业务场景：${scene}\n\n业务章节：\n${prdBatch2Result.substring(0, 1000)}\n\n方案设计：\n${prdBatch3Result.substring(0, 1500)}\n\n请完成PRD剩余部分：\n1. 准备章节（环境、数据、风险）\n2. 计划章节（里程碑、排期）\n3. 合并所有内容，优化格式\n4. 输出完整PRD（Markdown格式）`;
    
    const prdFinalResult = await callSiliconFlow(prdSkill, prdBatch4Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 4,
        totalSteps: 6,
        stepData: { title: msg, description: '合并优化最终PRD...' },
        progress: 90,
        status: 'ai-generating'
      });
    });
    
    // 提取 PRD
    const prdMatch = prdFinalResult.match(/```markdown\n?([\s\S]*?)```/) || 
                     prdFinalResult.match(/# [\s\S]*/) ||
                     [null, prdFinalResult];
    const prd = prdMatch[1] ? prdMatch[1].trim() : prdFinalResult;
    
    // 完成
    sendSSE(res, {
      type: 'complete',
      progress: 100,
      html: html,
      prd: prd
    });
    
    res.end();
    
  } catch (error) {
    console.error('生成失败:', error.message);
    sendSSE(res, { type: 'error', message: error.message });
    res.end();
  }
});

/**
 * 睡眠函数
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 健康检查
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    sse: true
  });
});

/**
 * 根路径
 */
app.get('/', (req, res) => {
  res.json({
    name: 'PM Agent API',
    version: '2.0.0',
    features: ['SSE实时进度', '动态步骤解析'],
    endpoints: {
      generate: 'POST /generate - SSE流式生成',
      health: 'GET /health - 健康检查'
    }
  });
});

// 启动服务
app.listen(PORT, () => {
  console.log(`PM Agent 后端服务运行在端口 ${PORT}`);
  console.log(`支持 SSE 实时进度推送`);
});
