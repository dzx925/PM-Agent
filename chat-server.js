// PM Agent - 对话式原型设计助手后端 API
// 支持指定步骤调用、修改已有原型、断点续传

const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// 中间件
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(express.json({ limit: '50mb' }));

// Skill 文件 URL
const SKILL_URLS = {
    prototype: 'https://raw.githubusercontent.com/dzx925/prototype-skill/main/SKILL.md',
    prd: 'https://raw.githubusercontent.com/dzx925/pm-prd-skills/main/prototype-to-prd-orchestrator/SKILL.md'
};

// 缓存
let skillCache = {
    prototype: null,
    prd: null,
    lastFetch: null
};
const CACHE_TTL = 60 * 60 * 1000;

// 任务管理
const generationTasks = new Map();

// Skill 步骤定义
const SKILL_STEPS = {
    business: { num: 1, name: '业务理解', batch: 1 },
    pages: { num: 2, name: '页面拆解', batch: 1 },
    components: { num: 3, name: '组件设计', batch: 1 },
    interaction: { num: 4, name: '交互逻辑', batch: 2 },
    prototype: { num: 5, name: '生成原型', batch: 3 },
    yaml: { num: 6, name: '结构化输出', batch: 3 }
};

// 获取 Skill 内容
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

// 调用 SiliconFlow API
async function callSiliconFlow(systemPrompt, userPrompt, apiKey, onProgress = null) {
    const maxRetries = 2;
    const timeout = 180000;
    const FREE_MODEL = 'Qwen/Qwen2.5-7B-Instruct';
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (onProgress) onProgress(`AI生成中 (尝试 ${attempt}/${maxRetries})...`);
            
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
            if (attempt === maxRetries) throw error;
            await sleep(2000 * attempt);
        }
    }
}

