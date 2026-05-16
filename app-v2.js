// HR Agent - 对话式原型设计助手
// API 基础 URL
const API_BASE_URL = 'https://pm-agent-nkmy.onrender.com';

// 全局状态
const state = {
    messages: [],
    currentProject: null,
    isGenerating: false,
    sessionId: generateSessionId(),
    startFromStep: null,
    generationMode: 'all', // 'all', 'prototype', 'prd'
    intermediateResults: {
        batch1Result: null,
        batch2Result: null,
        html: null,
        yaml: null,
        prd: null
    }
};

// 确认弹窗回调
let confirmCallback = null;

/**
 * 显示自定义确认弹窗
 * @param {string} title - 标题
 * @param {string} message - 内容
 * @param {Function} callback - 回调函数，参数为 boolean
 */
function showConfirmModal(title, message, callback) {
    confirmCallback = callback;
    document.getElementById('confirm-title').textContent = title;
    document.getElementById('confirm-message').textContent = message;
    document.getElementById('confirm-modal').style.display = 'flex';
}

/**
 * 关闭确认弹窗
 * @param {boolean} result - 用户选择的结果
 */
function closeConfirmModal(result) {
    document.getElementById('confirm-modal').style.display = 'none';
    if (confirmCallback) {
        confirmCallback(result);
        confirmCallback = null;
    }
}

/**
 * 显示提示弹窗
 * @param {string} title - 标题
 * @param {string} message - 内容
 */
function showAlert(title, message) {
    document.getElementById('alert-title').textContent = title;
    document.getElementById('alert-message').textContent = message;
    document.getElementById('alert-modal').style.display = 'flex';
}

// Skill 步骤定义
const SKILL_STEPS = {
    business: { num: 1, name: '业务理解', description: '提炼目标用户、核心价值、主流程' },
    pages: { num: 2, name: '页面拆解', description: '确定所需页面/弹窗' },
    components: { num: 3, name: '组件设计', description: '定义字段、控件、校验规则' },
    interaction: { num: 4, name: '交互逻辑', description: '明确点击、跳转、弹窗、数据联动' },
    prototype: { num: 5, name: '生成原型', description: '输出完整HTML文件' }
};

// 生成模式识别
const GENERATION_MODES = {
    prototype: {
        patterns: [
            /只[画做输出生]原型|只要原型|不需要PRD|不用PRD|只画页面|只输出原型/i
        ]
    },
    prd: {
        patterns: [
            /只[生成输]出?PRD|只要PRD|只要文档|不需要原型|不用原型|生成prd|输出prd|基于.*原型.*生成.*prd/i
        ]
    }
};

// 识别生成模式
function detectGenerationMode(message) {
    for (const [mode, config] of Object.entries(GENERATION_MODES)) {
        for (const pattern of config.patterns) {
            if (pattern.test(message)) {
                return mode;
            }
        }
    }
    return 'all'; // 默认全部生成
}

// 命令模式定义
const COMMAND_PATTERNS = {
    design: {
        patterns: [
            /^(帮我|给我|请)?(设计|创建|生成|做|开发)(一个|个)?(.+?)(系统|平台|页面|功能|模块|原型)?$/i,
            /^(我要|我想|需要)(做|设计|创建|生成)(一个|个)?(.+)$/i,
            /^从零开始(.+)$/i,
            /^新建(.+)$/i
        ],
        type: 'design',
        extract: (m) => m[4] || m[1]
    },
    modify: {
        patterns: [
            /^(修改|调整|优化|更新|改一下|改改)(.+?)(页面|部分|功能|组件|模块)?(的)?(.+)?$/i,
            /^(把|将)(.+?)(改成|改为|调整为|优化为)(.+)$/i,
            /^(添加|增加|插入)(一个|个)?(.+?)(到|在)?(.+)?$/i,
            /^(删除|移除|去掉)(.+?)(的)?(.+)?$/i
        ],
        type: 'modify',
        extract: (m) => m[2] || m[1]
    },
    startFromStep: {
        patterns: [
            /^(从|跳过到)(第)?(\d+|[一二三四五六])(步|步骤|阶段)开始$/i,
            /^(直接)?(从|跳过)?(.+?)(开始|做起)$/i,
            /^(跳过|省略)(.+?)(步骤|阶段)?[，,](.+)$/i
        ],
        type: 'startFromStep',
        extract: (m) => m[3] || m[2]
    },
    load: {
        patterns: [
            /^(加载|打开|导入|继续)(.+?)(项目|原型|文件|PRD)?$/i,
            /^(继续|接着)(修改|编辑|完善)(.+)$/i
        ],
        type: 'load',
        extract: (m) => m[2] || m[1]
    }
};

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('HR Agent 对话式原型设计助手已加载');
    loadSavedState();
    setupDragAndDrop();
    renderChatList();
});

// 生成会话ID
function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ========== 对话功能 ==========

// 发送或停止按钮处理
function handleSendOrStop() {
    if (state.isGenerating) {
        stopGeneration(currentProgressMessageId);
    } else {
        sendMessage();
    }
}

// 更新发送按钮状态（生成中显示停止，否则显示发送）
function updateSendButtonState() {
    const sendBtn = document.getElementById('send-btn');
    const sendIcon = sendBtn?.querySelector('.send-icon');
    const stopIcon = sendBtn?.querySelector('.stop-icon');

    if (!sendBtn) return;

    // 检查是否有进行中的进度消息
    const progressMsg = state.messages.find(m => m.isProgress && m.status === 'running');
    const isGenerating = !!progressMsg;

    if (isGenerating) {
        // 生成中 - 显示停止按钮
        sendBtn.classList.add('stop-mode');
        if (sendIcon) sendIcon.style.display = 'none';
        if (stopIcon) stopIcon.style.display = 'inline';
        sendBtn.title = '停止生成';
    } else {
        // 未生成 - 显示发送按钮
        sendBtn.classList.remove('stop-mode');
        if (sendIcon) sendIcon.style.display = 'block';
        if (stopIcon) stopIcon.style.display = 'none';
        sendBtn.title = '发送';
    }
}

function sendMessage() {
    const input = document.getElementById('chat-input');
    console.log('sendMessage: input元素=', input);
    console.log('sendMessage: input.value=', input?.value);
    console.log('sendMessage: input.value.trim()=', input?.value?.trim());
    
    const message = input?.value?.trim();
    
    console.log('sendMessage 被调用, message:', message, 'isGenerating:', state.isGenerating);
    
    if (!message) {
        console.log('消息为空，不发送');
        addMessage('assistant', '⚠️ 请输入内容后再发送');
        return;
    }
    
    if (state.isGenerating) {
        console.log('正在生成中，不发送新消息');
        return;
    }
    
    // 添加用户消息
    addMessage('user', message);
    input.value = '';
    autoResize(input);
    
    // 更新按钮状态
    updateSendButtonState();
    
    // 解析并执行命令
    const command = parseCommand(message);
    console.log('解析命令:', command);
    executeCommand(command, message);
}

