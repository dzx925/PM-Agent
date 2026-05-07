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
  
  // 检查缓存
  if (skillCache[type] && skillCache.lastFetch && (now - skillCache.lastFetch) < CACHE_TTL) {
    console.log(`使用缓存的 ${type} skill`);
    return skillCache[type];
  }
  
  try {
    console.log(`从 GitHub 获取 ${type} skill...`);
    const response = await axios.get(SKILL_URLS[type], {
      timeout: 10000,
      headers: {
        'User-Agent': 'PM-Agent-Backend'
      }
    });
    
    skillCache[type] = response.data;
    skillCache.lastFetch = now;
    
    console.log(`成功获取 ${type} skill`);
    return response.data;
  } catch (error) {
    console.error(`获取 ${type} skill 失败:`, error.message);
    throw new Error(`无法加载 ${type} skill，请检查 GitHub 仓库是否可访问`);
  }
}

/**
 * 调用 OpenAI API
 */
async function callOpenAI(systemPrompt, userPrompt, apiKey) {
  try {
    const response = await axios.post(
      'https://api.openai.com/v1/chat/completions',
      {
        model: 'gpt-4o',
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
  } catch (error) {
    console.error('OpenAI API 调用失败:', error.response?.data || error.message);
    throw new Error('AI 生成失败，请稍后重试');
  }
}

/**
 * 生成 API
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
  
  try {
    // 获取 Skill 内容
    const [prototypeSkill, prdSkill] = await Promise.all([
      getSkillContent('prototype'),
      getSkillContent('prd')
    ]);
    
    console.log('开始生成原型...');
    // Step 1: 生成 HTML 原型
    const htmlPrompt = `业务场景：${scene}\n\n请根据上述业务场景，生成一个完整的可交互 HTML 原型。要求：\n1. 使用 HTML + Tailwind CSS（通过 CDN）\n2. 包含核心页面和交互逻辑\n3. 代码完整，可直接运行\n4. 中文界面\n5. 专业美观的 ToB 风格`;
    
    const htmlResult = await callOpenAI(prototypeSkill, htmlPrompt, apiKey);
    
    // 提取 HTML 代码
    const htmlMatch = htmlResult.match(/```html\n?([\s\S]*?)```/) || 
                      htmlResult.match(/```\n?([\s\S]*?)```/) ||
                      [null, htmlResult];
    const html = htmlMatch[1].trim();
    
    console.log('开始生成 PRD...');
    // Step 2: 生成 PRD
    const prdPrompt = `业务场景：${scene}\n\n已生成的 HTML 原型：\n\`\`\`html\n${html}\n\`\`\`\n\n请根据上述业务场景和原型，生成完整的 PRD 文档。`;
    
    const prdResult = await callOpenAI(prdSkill, prdPrompt, apiKey);
    
    // 提取 PRD 内容
    const prdMatch = prdResult.match(/```markdown\n?([\s\S]*?)```/) || 
                     prdResult.match(/```\n?([\s\S]*?)```/) ||
                     [null, prdResult];
    const prd = prdMatch[1].trim();
    
    console.log('生成完成');
    res.json({ html, prd });
    
  } catch (error) {
    console.error('生成失败:', error.message);
    res.status(500).json({ error: error.message });
  }
});

/**
 * 健康检查
 */
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    cache: {
      prototype: skillCache.prototype ? 'loaded' : 'not loaded',
      prd: skillCache.prd ? 'loaded' : 'not loaded'
    }
  });
});

/**
 * 根路径
 */
app.get('/', (req, res) => {
  res.json({
    name: 'PM Agent API',
    version: '1.0.0',
    endpoints: {
      generate: 'POST /generate - 生成原型和PRD',
      health: 'GET /health - 健康检查'
    }
  });
});

// 启动服务
app.listen(PORT, () => {
  console.log(`PM Agent 后端服务运行在端口 ${PORT}`);
  console.log(`环境: ${process.env.NODE_ENV || 'development'}`);
  
  // 预加载 Skill
  Promise.all([
    getSkillContent('prototype').catch(() => null),
    getSkillContent('prd').catch(() => null)
  ]).then(() => {
    console.log('Skill 预加载完成');
  });
});