// 睡眠函数
function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// 发送 SSE 事件
function sendSSE(res, data) {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

// 获取或创建任务
function getGenerationTask(sessionId) {
    if (!generationTasks.has(sessionId)) {
        generationTasks.set(sessionId, {
            sessionId,
            createdAt: Date.now(),
            status: 'idle',
            currentPhase: null,
            currentStep: 0,
            intermediateResults: {}
        });
    }
    return generationTasks.get(sessionId);
}

// 主生成 API
app.post('/generate', async (req, res) => {
    const { 
        scene, 
        sessionId, 
        startFromStep = null, 
        intermediateResults = {},
        isModify = false 
    } = req.body;
    
    const apiKey = process.env.OPENAI_API_KEY;
    
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    
    if (!scene) {
        sendSSE(res, { type: 'error', message: '请提供业务场景描述' });
        res.end();
        return;
    }
    
    if (!apiKey) {
        sendSSE(res, { type: 'error', message: '服务器未配置 API Key' });
        res.end();
        return;
    }
    
    try {
        // 获取 Skill
        sendSSE(res, { type: 'status', message: '加载 Skill 配置...' });
        const [prototypeSkill, prdSkill] = await Promise.all([
            getSkillContent('prototype'),
            getSkillContent('prd')
        ]);
        
        // 确定开始步骤
        let startStepNum = 1;
        if (startFromStep && SKILL_STEPS[startFromStep]) {
            startStepNum = SKILL_STEPS[startFromStep].num;
            sendSSE(res, { 
                type: 'message', 
                message: `将从「${SKILL_STEPS[startFromStep].name}」开始设计，跳过前 ${startStepNum - 1} 个步骤` 
            });
        }
        
        // 恢复中间结果
        let batch1Result = intermediateResults.batch1Result || null;
        let batch2Result = intermediateResults.batch2Result || null;
        let html = intermediateResults.html || null;
        let yaml = intermediateResults.yaml || null;
        
        // ===== 批次1: 业务理解 + 页面拆解 + 组件设计 =====
        if (startStepNum <= 3) {
            sendSSE(res, { 
                type: 'phase', 
                phase: 'prototype', 
                name: '原型生成',
                skill: '原型-skill'
            });
            
            // 步骤1-3: 业务分析
            sendSSE(res, {
                type: 'progress',
                phase: 'prototype',
                step: 1,
                totalSteps: 6,
                stepData: { title: '业务分析中...', description: '理解业务场景、拆解页面、设计组件' },
                progress: 5,
                status: 'ai-generating'
            });
            
            const modifyPrefix = isModify ? '[修改模式] ' : '';
            const batch1Prompt = `${modifyPrefix}业务场景：${scene}

请分析上述业务场景，完成以下步骤：
1. 业务理解：提炼目标用户、核心价值、主流程
2. 页面拆解：确定所需页面/弹窗（列表页、详情页、表单页等）
3. 组件设计：定义关键字段、控件、校验规则

请用结构化方式输出分析结果。`;
            
            batch1Result = await callSiliconFlow(prototypeSkill, batch1Prompt, apiKey, (msg) => {
                sendSSE(res, {
                    type: 'progress',
                    phase: 'prototype',
                    step: 1,
                    totalSteps: 6,
                    stepData: { title: msg, description: '分析业务场景和页面结构...' },
                    progress: 10,
                    status: 'ai-generating'
                });
            });
            
            sendSSE(res, { type: 'result', batch1Result });
            
            // 标记步骤1-3完成
            for (let i = 1; i <= 3; i++) {
                sendSSE(res, {
                    type: 'progress',
                    phase: 'prototype',
                    step: i,
                    totalSteps: 6,
                    progress: 10 + i * 3,
                    status: 'completed'
                });
            }
        } else {
            sendSSE(res, { 
                type: 'message', 
                message: '跳过业务分析步骤（使用已有分析结果）' 
            });
            // 标记步骤1-3为已完成
            for (let i = 1; i <= 3; i++) {
                sendSSE(res, {
                    type: 'progress',
                    phase: 'prototype',
                    step: i,
                    totalSteps: 6,
                    progress: 10 + i * 3,
                    status: 'completed'
                });
            }
        }
        
        // ===== 批次2: 交互逻辑 =====
        if (startStepNum <= 4) {
            sendSSE(res, {
                type: 'progress',
                phase: 'prototype',
                step: 4,
                totalSteps: 6,
                stepData: { title: '设计交互逻辑...', description: '明确点击、跳转、弹窗、数据联动' },
                progress: 25,
                status: 'ai-generating'
            });
            
            const batch2Prompt = `业务场景：${scene}

前期分析结果：
${batch1Result.substring(0, 2000)}

请基于以上分析，设计详细的交互逻辑：
1. 页面间的跳转关系
2. 按钮点击的响应
3. 弹窗的触发和关闭
4. 数据联动规则
5. 状态变化处理`;
            
            batch2Result = await callSiliconFlow(prototypeSkill, batch2Prompt, apiKey, (msg) => {
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
            
            sendSSE(res, { type: 'result', batch2Result });
            
            sendSSE(res, {
                type: 'progress',
                phase: 'prototype',
                step: 4,
                totalSteps: 6,
                progress: 35,
                status: 'completed'
            });
        } else {
            sendSSE(res, { 
                type: 'message', 
                message: '跳过交互逻辑步骤（使用已有设计）' 
            });
            sendSSE(res, {
                type: 'progress',
                phase: 'prototype',
                step: 4,
                totalSteps: 6,
                progress: 35,
                status: 'completed'
            });
        }
        
        // ===== 批次3: 生成原型 + 结构化输出 =====
        if (startStepNum <= 6) {
            sendSSE(res, {
                type: 'progress',
                phase: 'prototype',
                step: 5,
                totalSteps: 6,
                stepData: { title: '生成HTML原型...', description: '输出完整可运行的HTML文件' },
                progress: 40,
                status: 'ai-generating'
            });
            
            const existingHtml = intermediateResults.html ? `

【现有原型HTML（供参考和修改）】
${intermediateResults.html.substring(0, 3000)}
` : '';
            
            const batch3Prompt = `业务场景：${scene}

前期分析：
${batch1Result.substring(0, 1500)}

交互设计：
${batch2Result.substring(0, 1500)}
${existingHtml}

请基于以上所有分析，生成：
1. 完整的HTML原型（单文件，内联CSS/JS，可直接运行）
2. 结构化YAML说明

HTML要求：
- 使用 Tailwind CSS（CDN引入）
- 包含所有页面和交互
- 中文界面，ToB风格
- 代码完整，无外部依赖

YAML要求：
- 严格遵循YAML格式
- 包含所有页面和组件定义`;
            
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
                              batch3Result.match(/<html[\s\S]*?<\/html>/);
            html = htmlMatch ? htmlMatch[1] || htmlMatch[0] : batch3Result;
            
            // 提取 YAML
            const yamlMatch = batch3Result.match(/```ya?ml\n?([\s\S]*?)```/) ||
                              batch3Result.match(/product_name:[\s\S]*/);
            yaml = yamlMatch ? yamlMatch[1] || yamlMatch[0] : '';
            
            sendSSE(res, { type: 'result', html, yaml });
            
            // 标记步骤5-6完成
            for (let i = 5; i <= 6; i++) {
                sendSSE(res, {
                    type: 'progress',
                    phase: 'prototype',
                    step: i,
                    totalSteps: 6,
                    progress: 45 + (i - 4) * 5,
                    status: 'completed'
                });
            }
        } else {
            sendSSE(res, { 
                type: 'message', 
                message: '使用已有原型结果' 
            });
            html = intermediateResults.html;
            yaml = intermediateResults.yaml;
        }
        
        // ===== PRD 生成 =====
        sendSSE(res, { 
            type: 'phase', 
            phase: 'prd', 
            name: 'PRD生成',
            skill: 'pm-prd-skills'
        });
        
        sendSSE(res, {
            type: 'progress',
            phase: 'prd',
            step: 1,
            totalSteps: 2,
            stepData: { title: '生成PRD文档...', description: '基于原型生成完整PRD' },
            progress: 55,
            status: 'ai-generating'
        });
        
        const prdPrompt = `业务场景：${scene}

HTML原型（关键部分）：
\`\`\`html
${html.substring(0, 2000)}
...
\`\`\`

YAML结构：
\`\`\`yaml
${yaml.substring(0, 1000)}
...
\`\`\`

请生成完整的产品需求文档（PRD），包含：
1. 项目概述
2. 业务背景和目标
3. 功能需求（基于原型页面）
4. 非功能需求
5. 数据需求
6. 项目计划

输出Markdown格式。`;
        
        const prdResult = await callSiliconFlow(prdSkill, prdPrompt, apiKey, (msg) => {
            sendSSE(res, {
                type: 'progress',
                phase: 'prd',
                step: 1,
                totalSteps: 2,
                stepData: { title: msg, description: '生成PRD文档...' },
                progress: 70,
                status: 'ai-generating'
            });
        });
        
        // 提取 PRD
        const prdMatch = prdResult.match(/```markdown\n?([\s\S]*?)```/) || 
                         prdResult.match(/# [\s\S]*/);
        const prd = prdMatch ? prdMatch[1] || prdMatch[0] : prdResult;
        
        sendSSE(res, { type: 'result', prd });
        
        sendSSE(res, {
            type: 'progress',
            phase: 'prd',
            step: 2,
            totalSteps: 2,
            progress: 90,
            status: 'completed'
        });
        
        // 完成
        sendSSE(res, {
            type: 'complete',
            progress: 100,
            scene,
            html,
            yaml,
            prd,
            intermediateResults: {
                batch1Result,
                batch2Result,
                html,
                yaml,
                prd
            }
        });
        
        res.end();
        
    } catch (error) {
        console.error('生成失败:', error.message);
        sendSSE(res, { type: 'error', message: error.message });
        res.end();
    }
});

// 获取任务状态
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
        createdAt: task.createdAt
    });
});

// 健康检查
app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        version: '2.0.0-chat'
    });
});

// 启动服务器
app.listen(PORT, () => {
    console.log(`🚀 PM Agent Chat Server 运行在端口 ${PORT}`);
    console.log(`📱 对话式原型设计助手已就绪`);
});