function parseCommand(message) {
    for (const [cmdType, config] of Object.entries(COMMAND_PATTERNS)) {
        for (const pattern of config.patterns) {
            const matches = message.match(pattern);
            if (matches) {
                return {
                    type: config.type,
                    raw: message,
                    matches: matches,
                    target: config.extract ? config.extract(matches) : null
                };
            }
        }
    }
    return { type: 'design', raw: message, target: message };
}

async function executeCommand(command, rawMessage) {
    switch (command.type) {
        case 'design':
            await handleDesign(command);
            break;
        case 'modify':
            await handleModify(command);
            break;
        case 'startFromStep':
            handleStartFromStep(command);
            break;
        case 'load':
            await handleLoad(command);
            break;
        default:
            await handleDesign({ type: 'design', target: rawMessage });
    }
}

async function handleDesign(command) {
    console.log('handleDesign 被调用:', command);
    const scene = command.target || command.raw;
    
    if (!scene || scene.length < 5) {
        addMessage('assistant', '请详细描述一下你的HR业务场景，比如："帮我设计一个员工考勤系统，支持打卡、请假申请等功能"');
        return;
    }
    
    // 识别生成模式
    const mode = detectGenerationMode(command.raw);
    console.log('检测到的生成模式:', mode);
    state.generationMode = mode; // 记录生成模式
    const modeText = mode === 'prototype' ? '（仅生成原型）' : mode === 'prd' ? '（仅生成PRD）' : '';
    
    // 确认消息
    const stepInfo = state.startFromStep 
        ? `（从「${SKILL_STEPS[state.startFromStep].name}」开始）` 
        : '';
    
    addMessage('assistant', `收到！我来帮你设计「${scene.substring(0, 30)}...」${stepInfo}${modeText}\n\n开始生成，请稍候...`);
    
    // 开始生成
    console.log('调用 startGeneration, mode:', mode);
    await startGeneration(scene, false, mode);
}

async function handleModify(command) {
    if (!state.currentProject) {
        addMessage('assistant', '还没有可修改的原型。请先设计一个原型，或加载已有的项目。');
        return;
    }
    
    addMessage('assistant', `收到修改请求：「${command.raw}」\n\n我将基于现有原型进行修改...`);
    
    const modifyPrompt = `[修改需求] ${command.raw}\n\n现有原型HTML：\n${state.intermediateResults.html?.substring(0, 2000) || ''}\n\n请基于以上原型进行修改，只调整指定的部分。`;
    
    // 使用当前的生成模式（保持只生成原型或全部生成）
    await startGeneration(modifyPrompt, true, state.generationMode);
}

function handleStartFromStep(command) {
    const stepInput = command.target;
    const chineseNumbers = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5 };
    const stepNum = chineseNumbers[stepInput] || parseInt(stepInput);
    
    const stepKey = Object.keys(SKILL_STEPS).find(k => SKILL_STEPS[k].num === stepNum);
    
    if (stepKey) {
        state.startFromStep = stepKey;
        const step = SKILL_STEPS[stepKey];
        addMessage('assistant', `已设置从「${step.name}」开始设计。\n\n${step.description}\n\n请描述你的业务场景，我将跳过前面的步骤。`);
    } else {
        showStepSelector();
    }
}

async function handleLoad(command) {
    showLoadModal();
}

// ========== 生成核心功能 ==========

// 当前进度消息ID
let currentProgressMessageId = null;
// 步骤记录
let generationSteps = [];

// 后端发送的完整步骤列表
let allStepsFromBackend = [];

// 页面是否正在刷新/关闭
let isPageRefreshing = false;

// AbortController 用于中断 fetch 请求
let abortController = null;

// 监听页面刷新/关闭事件
window.addEventListener('beforeunload', () => {
    isPageRefreshing = true;
    // 如果正在生成，保存状态标记为中断
    if (state.isGenerating) {
        // 更新进度消息为中断状态
        const progressMsg = state.messages.find(m => m.isProgress && m.progress < 100);
        if (progressMsg) {
            progressMsg.progress = 100;
            progressMsg.status = 'interrupted';
        }
        // 保存状态（保持 isGenerating: true，让页面加载后知道需要恢复中断状态）
        localStorage.setItem('hr_agent_state', JSON.stringify({
            messages: state.messages.slice(-50),
            currentProject: state.currentProject,
            sessionId: state.sessionId,
            isGenerating: true
        }));
    }
    // 中断正在进行的 fetch 请求
    if (abortController) {
        abortController.abort();
        console.log('页面刷新，已中断请求');
    }
});

