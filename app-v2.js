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
    intermediateResults: {
        batch1Result: null,
        batch2Result: null,
        html: null,
        yaml: null,
        prd: null
    }
};

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
            /只生成原型|只要原型|不需要PRD|不用PRD/i
        ]
    },
    prd: {
        patterns: [
            /只生成PRD|只要PRD|只要文档|不需要原型|不用原型/i
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
});

// 生成会话ID
function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// ========== 对话功能 ==========

function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (!message || state.isGenerating) return;
    
    // 添加用户消息
    addMessage('user', message);
    input.value = '';
    autoResize(input);
    
    // 解析并执行命令
    const command = parseCommand(message);
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
    const scene = command.target || command.raw;
    
    if (!scene || scene.length < 5) {
        addMessage('assistant', '请详细描述一下你的HR业务场景，比如："帮我设计一个员工考勤系统，支持打卡、请假申请等功能"');
        return;
    }
    
    // 识别生成模式
    const mode = detectGenerationMode(command.raw);
    const modeText = mode === 'prototype' ? '（仅生成原型）' : mode === 'prd' ? '（仅生成PRD）' : '';
    
    // 确认消息
    const stepInfo = state.startFromStep 
        ? `（从「${SKILL_STEPS[state.startFromStep].name}」开始）` 
        : '';
    
    addMessage('assistant', `收到！我来帮你设计「${scene.substring(0, 30)}...」${stepInfo}${modeText}\n\n开始生成，请稍候...`);
    
    // 开始生成
    await startGeneration(scene, false, mode);
}

