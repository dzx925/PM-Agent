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

// 生成任务管理器（支持断点续传）
const generationTasks = new Map();

/**
 * 获取或创建生成任务
 */
function getGenerationTask(sessionId) {
  if (!generationTasks.has(sessionId)) {
    generationTasks.set(sessionId, {
      sessionId,
      createdAt: Date.now(),
      status: 'idle', // idle, running, paused, completed, error
      currentPhase: null,
      currentStep: 0,
      scene: null,
      results: {
        html: null,
        prd: null,
        // 原型阶段中间结果
        batch1Result: null,
        batch2Result: null,
        batch3Result: null,
        // PRD阶段中间结果
        prdBatch1Result: null,
        prdBatch2Result: null,
        prdBatch3Result: null,
        prdFinalResult: null
      },
      progress: 0
    });
  }
  return generationTasks.get(sessionId);
}

/**
 * 清理过期的生成任务（24小时）
 */
function cleanupGenerationTasks() {
  const now = Date.now();
  const EXPIRY = 24 * 60 * 60 * 1000; // 24小时
  
  for (const [sessionId, task] of generationTasks.entries()) {
    if (now - task.createdAt > EXPIRY) {
      generationTasks.delete(sessionId);
    }
  }
}

// 每小时清理一次过期任务
setInterval(cleanupGenerationTasks, 60 * 60 * 1000);

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
  
  // 免费模型：Qwen2.5-7B-Instruct（永久免费，阿里通义千问）
  const FREE_MODEL = 'Qwen/Qwen2.5-7B-Instruct';
  
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
 * 验证输入是否为有效的业务场景描述
 * @param {string} scene - 用户输入
 * @returns {object} - { valid: boolean, message: string }
 */
function validateScene(scene) {
  // 1. 长度检查
  if (scene.length < 5) {
    return { valid: false, message: `描述太短了（当前${scene.length}个字符），请至少输入5个字符，详细描述你的业务场景` };
  }
  
  if (scene.length > 2000) {
    return { valid: false, message: '描述太长了，请控制在 2000 字符以内' };
  }
  
  // 2. 检查是否全是重复字符（如 "啊啊啊啊啊"）
  const uniqueChars = new Set(scene.split(''));
  if (uniqueChars.size <= 3) {
    return { valid: false, message: '输入内容过于简单，请详细描述你的业务场景和需求' };
  }
  
  // 3. 检查是否包含业务相关关键词
  const businessKeywords = [
    // 通用业务
    '用户', '产品', '服务', '平台', '系统', '应用', '功能',
    '管理', '审批', '流程', '数据', '报表', '统计',
    '部门', '企业', '公司', '组织', '团队', '角色', '权限',
    '行政', '运营',
    // HR/人事相关（核心）
    '招聘', '入职', '离职', '考勤', '打卡', '请假', '加班', '排班',
    '薪资', '工资', '薪酬', '绩效', '考核', 'KPI', 'OKR', '培训',
    '简历', '面试', '候选人', '员工', '职员', '人力', 'HR', 'HRM',
    '社保', '公积金', '福利', '假期', '调休', '年假', '病假', '事假',
    '转正', '晋升', '调岗', '调薪', '辞退', '仲裁', '合同',
    '猎头', '背调', '入职', '离职', '异动', '编制', '预算',
    '考勤机', '打卡机', '工时', '出勤', '旷工', '迟到', '早退',
    '工资条', '个税', '五险一金', '年终奖', '十三薪', '提成', '分红',
    '团建', '企业文化', '价值观', '360评估', '人才盘点', '继任计划',
    // 动作
    '需要', '想要', '希望', '要求', '实现', '完成', '处理', '解决',
    '创建', '编辑', '删除', '查询', '搜索', '导入', '导出', '审核',
    // 业务对象
    '项目', '任务', '工单', '申请', '审批',
    '报表', '文档', '文件', '消息',
    // 其他
    '后台', '后台管理', '管理系统', 'OA', 'SaaS'
  ];
  
  const hasBusinessKeyword = businessKeywords.some(keyword => 
    scene.toLowerCase().includes(keyword.toLowerCase())
  );
  
  if (!hasBusinessKeyword) {
    return { 
      valid: false, 
      message: '输入内容似乎不是HR系统场景描述。请描述你的HR产品需求，例如：\n• 一个员工考勤管理系统，支持打卡、请假、加班申请和审批\n• 一个招聘管理系统，管理候选人简历、面试流程和入职手续\n• 一个薪酬绩效系统，处理工资计算、绩效考核和年终奖发放' 
    };
  }
  
  // 4. 检查是否包含乱码特征或无意义重复
  const gibberishPattern = /[啊哦嗯哼哈嘿]{3,}|[abcdefghijklmnopqrstuvwxyz]{10,}|[0123456789]{8,}/i;
  if (gibberishPattern.test(scene)) {
    return { valid: false, message: '输入内容包含无意义字符，请用清晰的语言描述业务场景' };
  }
  
  // 4.1 检查无意义词汇重复（如"好看好看"、"哈哈哈"等）
  const meaninglessWords = ['好看', '哈哈', '呵呵', '嘿嘿', '嘻嘻', '啊啊', '哦哦', '嗯嗯', '哼哼', '哈哈'];
  const hasMeaninglessRepeat = meaninglessWords.some(word => {
    const regex = new RegExp(word + word, 'i');
    return regex.test(scene);
  });
  if (hasMeaninglessRepeat) {
    return { valid: false, message: '输入内容包含无意义的重复词汇，请详细描述你的业务场景' };
  }
  
  // 5. 检查中文比例（至少要有一定比例的中文或英文单词）
  const chineseChars = scene.match(/[\u4e00-\u9fa5]/g) || [];
  const englishWords = scene.match(/[a-zA-Z]{2,}/g) || [];
  const totalChars = scene.length;
  const meaningfulChars = chineseChars.length + englishWords.join('').length;
  
  if (meaningfulChars / totalChars < 0.3) {
    return { valid: false, message: '输入内容格式异常，请使用正常的中文或英文描述业务场景' };
  }
  
  return { valid: true, message: '' };
}