async function startGeneration(scene, isModify = false, mode = 'all') {
    console.log('开始生成:', { scene: scene.substring(0, 50), isModify, mode });
    state.isGenerating = true;
    generationSteps = [];
    allStepsFromBackend = []; // 重置步骤列表
    
    // 更新按钮状态为停止按钮
    updateSendButtonState();
    
    // 创建进度消息卡片（根据模式显示不同提示）
    currentProgressMessageId = addProgressMessage(mode);
    
    try {
        console.log('发送请求到:', `${API_BASE_URL}/generate`);
        console.log('请求体:', JSON.stringify({
            scene: scene.substring(0, 50),
            sessionId: state.sessionId,
            mode,
            isModify
        }));
        
        // 创建新的 AbortController
        abortController = new AbortController();
        
        let response;
        try {
            response = await fetch(`${API_BASE_URL}/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    scene,
                    sessionId: state.sessionId,
                    startFromStep: state.startFromStep,
                    intermediateResults: state.intermediateResults,
                    isModify,
                    mode
                }),
                signal: abortController.signal
            });
        } catch (fetchError) {
            // 如果是主动中断的请求，不显示错误
            if (fetchError.name === 'AbortError') {
                console.log('请求被中断');
                return;
            }
            console.error('Fetch 错误:', fetchError);
            throw new Error(`网络请求失败: ${fetchError.message}`);
        } finally {
            abortController = null;
        }
        
        console.log('收到响应:', response.status);
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = ''; // SSE 数据缓冲区
        
        console.log('开始读取 SSE 数据...');
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                console.log('SSE 读取完成');
                break;
            }
            
            const chunk = decoder.decode(value);
            console.log('收到 SSE 数据块:', chunk.substring(0, 100));
            buffer += chunk;
            
            // 处理完整的 SSE 消息（以\n\n结尾）
            const messages = buffer.split('\n\n');
            buffer = messages.pop(); // 保留不完整的部分
            
            console.log('处理消息数量:', messages.length);
            
            for (const message of messages) {
                console.log('处理消息:', message.substring(0, 100));
                const lines = message.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6);
                        console.log('解析 data:', jsonStr.substring(0, 100));
                        // 跳过 [DONE] 标记
                        if (jsonStr === '[DONE]') continue;
                        try {
                            const data = JSON.parse(jsonStr);
                            console.log('解析成功, 数据类型:', data.type);
                            handleSSEData(data);
                        } catch (e) {
                            console.error('解析SSE失败:', e, '内容:', jsonStr.substring(0, 200));
                        }
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('生成失败:', error);
        
        // 检查是否是页面刷新导致的错误
        if (isPageRefreshing) {
            console.log('页面正在刷新，不显示错误消息');
            return;
        }
        
        // 检查是否是网络错误（可能是用户主动刷新）
        if (error.message && (error.message.includes('network') || error.message.includes('fetch'))) {
            console.log('网络错误，可能是页面刷新导致');
            return;
        }
        
        // 显示错误给用户
        const errorMsg = error.message || '未知错误';
        updateProgressMessage(currentProgressMessageId, {
            status: 'error',
            error: errorMsg
        });
        addMessage('assistant', `❌ 生成失败：${errorMsg}`);
        
        // 确保状态重置
        state.isGenerating = false;
        updateSendButtonState();
    } finally {
        state.isGenerating = false;
        saveState();
        // 更新按钮状态为发送
        updateSendButtonState();
    }
}

function handleSSEData(data) {
    console.log('handleSSEData 收到数据:', data.type, data);
    switch (data.type) {
        case 'steps':
            // 接收后端发送的完整步骤列表
            console.log('接收到步骤消息:', data);
            if (data.prototypeSteps || data.prdSteps || data.prdSubSteps) {
                allStepsFromBackend = [
                    ...(data.prototypeSteps || []),
                    ...(data.prdSteps || []),
                    ...(data.prdSubSteps || [])
                ];
                console.log('初始化步骤列表:', allStepsFromBackend);
                // 保存步骤到消息对象，以便刷新后恢复
                const progressMsg = state.messages.find(m => m.id === currentProgressMessageId);
                if (progressMsg) {
                    progressMsg.allSteps = allStepsFromBackend;
                }
                // 初始化显示所有步骤（未开始状态）
                initProgressSteps(currentProgressMessageId, allStepsFromBackend);
            }
            break;
        case 'progress':
            console.log('接收到进度消息:', data.progress, data.stepData);
            // 记录步骤
            if (data.stepData?.title && !generationSteps.find(s => s.title === data.stepData.title)) {
                generationSteps.push({
                    title: data.stepData.title,
                    description: data.stepData.description,
                    progress: data.progress,
                    timestamp: Date.now()
                });
            }
            // 更新进度消息
            console.log('调用 updateProgressMessage, messageId:', currentProgressMessageId);
            updateProgressMessage(currentProgressMessageId, {
                progress: data.progress,
                currentStep: data.stepData?.title,
                description: data.stepData?.description,
                phase: data.phase,
                steps: generationSteps
            });
            break;
        case 'result':
            if (data.html) {
                state.intermediateResults.html = data.html;
                showHTML(data.html);
            }
            if (data.yaml) {
                state.intermediateResults.yaml = data.yaml;
                showYAML(data.yaml);
            }
            if (data.prd) {
                state.intermediateResults.prd = data.prd;
                showPRD(data.prd);
            }
            break;
        case 'complete':
            updateProgressMessage(currentProgressMessageId, {
                status: 'complete',
                progress: 100,
                steps: generationSteps
            });
            handleComplete(data);
            break;
        case 'error':
            updateProgressMessage(currentProgressMessageId, {
                status: 'error',
                error: data.message
            });
            addMessage('assistant', `❌ ${data.message}`);
            break;
        case 'message':
            addMessage('assistant', data.message);
            break;
    }
}

function handleComplete(data) {
    // 优先使用 data 中的结果，如果没有则使用 state.intermediateResults
    const html = data.html || state.intermediateResults.html;
    const yaml = data.yaml || state.intermediateResults.yaml;
    const prd = data.prd || state.intermediateResults.prd;
    
    // 更新 state.intermediateResults
    if (html) state.intermediateResults.html = html;
    if (yaml) state.intermediateResults.yaml = yaml;
    if (prd) state.intermediateResults.prd = prd;
    
    // 保存项目
    const project = {
        id: 'proj_' + Date.now(),
        name: data.scene?.substring(0, 30) || '未命名项目',
        scene: data.scene,
        html: html,
        yaml: yaml,
        prd: prd,
        createdAt: new Date().toISOString()
    };
    
    saveProject(project);
    state.currentProject = project;
    
    // 根据实际返回的结果显示完成消息
    let generatedItems = [];
    if (html) generatedItems.push('🎨 HTML原型');
    if (prd) generatedItems.push('📝 PRD文档');
    if (yaml) generatedItems.push('📋 YAML结构');
    
    const itemsText = generatedItems.length > 0 ? generatedItems.join('\n') : '未生成内容';
    
    addMessage('assistant', `✅ 生成完成！\n\n已为你生成：\n${itemsText}\n\n点击卡片查看详情，或下载使用。`);
    
    // 重置开始步骤
    state.startFromStep = null;
    
    // 更新按钮状态为发送
    updateSendButtonState();
}

// ========== 消息显示 ==========

function addMessage(role, content) {
    const message = {
        role,
        content,
        timestamp: Date.now(),
        id: Date.now() + Math.random()
    };
    
    state.messages.push(message);
    renderMessage(message);
    
    const container = document.getElementById('chat-messages');
    if (container) {
        container.scrollTop = container.scrollHeight;
    }
}

function renderMessage(message) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    // 移除欢迎卡片
    const welcome = container.querySelector('.welcome-card');
    if (welcome) welcome.remove();
    
    const div = document.createElement('div');
    div.className = `message ${message.role}`;
    div.id = `msg-${message.id}`;
    
    const avatar = message.role === 'user' ? '👤' : '🤖';
    const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    
    // 如果是进度消息，使用进度卡片样式
    if (message.isProgress) {
        div.classList.add('progress-message');
        // 根据进度状态显示不同文本
        let statusText = '🚀 正在生成...';
        let showPercent = true;
        if (message.status === 'interrupted') {
            statusText = '❌ 已终止';
            showPercent = false;
        } else if (message.status === 'error') {
            statusText = '❌ 生成失败';
            showPercent = false;
        } else if (message.status === 'complete' || message.progress >= 100) {
            statusText = '✅ 生成完成';
        }
        const percentText = showPercent ? `${message.progress || 0}%` : '';
        div.innerHTML = `
            <div class="message-avatar">${avatar}</div>
            <div class="message-body">
                <div class="progress-card">
                    <div class="progress-header">
                        <span class="progress-status">${statusText}</span>
                        <span class="progress-percent">${percentText}</span>
                    </div>
                    <div class="progress-bar-container">
                        <div class="progress-bar-fill" style="width: ${message.progress || 0}%"></div>
                    </div>
                    <div class="progress-current-step">${message.currentStep || '准备开始...'}</div>
                    <div class="progress-steps-list">
                        ${(message.allSteps || message.steps || []).map((step, index) => `
                            <div class="progress-step-item ${step.completed ? 'completed' : ''}" data-step-title="${step.title || step}">
                                <span class="step-num ${step.completed ? 'completed' : ''}">${step.completed ? '✓' : index + 1}</span>
                                <span class="step-title">${step.title || step}</span>
                            </div>
                        `).join('')}
                    </div>
                </div>
                <div class="message-time">${time}</div>
            </div>
        `;
    } else if (message.isResult) {
        // 结果卡片消息
        div.classList.add('result-message');
        let icon = '🎨';
        if (message.resultType === 'prd') icon = '📝';
        if (message.resultType === 'yaml') icon = '📋';
        
        div.innerHTML = `
            <div class="message-avatar">${avatar}</div>
            <div class="message-body">
                <div class="result-card" onclick="openResultPreview('${message.resultType}')">
                    <div class="result-card-header">
                        <span class="result-icon">${icon}</span>
                        <span class="result-title">${message.resultTitle || '查看详情'}</span>
                    </div>
                    <div class="result-card-body">
                        <span class="result-hint">点击查看详情</span>
                    </div>
                </div>
                <div class="message-time">${time}</div>
            </div>
        `;
    } else {
        // 普通消息
        div.innerHTML = `
            <div class="message-avatar">${avatar}</div>
            <div class="message-body">
                <div class="message-content">${escapeHtml(message.content).replace(/\n/g, '<br>')}</div>
                <div class="message-time">${time}</div>
            </div>
        `;
    }
    
    container.appendChild(div);
}

// ========== 预览显示 ==========

// 当前生成的结果数据
let currentResult = {
    html: null,
    prd: null,
    yaml: null
};

function showHTML(html) {
    // 保存到当前结果
    currentResult.html = html;
    
    // 更新预览面板
    updateHTMLPreview(html);
    
    // 添加结果卡片消息到对话
    addResultCardMessage('html', 'HTML原型');
}

function showPRD(prd) {
    // 保存到当前结果
    currentResult.prd = prd;
    
    // 更新预览面板
    updatePRDPreview(prd);
    
    // 添加结果卡片消息到对话
    addResultCardMessage('prd', 'PRD文档');
}

function showYAML(yaml) {
    // 保存到当前结果
    currentResult.yaml = yaml;
    
    // 更新预览面板
    updateYAMLPreview(yaml);
    
    // 添加结果卡片消息到对话
    addResultCardMessage('yaml', 'YAML结构');
}

// 仅更新HTML预览面板（不添加结果卡片）
function updateHTMLPreview(html) {
    const frame = document.getElementById('html-preview');
    const empty = document.getElementById('html-empty');
    
    if (frame && empty) {
        frame.srcdoc = html;
        frame.style.display = 'block';
        empty.style.display = 'none';
    }
}

// 仅更新YAML预览面板（不添加结果卡片）
function updateYAMLPreview(yaml) {
    const render = document.getElementById('yaml-render');
    const empty = document.getElementById('yaml-empty');
    
    if (render && empty) {
        render.textContent = yaml;
        render.style.display = 'block';
        empty.style.display = 'none';
    }
}

// 仅更新PRD预览面板（不添加结果卡片）
function updatePRDPreview(prd) {
    const render = document.getElementById('prd-render');
    const empty = document.getElementById('prd-empty');
    
    if (render && empty) {
        render.innerHTML = renderMarkdown(prd);
        render.style.display = 'block';
        empty.style.display = 'none';
    }
}

// 添加结果卡片消息
function addResultCardMessage(type, title) {
    const container = document.getElementById('chat-messages');
    if (!container) return;
    
    const messageId = 'result_' + type + '_' + Date.now();
    const timestamp = Date.now();
    
    // 创建消息对象
    const resultMessage = {
        role: 'assistant',
        content: '',
        timestamp: timestamp,
        id: messageId,
        isResult: true,
        resultType: type,
        resultTitle: title
    };
    state.messages.push(resultMessage);
    
    // 创建消息元素
    const div = document.createElement('div');
    div.className = 'message assistant result-message';
    div.id = messageId;
    
    let icon = '🎨';
    if (type === 'prd') icon = '📝';
    if (type === 'yaml') icon = '📋';
    
    div.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-body">
            <div class="result-card" onclick="openResultPreview('${type}')">
                <div class="result-card-header">
                    <span class="result-icon">${icon}</span>
                    <span class="result-title">${title}</span>
                </div>
                <div class="result-card-body">
                    <span class="result-hint">点击查看详情</span>
                </div>
            </div>
            <div class="message-time">${new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
    `;
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    
    saveState();
}

// 打开指定类型的结果预览
function openResultPreview(type) {
    // 在新窗口打开结果
    const resultData = currentResult[type];
    if (!resultData) {
        showAlert('提示', '暂无内容可查看');
        return;
    }
    
    // 打开新窗口
    const newWindow = window.open('', '_blank');
    if (!newWindow) {
        showAlert('提示', '请允许弹出窗口以查看详情');
        return;
    }
    
    // 根据类型渲染不同内容
    let title = '';
    let content = '';
    
    switch(type) {
        case 'html':
            title = 'HTML原型预览';
            // 直接写入HTML内容
            newWindow.document.write(resultData);
            newWindow.document.close();
            return; // HTML直接写入后返回
            
        case 'prd':
            title = 'PRD文档';
            content = renderMarkdown(resultData);
            break;
            
        case 'yaml':
            title = 'YAML结构';
            content = `<pre style="background:#1a202c;color:#e2e8f0;padding:20px;overflow:auto;height:100vh;margin:0;font-family:monospace;font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word;">${escapeHtml(resultData)}</pre>`;
            break;
            
        default:
            title = '查看详情';
            content = `<pre>${escapeHtml(resultData)}</pre>`;
    }
    
    // 写入PRD或YAML内容
    newWindow.document.write(`
        <!DOCTYPE html>
        <html lang="zh-CN">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <style>
                * { margin: 0; padding: 0; box-sizing: border-box; }
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', sans-serif;
                    background: #f5f7fa;
                    padding: 40px 20px;
                    line-height: 1.8;
                }
                .container {
                    max-width: 800px;
                    margin: 0 auto;
                    background: white;
                    padding: 40px;
                    border-radius: 12px;
                    box-shadow: 0 4px 20px rgba(0,0,0,0.1);
                }
                h1 { font-size: 28px; margin-bottom: 20px; color: #2d3748; border-bottom: 2px solid #e9ecef; padding-bottom: 10px; }
                h2 { font-size: 22px; margin: 30px 0 15px; color: #2d3748; }
                h3 { font-size: 18px; margin: 20px 0 10px; color: #2d3748; }
                p { margin-bottom: 12px; color: #4a5568; }
                ul { margin: 12px 0; padding-left: 24px; }
                li { margin: 6px 0; }
                code { background: #f5f7fa; padding: 2px 6px; border-radius: 4px; font-family: 'Monaco', 'Consolas', monospace; font-size: 13px; }
                pre { background: #1a202c; color: #e2e8f0; padding: 20px; border-radius: 8px; overflow: auto; font-family: 'Monaco', 'Consolas', monospace; font-size: 13px; line-height: 1.6; }
                .header {
                    text-align: center;
                    margin-bottom: 30px;
                    padding-bottom: 20px;
                    border-bottom: 1px solid #e9ecef;
                }
                .header h1 { border: none; margin: 0; }
                .header .subtitle { color: #718096; font-size: 14px; margin-top: 8px; }
                .download-btn {
                    position: fixed;
                    top: 20px;
                    right: 20px;
                    padding: 10px 20px;
                    background: #667eea;
                    color: white;
                    border: none;
                    border-radius: 8px;
                    cursor: pointer;
                    font-size: 14px;
                    z-index: 1000;
                }
                .download-btn:hover { background: #764ba2; }
            </style>
        </head>
        <body>
            <button class="download-btn" onclick="downloadContent()">💾 下载</button>
            <div class="container">
                <div class="header">
                    <h1>${title}</h1>
                    <div class="subtitle">由 HR Agent 生成</div>
                </div>
                ${content}
            </div>
            <script>
                function downloadContent() {
                    const content = ${JSON.stringify(resultData)};
                    const blob = new Blob([content], { type: 'text/html' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = '${type === 'prd' ? 'PRD文档.md' : type === 'yaml' ? 'structure.yaml' : 'prototype.html'}';
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }
            </script>
        </body>
        </html>
    `);
    newWindow.document.close();
}

function renderMarkdown(md) {
    return md
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\*(.+?)\*/g, '<em>$1</em>')
        .replace(/`(.+?)`/g, '<code>$1</code>')
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/(<li>.+<\/li>\n?)+/g, '<ul>$&</ul>')
        .replace(/\n/g, '<br>');
}

// ========== 进度消息（嵌入对话） ==========

function addProgressMessage(mode = 'all') {
    const container = document.getElementById('chat-messages');
    if (!container) return null;
    
    // 移除欢迎卡片
    const welcome = container.querySelector('.welcome-card');
    if (welcome) welcome.remove();
    
    const messageId = 'progress_' + Date.now();
    const timestamp = Date.now();
    
    // 根据模式确定提示文本
    let statusText = '🚀 正在生成...';
    let contentText = '🚀 正在生成...';
    if (mode === 'prototype') {
        statusText = '🎨 正在生成原型...';
        contentText = '🎨 正在生成原型...';
    } else if (mode === 'prd') {
        statusText = '📝 正在生成PRD...';
        contentText = '📝 正在生成PRD...';
    }
    
    // 创建进度消息对象并添加到 state.messages
    const progressMessage = {
        role: 'assistant',
        content: contentText,
        timestamp: timestamp,
        id: messageId,
        isProgress: true,  // 标记为进度消息
        status: 'running',  // 初始状态为进行中
        progress: 0,
        steps: []
    };
    state.messages.push(progressMessage);
    
    const div = document.createElement('div');
    div.className = 'message assistant progress-message';
    div.id = messageId;
    
    div.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-body">
            <div class="progress-card">
                <div class="progress-header">
                    <span class="progress-status">${statusText}</span>
                    <span class="progress-percent">0%</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: 0%"></div>
                </div>
                <div class="progress-current-step">准备开始...</div>
                <div class="progress-steps-list"></div>
            </div>
            <div class="message-time">${new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
    `;
    
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
    
    return messageId;
}

// 初始化步骤列表（接收后端发送的所有步骤）
function initProgressSteps(messageId, steps) {
    const messageEl = document.getElementById(messageId);
    if (!messageEl) return;
    
    const stepsListEl = messageEl.querySelector('.progress-steps-list');
    if (!stepsListEl) return;
    
    // 生成步骤HTML（第一个标记为进行中，其余未开始）
    const stepsHtml = steps.map((step, index) => {
        const isFirst = index === 0;
        return `
            <div class="progress-step-item ${isFirst ? 'current' : ''}" data-step-title="${step.title}">
                <span class="step-num ${isFirst ? 'spinner' : ''}">${isFirst ? '' : index + 1}</span>
                <span class="step-title">${step.title}</span>
                <span class="step-status ${isFirst ? 'pulsing' : ''}">${isFirst ? '进行中...' : ''}</span>
            </div>
        `;
    }).join('');
    
    stepsListEl.innerHTML = stepsHtml;
    
    // 滚动到底部
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
}

function updateProgressMessage(messageId, data) {
    console.log('updateProgressMessage 被调用:', messageId, data);
    // 同时更新 state.messages 中的进度消息
    const msgIndex = state.messages.findIndex(m => m.id === messageId);
    if (msgIndex !== -1) {
        const msg = state.messages[msgIndex];
        if (data.progress !== undefined) msg.progress = data.progress;
        if (data.currentStep) msg.currentStep = data.currentStep;
        if (data.status === 'complete') msg.progress = 100;
        // 更新步骤状态
        if (data.steps) {
            msg.steps = data.steps.map((step, index) => ({
                title: step.title || step,
                completed: index < (data.progress / 100) * data.steps.length
            }));
        }
    }
    
    const messageEl = document.getElementById(messageId);
    if (!messageEl) {
        console.error('updateProgressMessage: 找不到消息元素', messageId);
        return;
    }
    
    const progressCard = messageEl.querySelector('.progress-card');
    if (!progressCard) {
        console.error('updateProgressMessage: 找不到进度卡片');
        return;
    }
    
    console.log('updateProgressMessage: 更新UI, progress=', data.progress);
    
    // 更新进度条
    const progressBar = progressCard.querySelector('.progress-bar-fill');
    const progressPercent = progressCard.querySelector('.progress-percent');
    const currentStepEl = progressCard.querySelector('.progress-current-step');
    const statusEl = progressCard.querySelector('.progress-status');
    
    if (data.progress !== undefined) {
        if (progressBar) progressBar.style.width = `${data.progress}%`;
        if (progressPercent) progressPercent.textContent = `${data.progress}%`;
    }
    
    // 更新当前步骤
    if (data.currentStep && currentStepEl) {
        currentStepEl.textContent = data.description || data.currentStep;
    }
    
    // 更新状态
    if ((data.status === 'complete' || data.progress >= 100) && statusEl) {
        statusEl.textContent = '✅ 生成完成';
        progressCard.classList.add('complete');
        // 更新进度条为100%
        if (progressBar) progressBar.style.width = '100%';
        if (progressPercent) progressPercent.textContent = '100%';
    } else if (data.status === 'error' && statusEl) {
        statusEl.textContent = '❌ 生成失败';
        progressCard.classList.add('error');
        // 清除百分比显示
        if (progressPercent) progressPercent.textContent = '';
    } else if (data.status === 'interrupted' && statusEl) {
        statusEl.textContent = '❌ 已终止';
        progressCard.classList.add('interrupted');
        // 清除百分比显示
        if (progressPercent) progressPercent.textContent = '';
    }
    
    // 更新步骤列表 - 根据当前进度更新每个步骤的状态
    const stepItems = progressCard.querySelectorAll('.progress-step-item');
    
    // 如果没有后端步骤，使用 generationSteps
    const stepsToRender = allStepsFromBackend.length > 0 ? allStepsFromBackend : generationSteps;
    
    // 找到当前正在进行的步骤索引
    let currentStepIndex = -1;
    console.log('updateProgressMessage: data.currentStep=', data.currentStep);
    console.log('updateProgressMessage: stepsToRender=', stepsToRender.map(s => s.title || s));
    if (data.currentStep) {
        currentStepIndex = stepsToRender.findIndex(s => {
            const stepTitle = s.title || s;
            const match = data.currentStep === stepTitle || 
                data.currentStep.includes(stepTitle) ||
                stepTitle.includes(data.currentStep);
            console.log(`  检查步骤 "${stepTitle}": ${match}`);
            return match;
        });
        console.log('updateProgressMessage: currentStepIndex=', currentStepIndex);
    }
    
    // 如果生成完成，所有步骤都标记为完成
    const isComplete = data.status === 'complete' || data.progress >= 100;
    
    stepItems.forEach((item, index) => {
        const step = stepsToRender[index];
        if (!step) return;
        
        const stepNum = item.querySelector('.step-num');
        const stepStatus = item.querySelector('.step-status');
        
        // 判断步骤状态
        const isCompleted = isComplete || index < currentStepIndex;
        const isCurrent = !isComplete && index === currentStepIndex;
        
        // 更新样式 - 清除所有状态类
        item.classList.remove('completed', 'current');
        if (stepNum) stepNum.classList.remove('done', 'active', 'completed', 'spinner');
        if (stepStatus) stepStatus.classList.remove('pulsing');
        
        if (isCompleted) {
            // 已完成 - 显示绿色勾选
            item.classList.add('completed');
            if (stepNum) {
                stepNum.textContent = '✓';
                stepNum.classList.add('completed');
            }
            if (stepStatus) stepStatus.textContent = '';
        } else if (isCurrent) {
            // 进行中 - 显示转圈圈动画
            item.classList.add('current');
            if (stepNum) {
                stepNum.textContent = '';
                stepNum.classList.add('spinner');
            }
            if (stepStatus) {
                stepStatus.textContent = '进行中...';
                stepStatus.classList.add('pulsing');
            }
        } else {
            // 未开始 - 显示数字
            if (stepNum) {
                stepNum.textContent = index + 1;
            }
            if (stepStatus) stepStatus.textContent = '';
        }
    });
    
    // 滚动到底部
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
}

// 停止生成
async function stopGeneration(messageId) {
    // 检查是否有进行中的进度消息
    const progressMsg = state.messages.find(m => m.isProgress && m.status === 'running');
    if (!progressMsg) return;

    try {
        const response = await fetch(`${API_BASE_URL}/pause`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sessionId: state.sessionId })
        });

        if (response.ok) {
            updateProgressMessage(messageId, {
                status: 'interrupted'
                // 不设置 progress，保持原进度
            });
            // 更新按钮状态为发送
            updateSendButtonState();
            addMessage('assistant', '⏹ 已停止生成。你可以修改需求后重新生成。');
        }
    } catch (error) {
        console.error('停止生成失败:', error);
    }
}

// ========== 标签切换 ==========

function switchTab(tab) {
    // 更新标签按钮
    document.querySelectorAll('.preview-tab').forEach(btn => btn.classList.remove('active'));
    document.getElementById(`tab-${tab}`)?.classList.add('active');
    
    // 更新视图
    document.querySelectorAll('.preview-view').forEach(view => view.classList.remove('active'));
    document.getElementById(`view-${tab}`)?.classList.add('active');
}

// ========== 弹窗功能 ==========

function showStepSelector() {
    document.getElementById('step-modal').style.display = 'flex';
}

function showUploadModal() {
    document.getElementById('upload-modal').style.display = 'flex';
}

function showHistoryModal() {
    // 渲染历史对话列表到新弹窗
    renderHistoryListModal();
    
    // 显示独立的历史对话弹窗
    document.getElementById('history-modal').style.display = 'flex';
}

// 渲染左侧历史对话列表
function renderChatList() {
    const list = document.getElementById('chat-list');
    if (!list) return;
    
    const history = getChatHistory();
    
    if (history.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #999; padding: 20px; font-size: 13px;">暂无历史对话</p>';
        return;
    }
    
    // 按时间倒序排列
    const sortedHistory = history.sort((a, b) => b.updatedAt - a.updatedAt);
    
    list.innerHTML = sortedHistory.map(h => {
        const isActive = state.currentSessionId === h.id;
        const title = h.title || '新对话';
        const time = new Date(h.updatedAt).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
        return `
        <div class="chat-list-item ${isActive ? 'active' : ''}" data-id="${h.id}" onclick="loadChatHistory('${h.id}')">
            <div class="chat-list-title">${escapeHtml(title)}</div>
            <div class="chat-list-time">${time}</div>
        </div>
    `}).join('');
}

function renderHistoryListModal() {
    const list = document.getElementById('history-list-modal');
    if (!list) return;
    
    const history = getChatHistory();
    
    if (history.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">暂无历史对话</p>';
        return;
    }
    
    list.innerHTML = history.map(h => `
        <div class="history-item" data-id="${h.id}">
            <div class="history-info" onclick="loadChatHistory('${h.id}'); closeModal('history-modal');">
                <div class="history-title">${escapeHtml(h.title)}</div>
                <div class="history-date">${new Date(h.updatedAt).toLocaleString('zh-CN')}</div>
            </div>
            <button class="history-delete" onclick="deleteChatHistory('${h.id}', event)" title="删除">×</button>
        </div>
    `).join('');
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

// 打开预览面板
function openPreviewPanel() {
    document.getElementById('preview-panel').style.display = 'flex';
}

// 关闭预览面板
function closePreviewPanel() {
    document.getElementById('preview-panel').style.display = 'none';
}

function selectStartStep(stepKey) {
    state.startFromStep = stepKey;
    const step = SKILL_STEPS[stepKey];
    addMessage('assistant', `已选择从「${step.name}」开始设计。请描述你的业务场景。`);
    closeModal('step-modal');
}

// ========== 项目加载/保存 ==========

function renderProjectList() {
    const grid = document.getElementById('project-grid');
    if (!grid) return;
    
    const projects = getSavedProjects();
    
    if (projects.length === 0) {
        grid.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">暂无保存的项目</p>';
        return;
    }
    
    grid.innerHTML = projects.map(p => `
        <div class="project-card" onclick="loadProject('${p.id}')">
            <div class="project-icon">🎨</div>
            <div class="project-name">${escapeHtml(p.name)}</div>
            <div class="project-date">${new Date(p.createdAt).toLocaleString('zh-CN')}</div>
        </div>
    `).join('');
}

function getSavedProjects() {
    const data = localStorage.getItem('hr_agent_projects');
    return data ? JSON.parse(data) : [];
}

function saveProject(project) {
    const projects = getSavedProjects();
    projects.unshift(project);
    if (projects.length > 20) projects.pop();
    localStorage.setItem('hr_agent_projects', JSON.stringify(projects));
}

// ========== 历史对话管理 ==========

function getChatHistory() {
    const data = localStorage.getItem('hr_agent_chat_history');
    return data ? JSON.parse(data) : [];
}

function saveChatToHistory() {
    if (state.messages.length === 0) return;
    
    const history = getChatHistory();
    const firstUserMessage = state.messages.find(m => m.role === 'user');
    const title = firstUserMessage ? firstUserMessage.content.substring(0, 30) + '...' : '未命名对话';
    
    const chatRecord = {
        id: state.sessionId,
        title: title,
        messages: state.messages,
        currentProject: state.currentProject,
        intermediateResults: state.intermediateResults,
        updatedAt: new Date().toISOString()
    };
    
    // 更新或添加新记录
    const existingIndex = history.findIndex(h => h.id === state.sessionId);
    if (existingIndex >= 0) {
        history[existingIndex] = chatRecord;
    } else {
        history.unshift(chatRecord);
    }
    
    // 最多保留20条历史记录
    if (history.length > 20) history.pop();
    
    localStorage.setItem('hr_agent_chat_history', JSON.stringify(history));
    renderChatList();
}

function renderHistoryList() {
    const list = document.getElementById('history-list');
    if (!list) return;
    
    const history = getChatHistory();
    
    if (history.length === 0) {
        list.innerHTML = '<p style="text-align: center; color: #999; padding: 40px;">暂无历史对话</p>';
        return;
    }
    
    list.innerHTML = history.map(h => `
        <div class="history-item" data-id="${h.id}">
            <div class="history-info" onclick="loadChatHistory('${h.id}')">
                <div class="history-title">${escapeHtml(h.title)}</div>
                <div class="history-date">${new Date(h.updatedAt).toLocaleString('zh-CN')}</div>
            </div>
            <button class="history-delete" onclick="deleteChatHistory('${h.id}', event)" title="删除">×</button>
        </div>
    `).join('');
}

function loadChatHistory(chatId) {
    const history = getChatHistory();
    const chat = history.find(h => h.id === chatId);
    
    if (chat) {
        state.sessionId = chat.id;
        state.messages = chat.messages || [];
        state.currentProject = chat.currentProject || null;
        state.intermediateResults = chat.intermediateResults || {
            batch1Result: null,
            batch2Result: null,
            html: null,
            yaml: null,
            prd: null
        };
        
        // 重新渲染消息
        const container = document.getElementById('chat-messages');
        if (container) {
            container.innerHTML = '';
            if (state.messages.length === 0) {
                // 显示欢迎卡片
                container.innerHTML = `
                    <div class="welcome-card">
                        <div class="welcome-icon">👋</div>
                        <h3>我是你的HR系统原型助手</h3>
                        <p>输入HR业务场景，我帮你自动生成原型和PRD</p>
                        <div class="command-examples">
                            <div class="cmd-example" onclick="insertCommand('帮我设计一个员工考勤系统，支持打卡、请假、加班审批')">
                                <span class="cmd-label">设计</span>
                                <span>帮我设计一个员工考勤系统...</span>
                            </div>
                            <div class="cmd-example" onclick="insertCommand('修改登录页面，添加验证码功能')">
                                <span class="cmd-label">修改</span>
                                <span>修改登录页面，添加验证码...</span>
                            </div>
                            <div class="cmd-example" onclick="insertCommand('从第3步开始，设计薪酬系统')">
                                <span class="cmd-label">步骤</span>
                                <span>从第3步开始，设计薪酬系统...</span>
                            </div>
                        </div>
                    </div>
                `;
            } else {
                state.messages.forEach(m => renderMessage(m));
            }
        }
        
        // 恢复预览（仅更新预览面板，不添加结果卡片到对话）
        if (state.intermediateResults.html) updateHTMLPreview(state.intermediateResults.html);
        if (state.intermediateResults.yaml) updateYAMLPreview(state.intermediateResults.yaml);
        if (state.intermediateResults.prd) updatePRDPreview(state.intermediateResults.prd);
        
        closeModal('load-modal');
        saveState();
        renderChatList();
        
        addMessage('assistant', `已加载历史对话「${chat.title}」。你可以继续对话。`);
    }
}

function deleteChatHistory(chatId, event) {
    if (event) event.stopPropagation();
    
    showConfirmModal('删除确认', '确定要删除这条历史对话吗？', (confirmed) => {
        if (confirmed) {
            let history = getChatHistory();
            history = history.filter(h => h.id !== chatId);
            localStorage.setItem('hr_agent_chat_history', JSON.stringify(history));
            renderHistoryList();
        }
    });
}

function loadProject(projectId) {
    const projects = getSavedProjects();
    const project = projects.find(p => p.id === projectId);
    
    if (project) {
        state.currentProject = project;
        state.intermediateResults.html = project.html;
        state.intermediateResults.yaml = project.yaml;
        state.intermediateResults.prd = project.prd;
        
        if (project.html) showHTML(project.html);
        if (project.yaml) showYAML(project.yaml);
        if (project.prd) showPRD(project.prd);
        
        addMessage('assistant', `已加载项目「${project.name}」。你可以继续修改或查看。`);
        closeModal('load-modal');
        saveState();
    }
}

function handleFileUpload(event) {
    const files = event.target.files;
    
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const project = {
                id: 'proj_' + Date.now(),
                name: file.name.replace(/\.[^/.]+$/, ''),
                html: file.name.endsWith('.html') ? content : null,
                prd: file.name.endsWith('.md') ? content : null,
                yaml: file.name.endsWith('.yaml') ? content : null,
                createdAt: new Date().toISOString()
            };
            
            saveProject(project);
            loadProject(project.id);
            addMessage('assistant', `已导入文件「${file.name}」。`);
        };
        reader.readAsText(file);
    });
    
    closeModal('load-modal');
}

function setupDragAndDrop() {
    const zone = document.getElementById('upload-zone');
    if (!zone) return;
    
    zone.addEventListener('dragover', (e) => {
        e.preventDefault();
        zone.classList.add('dragover');
    });
    
    zone.addEventListener('dragleave', () => {
        zone.classList.remove('dragover');
    });
    
    zone.addEventListener('drop', (e) => {
        e.preventDefault();
        zone.classList.remove('dragover');
        handleFileUpload({ target: { files: e.dataTransfer.files } });
    });
}

// ========== 工具函数 ==========

function insertCommand(cmd) {
    const input = document.getElementById('chat-input');
    input.value = cmd;
    autoResize(input);
    input.focus();
}

function autoResize(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function handleInputKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 格式化消息内容（处理换行等）
function formatMessageContent(content) {
    if (!content) return '';
    return escapeHtml(content).replace(/\n/g, '<br>');
}

function startNewChat() {
    showConfirmModal('新建对话', '确定要新建对话吗？当前进度已自动保存。', (confirmed) => {
        if (confirmed) {
            state.messages = [];
            state.currentProject = null;
            state.sessionId = generateSessionId();
            state.intermediateResults = { batch1Result: null, batch2Result: null, html: null, yaml: null, prd: null };
            
            document.getElementById('chat-messages').innerHTML = `
                <div class="welcome-card">
                    <div class="welcome-icon">👋</div>
                    <h3>我是你的HR系统原型助手</h3>
                    <p>输入HR业务场景，我帮你自动生成原型和PRD</p>
                    <div class="command-examples">
                        <div class="cmd-example" onclick="insertCommand('帮我设计一个员工考勤系统，支持打卡、请假、加班审批')">
                            <span class="cmd-label">设计</span>
                            <span>帮我设计一个员工考勤系统...</span>
                        </div>
                        <div class="cmd-example" onclick="insertCommand('修改登录页面，添加验证码功能')">
                            <span class="cmd-label">修改</span>
                            <span>修改登录页面，添加验证码...</span>
                        </div>
                        <div class="cmd-example" onclick="insertCommand('从第3步开始，设计薪酬系统')">
                            <span class="cmd-label">步骤</span>
                            <span>从第3步开始，设计薪酬系统...</span>
                        </div>
                    </div>
                </div>
            `;
            
            // 清空预览
            document.getElementById('html-preview').style.display = 'none';
            document.getElementById('html-empty').style.display = 'flex';
            document.getElementById('prd-render').style.display = 'none';
            document.getElementById('prd-empty').style.display = 'flex';
            document.getElementById('yaml-render').style.display = 'none';
            document.getElementById('yaml-empty').style.display = 'flex';
            
            saveState();
            renderChatList();
        }
    });
}

function downloadCurrent() {
    const activeTab = document.querySelector('.preview-tab.active');
    const text = activeTab?.textContent || '';
    
    if (text.includes('原型')) downloadHTML();
    else if (text.includes('PRD')) downloadPRD();
    else if (text.includes('YAML')) downloadYAML();
}

function downloadHTML() {
    if (!state.intermediateResults.html) {
        showAlert('提示', '暂无原型可下载');
        return;
    }
    
    const blob = new Blob([state.intermediateResults.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prototype_${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
}

function downloadPRD() {
    if (!state.intermediateResults.prd) {
        showAlert('提示', '暂无PRD可下载');
        return;
    }
    
    const blob = new Blob([state.intermediateResults.prd], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PRD_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
}

function downloadYAML() {
    if (!state.intermediateResults.yaml) {
        showAlert('提示', '暂无YAML可下载');
        return;
    }
    
    const blob = new Blob([state.intermediateResults.yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `spec_${Date.now()}.yaml`;
    a.click();
    URL.revokeObjectURL(url);
}

function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

function saveState() {
    localStorage.setItem('hr_agent_state', JSON.stringify({
        messages: state.messages.slice(-50),
        currentProject: state.currentProject,
        sessionId: state.sessionId,
        isGenerating: state.isGenerating
    }));

    // 同时保存到历史对话
    saveChatToHistory();
}

// 消息分页配置
const MESSAGE_PAGE_SIZE = 20; // 每次加载的消息数量
let loadedMessageCount = 0; // 已加载的消息数量
let isLoadingMoreMessages = false; // 是否正在加载更多消息

function loadSavedState() {
    const saved = localStorage.getItem('hr_agent_state');
    if (saved) {
        const data = JSON.parse(saved);
        if (data.messages) {
            // 按时间排序，不覆盖原始时间戳
            state.messages = data.messages
                .sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));
        }
        if (data.currentProject) state.currentProject = data.currentProject;
        if (data.sessionId) state.sessionId = data.sessionId;

        // 终态列表：成功、失败、终止
        const FINAL_STATES = ['complete', 'error', 'interrupted'];

        // 检查所有进度消息，非终态转为终止（保持原进度）
        state.messages.forEach(msg => {
            if (msg.isProgress && !FINAL_STATES.includes(msg.status)) {
                msg.status = 'interrupted';
                // 保持原进度，不强制设为100%
            }
        });

        // 恢复显示 - 只加载最近的消息
        if (state.messages.length > 0) {
            // 只加载最近的消息（已经按时间排序，直接取最后 MESSAGE_PAGE_SIZE 条）
            const recentMessages = state.messages.slice(-MESSAGE_PAGE_SIZE);
            loadedMessageCount = recentMessages.length;

            // 添加"加载更多"提示（如果有更多消息）
            if (state.messages.length > MESSAGE_PAGE_SIZE) {
                const loadMoreHint = document.createElement('div');
                loadMoreHint.className = 'load-more-hint';
                loadMoreHint.innerHTML = `<div class="load-more-text">↑ 向上滑动加载更多消息 (${state.messages.length - MESSAGE_PAGE_SIZE} 条)</div>`;
                document.getElementById('chat-messages').appendChild(loadMoreHint);
            }

            // 渲染最近的消息
            recentMessages.forEach(m => renderMessage(m));

            // 滚动到底部显示最新消息
            setTimeout(() => {
                const container = document.getElementById('chat-messages');
                if (container) {
                    container.scrollTop = container.scrollHeight;
                }
            }, 100);
        }
        if (state.currentProject) {
            // 仅更新预览面板，不添加结果卡片到对话（避免重复消息和错误时间戳）
            if (state.currentProject.html) updateHTMLPreview(state.currentProject.html);
            if (state.currentProject.yaml) updateYAMLPreview(state.currentProject.yaml);
            if (state.currentProject.prd) updatePRDPreview(state.currentProject.prd);
        }
    }
}

// 加载更多历史消息
function loadMoreMessages() {
    if (isLoadingMoreMessages) return;
    if (loadedMessageCount >= state.messages.length) return;
    
    isLoadingMoreMessages = true;
    
    const container = document.getElementById('chat-messages');
    const oldScrollHeight = container.scrollHeight;
    const oldScrollTop = container.scrollTop;
    
    // 计算要加载的消息范围
    const startIndex = Math.max(0, state.messages.length - loadedMessageCount - MESSAGE_PAGE_SIZE);
    const endIndex = state.messages.length - loadedMessageCount;
    const messagesToLoad = state.messages.slice(startIndex, endIndex);
    
    // 移除"加载更多"提示
    const loadMoreHint = container.querySelector('.load-more-hint');
    if (loadMoreHint) {
        loadMoreHint.remove();
    }
    
    // 在顶部插入消息（倒序渲染，保持时间顺序）
    const fragment = document.createDocumentFragment();
    messagesToLoad.reverse().forEach(m => {
        const msgEl = createMessageElement(m);
        fragment.insertBefore(msgEl, fragment.firstChild);
    });
    
    container.insertBefore(fragment, container.firstChild);
    
    // 如果还有更多消息，重新添加提示
    if (startIndex > 0) {
        const newHint = document.createElement('div');
        newHint.className = 'load-more-hint';
        newHint.innerHTML = `<div class="load-more-text">↑ 向上滑动加载更多消息 (${startIndex} 条)</div>`;
        container.insertBefore(newHint, container.firstChild);
    }
    
    // 保持滚动位置
    const newScrollHeight = container.scrollHeight;
    container.scrollTop = oldScrollTop + (newScrollHeight - oldScrollHeight);
    
    loadedMessageCount += messagesToLoad.length;
    isLoadingMoreMessages = false;
}

// 创建消息元素（不直接渲染到DOM）
function createMessageElement(message) {
    const div = document.createElement('div');
    div.className = `message ${message.role}`;
    if (message.isProgress) {
        div.classList.add('progress-message');
    }
    div.id = message.id || '';
    
    const time = message.timestamp ? new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '';
    
    div.innerHTML = `
        <div class="message-avatar">${message.role === 'user' ? '👤' : '🤖'}</div>
        <div class="message-body">
            <div class="message-content">${formatMessageContent(message.content)}</div>
            ${time ? `<div class="message-time">${time}</div>` : ''}
        </div>
    `;
    
    return div;
}

// 监听滚动事件，滚动到顶部时加载更多消息
document.addEventListener('DOMContentLoaded', () => {
    const container = document.getElementById('chat-messages');
    if (container) {
        container.addEventListener('scroll', () => {
            // 当滚动到顶部附近时加载更多消息
            if (container.scrollTop < 50 && !isLoadingMoreMessages && loadedMessageCount < state.messages.length) {
                loadMoreMessages();
            }
        });
    }
});

// 点击遮罩关闭弹窗
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});
