const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors());
app.use(express.json());

// Skill 文件 URL
const SKILL_URLS = {
  prototype: 'https://raw.githubusercontent.com/dzx925/prototype-skill/main/SKILL.md',
  prd: 'https://raw.githubusercontent.com/dzx925/pm-prd-skills/main/SKILL.md'
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
 * 调用 SiliconFlow API (免费)
 */
async function callSiliconFlow(systemPrompt, userPrompt, apiKey) {
  const response = await axios.post(
    'https://api.siliconflow.cn/v1/chat/completions',
    {
      model: 'deepseek-ai/DeepSeek-V2.5',
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
      timeout: 120000
    }
  );
  
  return response.data.choices[0].message.content;
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
    
    // 阶段1: 原型生成
    sendSSE(res, { 
      type: 'phase', 
      phase: 'prototype', 
      name: '原型生成',
      skill: '原型-skill'
    });
    
    // 模拟每个步骤
    for (let i = 0; i < prototypeSteps.length; i++) {
      const step = prototypeSteps[i];
      const progress = Math.round(((i + 1) / prototypeSteps.length) * 50);
      
      sendSSE(res, {
        type: 'progress',
        phase: 'prototype',
        step: i + 1,
        totalSteps: prototypeSteps.length,
        stepData: step,
        progress: progress,
        status: i === prototypeSteps.length - 1 ? 'generating' : 'processing'
      });
      
      // 模拟处理时间
      await sleep(800);
    }
    
    // 实际调用 OpenAI 生成原型
    sendSSE(res, {
      type: 'progress',
      phase: 'prototype',
      step: prototypeSteps.length,
      totalSteps: prototypeSteps.length,
      stepData: { title: 'AI生成中', description: '调用DeepSeek生成HTML原型...' },
      progress: 45,
      status: 'ai-generating'
    });
    
    const htmlPrompt = `业务场景：${scene}\n\n请根据上述业务场景，生成一个完整的可交互 HTML 原型。要求：\n1. 使用 HTML + Tailwind CSS（通过 CDN）\n2. 包含核心页面和交互逻辑\n3. 代码完整，可直接运行\n4. 中文界面\n5. 专业美观的 ToB 风格`;
    
    const htmlResult = await callSiliconFlow(prototypeSkill, htmlPrompt, apiKey);
    const htmlMatch = htmlResult.match(/```html\n?([\s\S]*?)```/) || 
                      htmlResult.match(/```\n?([\s\S]*?)```/) ||
                      [null, htmlResult];
    const html = htmlMatch[1].trim();
    
    // 阶段2: PRD生成
    sendSSE(res, { 
      type: 'phase', 
      phase: 'prd', 
      name: 'PRD生成',
      skill: 'pm-prd-skills'
    });
    
    for (let i = 0; i < prdSteps.length; i++) {
      const step = prdSteps[i];
      const progress = 50 + Math.round(((i + 1) / prdSteps.length) * 45);
      
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: i + 1,
        totalSteps: prdSteps.length,
        stepData: step,
        progress: progress,
        status: i === prdSteps.length - 1 ? 'generating' : 'processing'
      });
      
      await sleep(800);
    }
    
    // 实际生成 PRD
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: prdSteps.length,
      totalSteps: prdSteps.length,
      stepData: { title: 'AI生成中', description: '调用DeepSeek生成PRD文档...' },
      progress: 90,
      status: 'ai-generating'
    });
    
    const prdPrompt = `业务场景：${scene}\n\n已生成的 HTML 原型：\n\`\`\`html\n${html}\n\`\`\`\n\n请根据上述业务场景和原型，生成完整的 PRD 文档。`;
    
    const prdResult = await callSiliconFlow(prdSkill, prdPrompt, apiKey);
    const prdMatch = prdResult.match(/```markdown\n?([\s\S]*?)```/) || 
                     prdResult.match(/```\n?([\s\S]*?)```/) ||
                     [null, prdResult];
    const prd = prdMatch[1].trim();
    
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