/**
 * 生成 API - SSE 流式响应（支持断点续传）
 */
app.post('/generate', async (req, res) => {
  const { scene, sessionId, resumeFrom = 0 } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;
  
  // 获取或创建任务
  const task = sessionId ? getGenerationTask(sessionId) : null;
  
  // 设置 SSE 头（提前设置，以便可以发送错误事件）
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  
  if (!scene) {
    sendSSE(res, { type: 'error', message: '请提供业务场景描述' });
    res.end();
    return;
  }
  
  // 输入验证
  const validation = validateScene(scene);
  if (!validation.valid) {
    sendSSE(res, { type: 'validation_error', message: validation.message });
    res.end();
    return;
  }
  
  if (!apiKey) {
    sendSSE(res, { type: 'error', message: '服务器未配置 OpenAI API Key' });
    res.end();
    return;
  }
  
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
    
    // 阶段2: PRD生成（显示子Skill调用过程）
    sendSSE(res, { 
      type: 'phase', 
      phase: 'prd', 
      name: 'PRD生成',
      skill: 'pm-prd-skills'
    });
    
    // 定义PRD子Skill步骤
    const prdSubSteps = [
      { skill: 'prototype-parser', icon: '📋', title: '原型解析', desc: '提取页面结构、字段、交互、功能模块' },
      { skill: 'business-refiner', icon: '🔍', title: '业务提炼', desc: '补充角色、目标、痛点、业务场景' },
      { skill: 'prd-business-section', icon: '📝', title: '业务章节', desc: '编写业务背景、目标、范围' },
      { skill: 'prd-analysis-section', icon: '📊', title: '分析章节', desc: '竞品分析、核心功能点' },
      { skill: 'solution-framework', icon: '🏗️', title: '方案框架', desc: '构建系统架构、模块划分' },
      { skill: 'feature-module-generator', icon: '⚙️', title: '功能模块', desc: '生成各模块详细设计' },
      { skill: 'solution-merger', icon: '🔗', title: '方案合并', desc: '合并框架和模块' },
      { skill: 'prd-optimizer', icon: '✨', title: 'PRD优化', desc: '质量检查、格式优化' }
    ];
    
    // 发送子Skill步骤列表
    sendSSE(res, {
      type: 'steps',
      prdSubSteps: prdSubSteps
    });
    
    // PRD 阶段1: 原型解析 + 业务提炼
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 1,
      totalSteps: 8,
      stepData: { 
        title: `${prdSubSteps[0].icon} ${prdSubSteps[0].title}`, 
        description: prdSubSteps[0].desc,
        skill: prdSubSteps[0].skill
      },
      progress: 50,
      status: 'ai-generating'
    });
    
    const prdBatch1Prompt = `业务场景：${scene}\n\nHTML原型（关键部分）：\n\`\`\`html\n${html.substring(0, 2000)}\n...\n\`\`\`\n\n请完成：\n1. 原型解析：提取页面结构、字段、交互、功能模块\n2. 业务提炼：补充角色、目标、痛点、业务场景\n\n输出结构化结果。`;
    
    const prdBatch1Result = await callSiliconFlow(prdSkill, prdBatch1Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 1,
        totalSteps: 8,
        stepData: { 
          title: `${prdSubSteps[0].icon} ${prdSubSteps[0].title} - ${msg}`, 
          description: prdSubSteps[0].desc,
          skill: prdSubSteps[0].skill
        },
        progress: 52,
        status: 'ai-generating'
      });
    });
    
    // 标记步骤1完成，显示步骤2
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 1,
      totalSteps: 8,
      stepData: { 
        title: `${prdSubSteps[0].icon} ${prdSubSteps[0].title}`, 
        description: prdSubSteps[0].desc 
      },
      progress: 54,
      status: 'completed'
    });
    
    // PRD 阶段2: 业务章节 + 分析章节
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 2,
      totalSteps: 8,
      stepData: { 
        title: `${prdSubSteps[2].icon} ${prdSubSteps[2].title}`, 
        description: prdSubSteps[2].desc,
        skill: prdSubSteps[2].skill
      },
      progress: 56,
      status: 'ai-generating'
    });
    
    const prdBatch2Prompt = `业务场景：${scene}\n\n前期分析：\n${prdBatch1Result.substring(0, 2000)}\n\n请生成PRD的业务章节和分析章节：\n1. 业务背景与目标\n2. 用户角色与场景\n3. 需求范围\n4. 竞品分析\n5. 核心功能点`;
    
    const prdBatch2Result = await callSiliconFlow(prdSkill, prdBatch2Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 2,
        totalSteps: 8,
        stepData: { 
          title: `${prdSubSteps[2].icon} ${prdSubSteps[2].title} - ${msg}`, 
          description: prdSubSteps[2].desc,
          skill: prdSubSteps[2].skill
        },
        progress: 60,
        status: 'ai-generating'
      });
    });
    
    // 标记步骤2完成
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 2,
      totalSteps: 8,
      stepData: { 
        title: `${prdSubSteps[2].icon} ${prdSubSteps[2].title}`, 
        description: prdSubSteps[2].desc 
      },
      progress: 62,
      status: 'completed'
    });
    
    // PRD 阶段3: 方案框架 + 功能模块
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 3,
      totalSteps: 8,
      stepData: { 
        title: `${prdSubSteps[4].icon} ${prdSubSteps[4].title}`, 
        description: prdSubSteps[4].desc,
        skill: prdSubSteps[4].skill
      },
      progress: 64,
      status: 'ai-generating'
    });
    
    const prdBatch3Prompt = `业务场景：${scene}\n\n前期分析：\n${prdBatch1Result.substring(0, 1500)}\n\n业务章节：\n${prdBatch2Result.substring(0, 1500)}\n\n请生成：\n1. 方案框架（系统架构、模块划分）\n2. 各功能模块详细设计\n3. 数据模型设计`;
    
    const prdBatch3Result = await callSiliconFlow(prdSkill, prdBatch3Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 3,
        totalSteps: 8,
        stepData: { 
          title: `${prdSubSteps[4].icon} ${prdSubSteps[4].title} - ${msg}`, 
          description: prdSubSteps[4].desc,
          skill: prdSubSteps[4].skill
        },
        progress: 70,
        status: 'ai-generating'
      });
    });
    
    // 标记步骤3完成
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 3,
      totalSteps: 8,
      stepData: { 
        title: `${prdSubSteps[4].icon} ${prdSubSteps[4].title}`, 
        description: prdSubSteps[4].desc 
      },
      progress: 72,
      status: 'completed'
    });
    
    // PRD 阶段4: 方案合并 + PRD优化
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 4,
      totalSteps: 8,
      stepData: { 
        title: `${prdSubSteps[6].icon} ${prdSubSteps[6].title} + ${prdSubSteps[7].title}`, 
        description: `${prdSubSteps[6].desc}，${prdSubSteps[7].desc}`,
        skill: `${prdSubSteps[6].skill}, ${prdSubSteps[7].skill}`
      },
      progress: 80,
      status: 'ai-generating'
    });
    
    const prdBatch4Prompt = `业务场景：${scene}\n\n业务章节：\n${prdBatch2Result.substring(0, 1000)}\n\n方案设计：\n${prdBatch3Result.substring(0, 1500)}\n\n请完成PRD剩余部分：\n1. 准备章节（环境、数据、风险）\n2. 计划章节（里程碑、排期）\n3. 合并所有内容，优化格式\n4. 输出完整PRD（Markdown格式）`;
    
    const prdFinalResult = await callSiliconFlow(prdSkill, prdBatch4Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 4,
        totalSteps: 8,
        stepData: { 
          title: `${prdSubSteps[6].icon} ${prdSubSteps[6].title} + ${prdSubSteps[7].title} - ${msg}`, 
          description: `${prdSubSteps[6].desc}，${prdSubSteps[7].desc}`,
          skill: `${prdSubSteps[6].skill}, ${prdSubSteps[7].skill}`
        },
        progress: 90,
        status: 'ai-generating'
      });
    });
    
    // 标记所有PRD步骤完成
    for (let i = 4; i <= 8; i++) {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: i,
        totalSteps: 8,
        stepData: { 
          title: i < prdSubSteps.length ? `${prdSubSteps[i-1]?.icon || '✅'} ${prdSubSteps[i-1]?.title || '完成'}` : '✅ 完成', 
          description: prdSubSteps[i-1]?.desc || '' 
        },
        progress: 90 + Math.round((i / 8) * 8),
        status: 'completed'
      });
    }
    
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
 * 睡眠函数 - 支持可中断的睡眠
 */
