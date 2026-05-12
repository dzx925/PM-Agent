const express = require('express');
const cors = require('cors');
const axios = require('axios');
const SiliconFlowModelRouter = require('./utils/model-router');

const app = express();
const PORT = process.env.PORT || 3000;

// 初始化模型路由
const modelRouter = new SiliconFlowModelRouter();

// 中间件 - CORS 配置（允许所有来源）
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json());

// 静态文件服务
app.use(express.static('.'));

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
    throw new Error(`无法从 GitHub 加载 ${type} skill，请检查网络连接或稍后重试。错误：${error.message}`);
  }
}

/**
 * 解析 Skill 工作流程步骤
 */
function parseSkillSteps(skillContent, mode = 'all') {
  const steps = [];
  
  // 根据模式选择不同的工作流程部分
  let workflowSection = '';
  
  if (mode === 'prd') {
    // 模式2：从业务场景直接生成PRD - 解析"模式2"部分
    const mode2Match = skillContent.match(/### 模式2：从业务场景直接生成PRD[\s\S]*?(?=### 模式1|## |\n## |$)/);
    if (mode2Match) {
      workflowSection = mode2Match[0];
    }
  } else if (mode === 'prototype') {
    // 模式1：从原型生成 - 解析"模式1"部分
    const mode1Match = skillContent.match(/### 模式1：从原型生成PRD[\s\S]*?(?=### 模式2|## |\n## |$)/);
    if (mode1Match) {
      workflowSection = mode1Match[0];
    }
  }
  
  // 如果没有找到特定模式的工作流程，尝试解析通用的工作流程
  if (!workflowSection) {
    const workflowMatch = skillContent.match(/## 工作流程[\s\S]*?(?=## |\n## |$)/);
    if (workflowMatch) {
      workflowSection = workflowMatch[0];
    }
  }
  
  if (workflowSection) {
    // 匹配阶段标题（#### 阶段X：标题）
    const stageRegex = /#### (\d+)-(\d+)[:：]\s*(.+?)(?=\n#### |\n##### |\n## |$)/gs;
    let match;
    
    while ((match = stageRegex.exec(workflowSection)) !== null) {
      steps.push({
        number: parseInt(match[1]),
        title: match[3].trim(),
        description: ''
      });
    }
    
    // 如果没有匹配到，尝试匹配简单的编号列表
    if (steps.length === 0) {
      const stepRegex = /(\d+)\.\s*\*\*([^*]+)\*\*[:：]\s*(.+?)(?=\n\d+\.|\n## |$)/gs;
      while ((match = stepRegex.exec(workflowSection)) !== null) {
        steps.push({
          number: parseInt(match[1]),
          title: match[2].trim(),
          description: match[3].trim().replace(/\n/g, ' ')
        });
      }
    }
  }
  
  return steps;
}

/**
 * 动态执行步骤 - 根据Skill步骤列表执行
 * @param {Array} steps - 步骤列表
 * @param {string} scene - 业务场景
 * @param {string} systemPrompt - System Prompt
 * @param {string} apiKey - API Key
 * @param {object} res - SSE响应对象
 * @param {string} phase - 阶段名称
 * @param {object} context - 上下文数据（前几步的结果）
 * @returns {object} - 执行结果
 */
async function executeDynamicSteps(steps, scene, systemPrompt, apiKey, res, phase, context = {}) {
  const results = {};
  const totalSteps = steps.length;
  
  // 定义每个步骤的prompt构建函数
  const stepPromptBuilders = {
    '需求理解': (ctx) => `业务场景：${scene}\n\n请分析上述业务场景，提炼以下内容：\n1. 目标用户是谁\n2. 核心价值是什么\n3. 主流程是什么\n\n请用结构化方式输出。`,
    '业务理解': (ctx) => `业务场景：${scene}\n\n请分析上述业务场景，提炼以下内容：\n1. 目标用户是谁\n2. 核心价值是什么\n3. 主流程是什么\n\n请用结构化方式输出。`,
    '页面规划': (ctx) => `业务场景：${scene}\n\n业务理解：\n${ctx.step1?.substring(0, 1000) || ''}\n\n请基于以上理解，确定需要哪些页面和弹窗（如列表页、详情页、表单页等）。\n\n请用结构化方式输出。`,
    '页面拆解': (ctx) => `业务场景：${scene}\n\n业务理解：\n${ctx.step1?.substring(0, 1000) || ''}\n\n请基于以上理解，确定需要哪些页面和弹窗（如列表页、详情页、表单页等）。\n\n请用结构化方式输出。`,
    '组件设计': (ctx) => `业务场景：${scene}\n\n页面拆解：\n${ctx.step2?.substring(0, 1000) || ''}\n\n请基于以上页面拆解，设计各页面的关键字段、控件和校验规则。\n\n请用结构化方式输出。`,
    '原型生成': (ctx) => `业务场景：${scene}\n\n前期分析：\n${ctx.step1?.substring(0, 600) || ''}\n${ctx.step2?.substring(0, 600) || ''}\n${ctx.step3?.substring(0, 600) || ''}\n\n请基于以上所有分析，生成完整的HTML原型（单文件，内联CSS/JS，可直接运行）。\n\nHTML要求：\n- 使用 Tailwind CSS（CDN引入）\n- 包含所有页面和交互\n- 中文界面，ToB风格\n- 代码完整，无外部依赖`,
    '交互逻辑': (ctx) => `业务场景：${scene}\n\n前期分析：\n${ctx.step1?.substring(0, 800) || ''}\n${ctx.step2?.substring(0, 800) || ''}\n${ctx.step3?.substring(0, 800) || ''}\n\n请基于以上分析，设计详细的交互逻辑：\n1. 页面间的跳转关系\n2. 按钮点击的响应\n3. 弹窗的触发和关闭\n4. 数据联动规则\n5. 状态变化处理`,
    '生成原型': (ctx) => `业务场景：${scene}\n\n前期分析：\n${ctx.step1?.substring(0, 600) || ''}\n${ctx.step2?.substring(0, 600) || ''}\n${ctx.step3?.substring(0, 600) || ''}\n${ctx.step4?.substring(0, 600) || ''}\n\n请基于以上所有分析，生成完整的HTML原型（单文件，内联CSS/JS，可直接运行）。\n\nHTML要求：\n- 使用 Tailwind CSS（CDN引入）\n- 包含所有页面和交互\n- 中文界面，ToB风格\n- 代码完整，无外部依赖`,
    '结构化输出': (ctx) => `业务场景：${scene}\n\nHTML原型：\n${ctx.html?.substring(0, 1000) || ''}\n\n请基于以上HTML原型，生成结构化YAML说明。`
  };
  
  // 定义每个步骤的进度范围
  const stepProgressRanges = [
    { start: 5, end: 15 },   // 步骤1
    { start: 18, end: 28 },  // 步骤2
    { start: 32, end: 40 },  // 步骤3
    { start: 45, end: 55 },  // 步骤4
    { start: 60, end: 75 },  // 步骤5
    { start: 80, end: 90 }   // 步骤6
  ];
  
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const stepTitle = step.title;
    const stepNum = i + 1;
    const progressRange = stepProgressRanges[i] || { start: 10, end: 90 };
    
    // 发送步骤开始进度
    sendSSE(res, {
      type: 'progress',
      phase,
      step: stepNum,
      totalSteps,
      stepData: { title: stepTitle, description: `执行${stepTitle}...` },
      progress: progressRange.start,
      status: 'ai-generating'
    });
    
    // 构建prompt
    const promptBuilder = stepPromptBuilders[stepTitle];
    if (!promptBuilder) {
      console.warn(`未找到步骤 "${stepTitle}" 的prompt构建器，使用默认prompt`);
    }
    const prompt = promptBuilder ? promptBuilder(context) : `${stepTitle}：${scene}`;
    
    // 执行步骤
    try {
      const result = await callSiliconFlow(systemPrompt, prompt, apiKey, (msg) => {
        sendSSE(res, {
          type: 'progress',
          phase,
          step: stepNum,
          totalSteps,
          stepData: { title: stepTitle, description: msg },
          progress: Math.floor((progressRange.start + progressRange.end) / 2),
          status: 'ai-generating'
        });
      });
      
      // 保存结果到上下文
      results[`step${stepNum}`] = result;
      context[`step${stepNum}`] = result;
      
      // 如果是原型生成步骤，同时保存为html
      if (stepTitle === '原型生成' || stepTitle === '生成原型') {
        const htmlMatch = result.match(/```html\n?([\s\S]*?)```/) || 
                          result.match(/<html[\s\S]*?<\/html>/) ||
                          [null, result];
        context.html = htmlMatch[1] ? htmlMatch[1].trim() : result;
      }
      
      // 发送步骤完成进度
      sendSSE(res, {
        type: 'progress',
        phase,
        step: stepNum,
        totalSteps,
        stepData: { title: stepTitle, description: '✓ 完成' },
        progress: progressRange.end,
        status: 'complete'
      });
      
    } catch (error) {
      console.error(`步骤 "${stepTitle}" 执行失败:`, error);
      throw error;
    }
  }
  
  return results;
}

/**
 * 任务判断 System Prompt
 */
const TASK_JUDGE_PROMPT = `你是智能产品生成助手，拥有两个核心能力：
1. 生成HTML原型（高保真可交互页面）
2. 生成PRD文档（产品需求文档）

【任务判断规则】
根据用户输入，自动判断执行策略：

1. 原型生成触发词：页面、界面、UI、原型、网页、布局、组件、样式
   → 直接输出完整HTML代码

2. PRD生成触发词：需求、文档、PRD、说明、规格、功能描述、业务流程
   → 直接输出HTML格式PRD文档（带样式，支持打印/下载PDF）

3. 组合需求：提到"两个都要"、"PRD和原型"
   → 按用户说的顺序，或默认先原型后PRD

4. 修改/优化：提到"改一下"、"修改"、"调整"、"优化"、"重写"
   → 基于已有内容修改，输出完整新版本

5. 继续生成：提到"继续"、"接着"、"下一步"、"还没完"
   → 基于上下文继续之前的工作

【输出规范】
- 只输出最终结果，禁止解释说明
- 原型：输出可运行的完整HTML代码（包含CSS/JS）
- PRD：输出HTML格式文档（带样式，支持打印/下载PDF）
- 修改：输出修改后的完整内容，不标注差异`;

/**
 * 原型生成 System Prompt（精简版）
 */
const PROTOTYPE_SYSTEM_PROMPT = `你是资深产品架构师+UI/UX专家，专门服务TOB产品经理。

【核心任务】
将业务场景转化为高保真HTML原型，输出单文件完整HTML（内联CSS/JS，无外部依赖）。

【强制UI规范】
1. 必须使用 Tailwind CSS v3（CDN引入）
2. 现代简约卡片式、大圆角(rounded-xl)、柔和阴影(shadow-sm)、充足留白(p-6)
3. 浅色系干净配色（bg-slate-50、white）
4. 表单/详情页：居中单栏（max-w-6xl mx-auto）
5. 后台系统：左侧边栏+右侧主内容
6. 禁止：table表格布局、灰色老式边框、原生style

【代码规范】
- 单文件完整HTML，浏览器可直接打开
- 所有CSS通过Tailwind内联
- 中文界面，ToB风格
- 包含基础交互（点击、弹窗、表单验证）
- 使用自定义弹窗，禁止原生alert/confirm

【输出要求】
直接输出完整HTML代码，不做任何解释。`;

/**
 * 判断用户任务类型
 */
async function judgeTaskType(scene, apiKey) {
  const judgePrompt = `用户输入："${scene}"

请判断用户想要什么：
- "prototype" = 只生成HTML原型（页面、界面、UI）
- "prd" = 只生成PRD文档（需求文档、产品说明）
- "both" = 两者都要

【重要判断规则】
1. 如果用户明确说"只生成原型"、"只要原型"、"不需要PRD"、"只画页面" → 返回 "prototype"
2. 如果用户明确说"只生成PRD"、"只要PRD"、"只要文档"、"不需要原型"、"基于原型生成PRD" → 返回 "prd"
3. 如果用户说"两个都要"、"原型和PRD"、没有明确指定 → 返回 "both"
4. 如果用户提到"基于已有原型"、"基于现有原型"、"基于这个原型" → 说明已有原型，只需要生成PRD → 返回 "prd"

只返回JSON格式，不要其他内容：
{
  "type": "prototype|prd|both",
  "reason": "判断理由"
}`;

  try {
    console.log('=== AI 任务判断开始 ===');
    console.log('用户输入:', scene);
    
    const result = await callSiliconFlow(TASK_JUDGE_PROMPT, judgePrompt, apiKey);
    console.log('AI 判断原始结果:', result);
    
    // 提取JSON
    const jsonMatch = result.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const decision = JSON.parse(jsonMatch[0]);
      console.log('AI 判断解析结果:', decision);
      console.log('=== AI 任务判断结束 ===');
      return decision;
    }
  } catch (error) {
    console.error('任务判断失败:', error);
  }
  
  // 默认返回both
  console.log('AI 判断失败，使用默认模式: both');
  return { type: 'both', reason: '判断失败，默认生成原型+PRD' };
}

/**
 * 调用 SiliconFlow API - 使用 model-router 管理免费模型
 */
async function callSiliconFlow(systemPrompt, userPrompt, apiKey, onProgress = null) {
  const maxRetries = 2;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      if (onProgress) {
        onProgress(`AI生成中...`);
      }
      
      // 使用 model-router 调用模型（自动选择可用免费模型）
      const result = await modelRouter.callModel(
        [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ],
        {
          temperature: 0.7,
          max_tokens: 4000
        }
      );
      
      return result.choices[0].message.content;
    } catch (error) {
      console.error(`API调用失败 (尝试 ${attempt}/${maxRetries}):`, error.message);
      
      if (attempt === maxRetries) {
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
    // 页面/功能模块（新增）
    '页面', '模块', '功能', '组件', '表单', '列表', '详情', '首页',
    '信息', '档案', '记录', '资料', '个人信息', '基本信息', '员工信息',
    '花名册', '通讯录', '组织架构', '部门管理', '岗位', '职位', '职级',
    // 动作
    '需要', '想要', '希望', '要求', '实现', '完成', '处理', '解决',
    '创建', '编辑', '删除', '查询', '搜索', '导入', '导出', '审核',
    '增删改查', '增删', '修改', '新增', '查看', '展示', '显示',
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
 * 生成 API - SSE 流式响应（支持断点续传和模式选择）
 */
app.post('/generate', async (req, res) => {
  const { scene, sessionId, resumeFrom = 0, mode = 'all', isModify = false, intermediateResults = {} } = req.body;
  const apiKey = process.env.OPENAI_API_KEY;
  
  // 验证 mode 参数
  const validModes = ['all', 'prototype', 'prd'];
  const generationMode = validModes.includes(mode) ? mode : 'all';
  
  console.log('========== /generate 接口日志 ==========');
  console.log('接收到的 mode:', mode);
  console.log('处理后的 generationMode:', generationMode);
  console.log('intermediateResults 是否存在:', !!intermediateResults);
  console.log('intermediateResults.html 是否存在:', !!(intermediateResults?.html));
  console.log('scene:', scene?.substring(0, 50));
  console.log('========================================');
  
  // 如果是修改模式，直接基于现有HTML进行修改
  if (isModify && intermediateResults?.html) {
    console.log('修改模式：基于现有HTML直接修改');
    
    // 设置 SSE 头
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    try {
      // 获取 Skill 内容
      const prototypeSkill = await getSkillContent('prototype');
      
      // 发送步骤列表（只显示一个"修改原型"步骤）
      sendSSE(res, {
        type: 'steps',
        prototypeSteps: [{ number: 1, title: '修改原型', description: '基于现有原型进行修改' }],
        prdSteps: []
      });
      
      // 发送进度
      sendSSE(res, {
        type: 'progress',
        phase: 'prototype',
        step: 1,
        totalSteps: 1,
        stepData: { title: '修改原型', description: '正在应用修改...' },
        progress: 50,
        status: 'ai-generating'
      });
      
      // 调用AI进行修改
      const modifyPrompt = `${scene}\n\n现有HTML原型：\n\`\`\`html\n${intermediateResults.html}\n\`\`\`\n\n请基于以上原型进行修改，只调整指定的部分，保持其他部分不变。输出完整的HTML代码。`;
      
      const modifyResult = await callSiliconFlow(PROTOTYPE_SYSTEM_PROMPT, modifyPrompt, apiKey, (msg) => {
        sendSSE(res, {
          type: 'progress',
          phase: 'prototype',
          step: 1,
          totalSteps: 1,
          stepData: { title: '修改原型', description: msg },
          progress: 70,
          status: 'ai-generating'
        });
      });
      
      // 提取修改后的HTML
      const htmlMatch = modifyResult.match(/```html\n?([\s\S]*?)```/) || 
                        modifyResult.match(/<html[\s\S]*?<\/html>/) ||
                        [null, modifyResult];
      const html = htmlMatch[1] ? htmlMatch[1].trim() : modifyResult;
      
      // 发送结果
      sendSSE(res, {
        type: 'result',
        html: html,
        yaml: intermediateResults.yaml
      });
      
      // 完成
      sendSSE(res, {
        type: 'complete',
        progress: 100,
        html: html,
        prd: null,
        scene: scene
      });
      
      res.end();
      return;
    } catch (error) {
      console.error('修改失败:', error.message);
      sendSSE(res, { type: 'error', message: error.message });
      res.end();
      return;
    }
  }
  
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
  // 对于PRD生成模式（基于已有原型），检查原型内容而非用户输入
  let validation;
  if (generationMode === 'prd' && intermediateResults?.html) {
    // 基于已有原型生成PRD，验证原型内容
    validation = validateScene(intermediateResults.html);
    console.log('PRD模式：验证原型内容而非用户输入');
  } else {
    // 正常验证用户输入
    validation = validateScene(scene);
  }
  
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
    // Step 1: AI 判断任务类型
    sendSSE(res, { type: 'status', message: 'AI 分析需求...' });
    
    const taskDecision = await judgeTaskType(scene, apiKey);
    console.log('========== 任务判断日志 ==========');
    console.log('用户输入:', scene);
    console.log('前端传来的 generationMode:', generationMode);
    console.log('AI 判断结果:', taskDecision);
    
    // 根据 AI 判断结果设置生成模式
    let actualMode = generationMode;
    console.log('初始 actualMode (来自前端):', actualMode);
    
    if (taskDecision.type === 'prototype') {
      actualMode = 'prototype';
      console.log('AI 判断为 prototype，设置 actualMode = prototype');
    } else if (taskDecision.type === 'prd') {
      actualMode = 'prd';
      console.log('AI 判断为 prd，设置 actualMode = prd');
    } else if (taskDecision.type === 'both') {
      actualMode = 'all';
      console.log('AI 判断为 both，设置 actualMode = all');
    } else {
      console.log('AI 判断类型未识别:', taskDecision.type, '使用默认值:', actualMode);
    }
    console.log('最终 actualMode:', actualMode);
    console.log('========== 任务判断日志结束 ==========');
    
    // 获取 Skill 内容
    sendSSE(res, { type: 'status', message: '加载 Skill 配置...' });
    
    const [prototypeSkill, prdSkill] = await Promise.all([
      getSkillContent('prototype'),
      getSkillContent('prd')
    ]);
    
    // 解析步骤 - 根据 AI 判断的模式解析不同的步骤
    let prototypeSteps = [];
    let prdSteps = [];
    
    if (actualMode === 'prototype') {
      // 只生成原型 - 解析原型Skill的步骤
      prototypeSteps = parseSkillSteps(prototypeSkill, 'prototype');
      prdSteps = [];
    } else if (actualMode === 'prd') {
      // 只生成PRD - 解析PRD Skill的模式2步骤（从业务场景直接生成）
      prototypeSteps = [];
      prdSteps = parseSkillSteps(prdSkill, 'prd');
    } else {
      // 全部生成 - 解析所有步骤
      prototypeSteps = parseSkillSteps(prototypeSkill, 'prototype');
      prdSteps = parseSkillSteps(prdSkill, 'prd');
    }
    
    console.log('生成模式:', actualMode);
    console.log('原型步骤数量:', prototypeSteps.length);
    console.log('原型步骤:', prototypeSteps.map(s => s.title));
    console.log('PRD步骤数量:', prdSteps.length);
    console.log('PRD步骤:', prdSteps.map(s => s.title));
    
    // 如果步骤为空，可能是解析失败，使用备用步骤
    if (prototypeSteps.length === 0) {
      console.warn('原型步骤解析为空，使用备用步骤');
      prototypeSteps = [
        { number: 1, title: '需求理解', description: '理解业务场景和需求' },
        { number: 2, title: '页面规划', description: '规划页面结构和布局' },
        { number: 3, title: '组件设计', description: '设计页面组件和交互' },
        { number: 4, title: '原型生成', description: '生成高保真原型' }
      ];
    }
    if (prdSteps.length === 0) {
      console.warn('PRD步骤解析为空，使用备用步骤');
      prdSteps = [
        { number: 1, title: '原型解析', description: '解析原型结构' },
        { number: 2, title: 'PRD生成', description: '生成PRD文档' }
      ];
    }
    
    // 根据生成模式发送不同的步骤
    if (actualMode === 'prototype') {
      // 只生成原型 - 只发送原型步骤
      sendSSE(res, { 
        type: 'steps', 
        prototypeSteps,
        prdSteps: []  // 空数组，不显示PRD步骤
      });
    } else if (actualMode === 'prd') {
      // 只生成PRD - 支持两种模式：
      // 1. 有已有原型：基于原型生成PRD
      // 2. 无原型：直接从业务场景生成PRD（原型部分为占位符）
      
      // prdSteps 已经根据模式解析好了
      // 如果解析为空，使用备用步骤作为兜底
      const finalPrdSteps = prdSteps.length > 0 ? prdSteps : [
        { number: 1, title: '业务提炼', description: '从业务场景提炼需求、角色、目标' },
        { number: 2, title: 'PRD章节生成', description: '生成业务、分析、方案等章节' },
        { number: 3, title: '功能模块生成', description: '生成各功能模块详情' },
        { number: 4, title: '方案合并', description: '合并为完整方案章节' },
        { number: 5, title: 'PRD优化', description: '优化并输出最终PRD' }
      ];
      
      console.log('=== PRD模式：发送步骤 ===');
      console.log('finalPrdSteps:', finalPrdSteps.map(s => s.title));
      
      // 只发送PRD步骤（不显示原型步骤）
      sendSSE(res, { 
        type: 'steps', 
        prototypeSteps: [],  // 空数组，不显示原型步骤
        prdSteps: finalPrdSteps
      });
    } else {
      // 全部生成 - 发送所有步骤
      sendSSE(res, { 
        type: 'steps', 
        prototypeSteps,
        prdSteps
      });
    }
    
    // 如果只生成PRD，跳过原型生成阶段，直接进入PRD生成
    if (actualMode === 'prd') {
      // 检查是否有已有原型
      const task = sessionId ? getGenerationTask(sessionId) : null;
      const existingHtml = task?.results?.html || req.body.intermediateResults?.html;
      
      // 阶段: PRD生成（直接从业务场景生成，无需原型）
      sendSSE(res, { 
        type: 'phase', 
        phase: 'prd', 
        name: 'PRD生成',
        skill: 'pm-prd-skills'
      });
      
      // PRD生成逻辑 - 使用finalPrdSteps中的标题
      try {
        // 步骤1: 使用步骤列表中的第一个步骤标题
        const step1Title = finalPrdSteps[0]?.title || '业务提炼';
        sendSSE(res, {
          type: 'progress',
          phase: 'prd',
          step: 1,
          totalSteps: finalPrdSteps.length,
          stepData: { title: step1Title, description: '从业务场景提炼需求、角色、目标' },
          progress: 10,
          status: 'ai-generating'
        });
        
        const businessPrompt = `业务场景：${scene}\n\n请分析上述业务场景，提炼以下内容：\n1. 目标用户是谁\n2. 核心价值是什么\n3. 主要功能模块有哪些\n4. 业务流程是什么\n\n请用结构化方式输出，为后续PRD生成做准备。`;
        
        const businessResult = await callSiliconFlow(prdSkill, businessPrompt, apiKey, (msg) => {
          sendSSE(res, {
            type: 'progress',
            phase: 'prd',
            step: 1,
            totalSteps: finalPrdSteps.length,
            stepData: { title: step1Title, description: msg },
            progress: 20,
            status: 'ai-generating'
          });
        });
        
        // 步骤2: 使用步骤列表中的第二个步骤标题（如果存在）
        const step2Title = finalPrdSteps[1]?.title || 'PRD章节生成';
        sendSSE(res, {
          type: 'progress',
          phase: 'prd',
          step: 2,
          totalSteps: finalPrdSteps.length,
          stepData: { title: step2Title, description: '生成业务、分析、方案等章节' },
          progress: 40,
          status: 'ai-generating'
        });
        
        const prdPrompt = `基于以下业务分析生成完整PRD文档：\n\n${businessResult}\n\n请生成完整的PRD文档，包含：\n1. 业务背景和目标\n2. 功能需求\n3. 业务流程\n4. 数据结构\n5. 非功能性需求\n6. 上线计划\n\n注意：由于没有提供原型，原型截图部分请标注"【原型待补充】"。\n\n请使用Markdown格式输出完整PRD。`;
        
        const prdResult = await callSiliconFlow(prdSkill, prdPrompt, apiKey, (msg) => {
          sendSSE(res, {
            type: 'progress',
            phase: 'prd',
            step: 2,
            totalSteps: finalPrdSteps.length,
            stepData: { title: step2Title, description: msg },
            progress: 70,
            status: 'ai-generating'
          });
        });
        
        // 发送PRD结果
        sendSSE(res, {
          type: 'result',
          html: existingHtml || null,
          prd: prdResult,
          yaml: null
        });
        
        // 完成
        sendSSE(res, {
          type: 'complete',
          progress: 100,
          html: existingHtml || null,
          prd: prdResult,
          scene: scene
        });
        
        res.end();
        return;
        
      } catch (error) {
        console.error('PRD生成失败:', error.message);
        sendSSE(res, { type: 'error', message: `PRD生成失败: ${error.message}` });
        res.end();
        return;
      }
    }
    
    // 阶段1: 原型生成（使用动态步骤执行）
    sendSSE(res, { 
      type: 'phase', 
      phase: 'prototype', 
      name: '原型生成',
      skill: '原型-skill'
    });
    
    // 使用动态步骤执行函数执行原型生成步骤
    const prototypeContext = {};
    const prototypeResults = await executeDynamicSteps(
      prototypeSteps, 
      scene, 
      PROTOTYPE_SYSTEM_PROMPT, 
      apiKey, 
      res, 
      'prototype',
      prototypeContext
    );
    
    // 提取HTML和YAML结果
    const html = prototypeContext.html || '';
    const yamlResult = prototypeResults[`step${prototypeSteps.length}`] || '';
    
    // 发送HTML结果
    sendSSE(res, {
      type: 'result',
      html: html,
      yaml: yamlResult
    });
    
    // 如果只生成原型，跳过PRD阶段
    if (actualMode === 'prototype') {
      // 完成
      sendSSE(res, {
        type: 'complete',
        progress: 100,
        html: html,
        prd: null,
        scene: scene
      });
      res.end();
      return;
    }
    
    // 阶段2: PRD生成（逐个步骤处理）
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
    
    // 步骤1: 原型解析
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 1,
      totalSteps: 8,
      stepData: { 
        title: '原型解析', 
        description: '提取页面结构、字段、交互、功能模块'
      },
      progress: 50,
      status: 'ai-generating'
    });
    
    const prdStep1Prompt = `业务场景：${scene}\n\nHTML原型（关键部分）：\n\`\`\`html\n${html.substring(0, 2000)}\n...\n\`\`\`\n\n请解析上述HTML原型，提取：\n1. 页面结构\n2. 关键字段\n3. 交互逻辑\n4. 功能模块\n\n输出结构化结果。`;
    
    const prdStep1Result = await callSiliconFlow(prdSkill, prdStep1Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 1,
        totalSteps: 8,
        stepData: { 
          title: '原型解析', 
          description: msg
        },
        progress: 52,
        status: 'ai-generating'
      });
    });
    
    // 步骤2: 业务提炼
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 2,
      totalSteps: 8,
      stepData: { 
        title: '业务提炼', 
        description: '补充角色、目标、痛点、业务场景'
      },
      progress: 54,
      status: 'ai-generating'
    });
    
    const prdStep2Prompt = `业务场景：${scene}\n\n原型解析结果：\n${prdStep1Result.substring(0, 1500)}\n\n请基于以上解析，提炼业务信息：\n1. 目标用户角色\n2. 核心价值目标\n3. 用户痛点\n4. 具体业务场景\n\n输出结构化结果。`;
    
    const prdStep2Result = await callSiliconFlow(prdSkill, prdStep2Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 2,
        totalSteps: 8,
        stepData: { 
          title: '业务提炼', 
          description: msg
        },
        progress: 56,
        status: 'ai-generating'
      });
    });
    
    // 步骤3: 业务章节
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 3,
      totalSteps: 8,
      stepData: { 
        title: '业务章节', 
        description: '编写业务背景、目标、范围'
      },
      progress: 58,
      status: 'ai-generating'
    });
    
    const prdStep3Prompt = `业务场景：${scene}\n\n业务提炼：\n${prdStep2Result.substring(0, 1500)}\n\n请编写PRD的业务章节：\n1. 业务背景\n2. 业务目标\n3. 需求范围\n4. 用户角色\n\n输出结构化结果。`;
    
    const prdStep3Result = await callSiliconFlow(prdSkill, prdStep3Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 3,
        totalSteps: 8,
        stepData: { 
          title: '业务章节', 
          description: msg
        },
        progress: 62,
        status: 'ai-generating'
      });
    });
    
    // 步骤4: 分析章节
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 4,
      totalSteps: 8,
      stepData: { 
        title: '分析章节', 
        description: '竞品分析、核心功能点'
      },
      progress: 64,
      status: 'ai-generating'
    });
    
    const prdStep4Prompt = `业务场景：${scene}\n\n业务章节：\n${prdStep3Result.substring(0, 1500)}\n\n请编写PRD的分析章节：\n1. 竞品分析\n2. 核心功能点\n3. 差异化优势\n\n输出结构化结果。`;
    
    const prdStep4Result = await callSiliconFlow(prdSkill, prdStep4Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 4,
        totalSteps: 8,
        stepData: { 
          title: '分析章节', 
          description: msg
        },
        progress: 68,
        status: 'ai-generating'
      });
    });
    
    // 步骤5: 方案框架
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 5,
      totalSteps: 8,
      stepData: { 
        title: '方案框架', 
        description: '构建系统架构、模块划分'
      },
      progress: 70,
      status: 'ai-generating'
    });
    
    const prdStep5Prompt = `业务场景：${scene}\n\n分析章节：\n${prdStep4Result.substring(0, 1500)}\n\n请设计方案框架：\n1. 系统架构\n2. 模块划分\n3. 技术选型\n\n输出结构化结果。`;
    
    const prdStep5Result = await callSiliconFlow(prdSkill, prdStep5Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 5,
        totalSteps: 8,
        stepData: { 
          title: '方案框架', 
          description: msg
        },
        progress: 74,
        status: 'ai-generating'
      });
    });
    
    // 步骤6: 功能模块
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 6,
      totalSteps: 8,
      stepData: { 
        title: '功能模块', 
        description: '生成各模块详细设计'
      },
      progress: 76,
      status: 'ai-generating'
    });
    
    const prdStep6Prompt = `业务场景：${scene}\n\n方案框架：\n${prdStep5Result.substring(0, 1500)}\n\n请设计各功能模块：\n1. 模块详细设计\n2. 接口定义\n3. 数据模型\n\n输出结构化结果。`;
    
    const prdStep6Result = await callSiliconFlow(prdSkill, prdStep6Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 6,
        totalSteps: 8,
        stepData: { 
          title: '功能模块', 
          description: msg
        },
        progress: 80,
        status: 'ai-generating'
      });
    });
    
    // 步骤7: 方案合并
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 7,
      totalSteps: 8,
      stepData: { 
        title: '方案合并', 
        description: '合并框架和模块'
      },
      progress: 82,
      status: 'ai-generating'
    });
    
    const prdStep7Prompt = `业务场景：${scene}\n\n业务章节：\n${prdStep3Result.substring(0, 800)}\n\n分析章节：\n${prdStep4Result.substring(0, 800)}\n\n方案框架：\n${prdStep5Result.substring(0, 800)}\n\n功能模块：\n${prdStep6Result.substring(0, 800)}\n\n请合并以上内容，形成完整的PRD文档结构。`;
    
    const prdStep7Result = await callSiliconFlow(prdSkill, prdStep7Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 7,
        totalSteps: 8,
        stepData: { 
          title: '方案合并', 
          description: msg
        },
        progress: 86,
        status: 'ai-generating'
      });
    });
    
    // 步骤8: PRD优化
    sendSSE(res, {
      type: 'progress',
      phase: 'prd',
      step: 8,
      totalSteps: 8,
      stepData: { 
        title: 'PRD优化', 
        description: '质量检查、格式优化'
      },
      progress: 88,
      status: 'ai-generating'
    });
    
    const prdStep8Prompt = `业务场景：${scene}\n\n合并后的PRD：\n${prdStep7Result.substring(0, 2000)}\n\n请优化PRD文档：\n1. 质量检查\n2. 格式优化\n3. 输出完整PRD（Markdown格式）`;
    
    const prdFinalResult = await callSiliconFlow(prdSkill, prdStep8Prompt, apiKey, (msg) => {
      sendSSE(res, {
        type: 'progress',
        phase: 'prd',
        step: 8,
        totalSteps: 8,
        stepData: { 
          title: 'PRD优化', 
          description: msg
        },
        progress: 92,
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