async function handleModify(command) {
    if (!state.currentProject) {
        addMessage('assistant', '还没有可修改的原型。请先设计一个原型，或加载已有的项目。');
        return;
    }
    
    addMessage('assistant', `收到修改请求：「${command.raw}」\n\n我将基于现有原型进行修改...`);
    
    const modifyPrompt = `[修改需求] ${command.raw}\n\n现有原型HTML：\n${state.intermediateResults.html?.substring(0, 2000) || ''}\n\n请基于以上原型进行修改，只调整指定的部分。`;
    
    await startGeneration(modifyPrompt, true);
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

async function startGeneration(scene, isModify = false, mode = 'all') {
    state.isGenerating = true;
    generationSteps = [];
    allStepsFromBackend = []; // 重置步骤列表
    
    // 创建进度消息卡片（初始为空步骤列表）
    currentProgressMessageId = addProgressMessage();
    
    try {
        const response = await fetch(`${API_BASE_URL}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                scene,
                sessionId: state.sessionId,
                startFromStep: state.startFromStep,
                intermediateResults: state.intermediateResults,
                isModify,
                mode
            })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = ''; // SSE 数据缓冲区
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            buffer += chunk;
            
            // 处理完整的 SSE 消息（以\n\n结尾）
            const messages = buffer.split('\n\n');
            buffer = messages.pop(); // 保留不完整的部分
            
            for (const message of messages) {
                const lines = message.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        const jsonStr = line.slice(6);
                        // 跳过 [DONE] 标记
                        if (jsonStr === '[DONE]') continue;
                        try {
                            const data = JSON.parse(jsonStr);
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
        updateProgressMessage(currentProgressMessageId, {
            status: 'error',
            error: error.message
        });
        addMessage('assistant', `❌ 生成失败：${error.message}`);
    } finally {
        state.isGenerating = false;
        saveState();
    }
}

function handleSSEData(data) {
    switch (data.type) {
        case 'steps':
            // 接收后端发送的完整步骤列表
            if (data.prototypeSteps || data.prdSteps) {
                allStepsFromBackend = [
                    ...(data.prototypeSteps || []),
                    ...(data.prdSteps || [])
                ];
                // 初始化显示所有步骤（未开始状态）
                initProgressSteps(currentProgressMessageId, allStepsFromBackend);
            }
            break;
        case 'progress':
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
    updateProgress(100, '完成');
    
    // 保存项目
    const project = {
        id: 'proj_' + Date.now(),
        name: data.scene?.substring(0, 30) || '未命名项目',
        scene: data.scene,
        html: state.intermediateResults.html,
        yaml: state.intermediateResults.yaml,
        prd: state.intermediateResults.prd,
        createdAt: new Date().toISOString()
    };
    
    saveProject(project);
    state.currentProject = project;
    
    addMessage('assistant', `✅ 生成完成！\n\n已为你生成：\n🎨 HTML原型\n📝 PRD文档\n📋 YAML结构\n\n你可以在右侧预览，也可以下载使用。`);
    
    // 重置开始步骤
    state.startFromStep = null;
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
    
    div.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-body">
            <div class="message-content">${escapeHtml(message.content).replace(/\n/g, '<br>')}</div>
            <div class="message-time">${time}</div>
        </div>
    `;
    
    container.appendChild(div);
}

// ========== 预览显示 ==========

function showHTML(html) {
    const frame = document.getElementById('html-preview');
    const empty = document.getElementById('html-empty');
    
    if (frame && empty) {
        frame.srcdoc = html;
        frame.style.display = 'block';
        empty.style.display = 'none';
    }
}

function showPRD(prd) {
    const render = document.getElementById('prd-render');
    const empty = document.getElementById('prd-empty');
    
    if (render && empty) {
        render.innerHTML = renderMarkdown(prd);
        render.style.display = 'block';
        empty.style.display = 'none';
    }
}

function showYAML(yaml) {
    const render = document.getElementById('yaml-render');
    const empty = document.getElementById('yaml-empty');
    
    if (render && empty) {
        render.textContent = yaml;
        render.style.display = 'block';
        empty.style.display = 'none';
    }
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

function addProgressMessage() {
    const container = document.getElementById('chat-messages');
    if (!container) return null;
    
    // 移除欢迎卡片
    const welcome = container.querySelector('.welcome-card');
    if (welcome) welcome.remove();
    
    const messageId = 'progress_' + Date.now();
    const div = document.createElement('div');
    div.className = 'message assistant progress-message';
    div.id = messageId;
    
    div.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-body">
            <div class="progress-card">
                <div class="progress-header">
                    <span class="progress-status">🚀 正在生成原型...</span>
                    <span class="progress-percent">0%</span>
                </div>
                <div class="progress-bar-container">
                    <div class="progress-bar-fill" style="width: 0%"></div>
                </div>
                <div class="progress-current-step">准备开始...</div>
                <div class="progress-steps-list"></div>
            </div>
            <div class="message-time">${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}</div>
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
                <span class="step-num ${isFirst ? 'active' : ''}">${isFirst ? '●' : index + 1}</span>
                <span class="step-title">${step.title}</span>
                <span class="step-status">${isFirst ? '进行中...' : ''}</span>
            </div>
        `;
    }).join('');
    
    stepsListEl.innerHTML = stepsHtml;
    
    // 滚动到底部
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
}

function updateProgressMessage(messageId, data) {
    const messageEl = document.getElementById(messageId);
    if (!messageEl) return;
    
    const progressCard = messageEl.querySelector('.progress-card');
    if (!progressCard) return;
    
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
    if (data.status === 'complete' && statusEl) {
        statusEl.textContent = '✅ 生成完成';
        progressCard.classList.add('complete');
    } else if (data.status === 'error' && statusEl) {
        statusEl.textContent = '❌ 生成失败';
        progressCard.classList.add('error');
    }
    
    // 更新步骤列表 - 根据当前进度更新每个步骤的状态
    const stepItems = progressCard.querySelectorAll('.progress-step-item');
    
    // 如果没有后端步骤，使用 generationSteps
    const stepsToRender = allStepsFromBackend.length > 0 ? allStepsFromBackend : generationSteps;
    
    stepItems.forEach((item, index) => {
        const step = stepsToRender[index];
        if (!step) return;
        
        const stepNum = item.querySelector('.step-num');
        const stepStatus = item.querySelector('.step-status');
        
        // 判断步骤状态
        // 如果当前步骤标题匹配，或者是根据进度估算
        const isCurrent = data.currentStep === step.title;
        const isCompleted = generationSteps.find(s => s.title === step.title) ||
                           (data.progress >= 95 && index < stepItems.length - 1);
        
        // 更新样式
        item.classList.remove('completed', 'current');
        if (isCompleted) {
            item.classList.add('completed');
            if (stepNum) {
                stepNum.textContent = '✓';
                stepNum.classList.add('done');
                stepNum.classList.remove('active');
            }
            if (stepStatus) stepStatus.textContent = '';
        } else if (isCurrent) {
            item.classList.add('current');
            if (stepNum) {
                stepNum.textContent = '●';
                stepNum.classList.add('active');
                stepNum.classList.remove('done');
            }
            if (stepStatus) stepStatus.textContent = '进行中...';
        } else {
            // 未开始
            if (stepNum) {
                stepNum.textContent = index + 1;
                stepNum.classList.remove('done', 'active');
            }
            if (stepStatus) stepStatus.textContent = '';
        }
    });
    
    // 滚动到底部
    const container = document.getElementById('chat-messages');
    if (container) container.scrollTop = container.scrollHeight;
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

function showLoadModal() {
    renderProjectList();
    document.getElementById('load-modal').style.display = 'flex';
}

function closeModal(id) {
    document.getElementById(id).style.display = 'none';
}

function selectStartStep(stepKey) {
    state.startFromStep = stepKey;
    const step = SKILL_STEPS[stepKey];
    addMessage('assistant', `已选择从「${step.name}」开始设计。请描述你的业务场景。`);
    closeModal('step-modal');
}

function switchLoadTab(tab) {
    document.querySelectorAll('.load-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    document.getElementById('load-local-panel').style.display = tab === 'local' ? 'block' : 'none';
    document.getElementById('load-file-panel').style.display = tab === 'file' ? 'block' : 'none';
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
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function startNewChat() {
    if (confirm('确定要新建对话吗？当前进度已自动保存。')) {
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
    }
}

function downloadCurrent() {
    const activeTab = document.querySelector('.preview-tab.active');
    const text = activeTab?.textContent || '';
    
    if (text.includes('原型')) downloadHTML();
    else if (text.includes('PRD')) downloadPRD();
    else if (text.includes('YAML')) downloadYAML();
}

function downloadHTML() {
    if (!state.intermediateResults.html) return alert('暂无原型可下载');
    
    const blob = new Blob([state.intermediateResults.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prototype_${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(url);
}

function downloadPRD() {
    if (!state.intermediateResults.prd) return alert('暂无PRD可下载');
    
    const blob = new Blob([state.intermediateResults.prd], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PRD_${Date.now()}.md`;
    a.click();
    URL.revokeObjectURL(url);
}

function downloadYAML() {
    if (!state.intermediateResults.yaml) return alert('暂无YAML可下载');
    
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
        sessionId: state.sessionId
    }));
}

function loadSavedState() {
    const saved = localStorage.getItem('hr_agent_state');
    if (saved) {
        const data = JSON.parse(saved);
        if (data.messages) state.messages = data.messages;
        if (data.currentProject) state.currentProject = data.currentProject;
        if (data.sessionId) state.sessionId = data.sessionId;
        
        // 恢复显示
        if (state.messages.length > 0) {
            state.messages.forEach(m => renderMessage(m));
        }
        if (state.currentProject) {
            if (state.currentProject.html) showHTML(state.currentProject.html);
            if (state.currentProject.yaml) showYAML(state.currentProject.yaml);
            if (state.currentProject.prd) showPRD(state.currentProject.prd);
        }
    }
}

// 点击遮罩关闭弹窗
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal')) {
        e.target.style.display = 'none';
    }
});