function sleep(ms, abortSignal) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(resolve, ms);
    if (abortSignal) {
      abortSignal.then(() => {
        clearTimeout(timeout);
        reject(new Error('PAUSED'));
      });
    }
  });
}

/**
 * 暂停生成任务
 */
app.post('/pause', (req, res) => {
  const { sessionId } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({ error: '缺少 sessionId' });
  }
  
  const task = generationTasks.get(sessionId);
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  
  if (task.status === 'running') {
    task.status = 'pausing'; // 标记为正在暂停，等待当前批次完成
    task.pauseResolve = null;
    task.pausePromise = new Promise(resolve => {
      task.pauseResolve = resolve;
    });
  }
  
  res.json({ 
    success: true, 
    status: task.status,
    currentPhase: task.currentPhase,
    currentStep: task.currentStep,
    progress: task.progress
  });
});

/**
 * 恢复生成任务
 */
app.post('/resume', (req, res) => {
  const { sessionId } = req.body;
  
  if (!sessionId) {
    return res.status(400).json({ error: '缺少 sessionId' });
  }
  
  const task = generationTasks.get(sessionId);
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  
  if (task.status === 'paused' && task.pauseResolve) {
    task.status = 'running';
    task.pauseResolve(); // 解除暂停
    task.pauseResolve = null;
    task.pausePromise = null;
  }
  
  res.json({ 
    success: true, 
    status: task.status,
    currentPhase: task.currentPhase,
    currentStep: task.currentStep,
    progress: task.progress
  });
});

/**
 * 获取任务状态
 */
app.get('/task/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  const task = generationTasks.get(sessionId);
  
  if (!task) {
    return res.status(404).json({ error: '任务不存在' });
  }
  
  res.json({
    sessionId: task.sessionId,
    status: task.status,
    currentPhase: task.currentPhase,
    currentStep: task.currentStep,
    progress: task.progress,
    hasResults: {
      html: !!task.results.html,
      prd: !!task.results.prd
    }
  });
});

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
