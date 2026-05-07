// PM Agent - 对话式原型设计助手
// API 基础 URL
const API_BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://pm-agent-nkmy.onrender.com';

// 全局状态
const state = {
    messages: [],
    currentProject: null,
    isGenerating: false,
    sessionId: generateSessionId(),
    currentStep: null, // 当前执行到的步骤
    startFromStep: null, // 从哪个步骤开始
    intermediateResults: {
        batch1Result: null, // 业务理解+页面拆解+组件设计
        batch2Result: null, // 交互逻辑
        html: null,
        yaml: null,
        prd: null
    }
};

// Skill 步骤定义
const SKILL_STEPS = {
    business: {
        num: 1,
        name: '业务理解',
        description: '提炼目标用户、核心价值、主流程、异常分支',
        batch: 1
    },
    pages: {
        num: 2,
        name: '页面拆解',
        description: '确定所需页面/弹窗（列表页、详情页、表单页等）',
        batch: 1
    },
    components: {
        num: 3,
        name: '组件设计',
        description: '定义字段、控件、校验规则、默认值',
        batch: 1
    },
    interaction: {
        num: 4,
        name: '交互逻辑',
        description: '明确点击、跳转、弹窗、数据联动、状态变化',
        batch: 2
    },
    prototype: {
        num: 5,
        name: '生成原型',
        description: '输出完整可直接打开的HTML文件',
        batch: 3
    },
    yaml: {
        num: 6,
        name: '结构化输出',
        description: '附加YAML说明，供PRD Skill直接消费',
        batch: 3
    }
};

// 命令模式定义
const COMMAND_PATTERNS = {
    // 设计/创建命令
    design: {
        patterns: [
            /^(帮我|给我|请)?(设计|创建|生成|做|开发)(一个|个)?(.+?)(系统|平台|页面|功能|模块|原型)?$/,
            /^(我要|我想|需要)(做|设计|创建|生成)(一个|个)?(.+)$/,
            /^从零开始(.+)$/,
            /^新建(.+)$/
        ],
        type: 'design',
        extractScene: (matches) => matches[4] || matches[1]
    },
    // 修改命令
    modify: {
        patterns: [
            /^(修改|调整|优化|更新|改一下|改改)(.+?)(页面|部分|功能|组件|模块)?(的)?(.+)?$/,
            /^(把|将)(.+?)(改成|改为|调整为|优化为)(.+)$/,
            /^(添加|增加|插入)(一个|个)?(.+?)(到|在)?(.+)?$/,
            /^(删除|移除|去掉)(.+?)(的)?(.+)?$/,
            /^(.+?)(太|不够)(.+?)(了)?，(改|优化|调整)(一下|下)?$/
        ],
        type: 'modify',
        extractTarget: (matches) => matches[2] || matches[1]
    },
    // 指定步骤命令
    startFromStep: {
        patterns: [
            /^(从|跳过到)(第)?(\d+|[一二三四五六])(步|步骤|阶段)开始$/,
            /^(直接)?(从|跳过)?(.+?)(开始|做起)$/,
            /^(跳过|省略)(.+?)(步骤|阶段)?，(.+)$/
        ],
        type: 'startFromStep',
        extractStep: (matches) => matches[3] || matches[2]
    },
    // 继续/恢复命令
    continue: {
        patterns: [
            /^(继续|恢复|接着)(生成|设计|做|完成)?(上次的|之前的)?$/,
            /^(从|接着)(上次|之前)(的地方|的位置)(继续|做)$/,
            /^(恢复|加载)(之前的)?(进度|状态|项目)$/,
            /^继续$/
        ],
        type: 'continue'
    },
    // 加载命令
    load: {
        patterns: [
            /^(加载|打开|导入)(.+?)(项目|原型|文件|PRD)?$/,
            /^(继续|接着)(修改|编辑|完善)(.+)$/,
            /^(把|将)(.+)(加载|导入|打开)(进来|一下)?$/
        ],
        type: 'load',
        extractTarget: (matches) => matches[2] || matches[1]
    },
    // 查看命令
    view: {
        patterns: [
            /^(查看|显示|展示|看看|预览)(.+?)(原型|PRD|YAML|结构)?$/,
            /^(切换到|打开)(.+?)(标签|面板|视图)$/,
            /^(看|显示)(一下|看)?(.+)$/,
            /^显示(当前)?(的)?(.+)$/
        ],
        type: 'view',
        extractTarget: (matches) => matches[2] || matches[1]
    },
    // 下载命令
    download: {
        patterns: [
            /^(下载|导出|保存)(.+?)(文件|原型|PRD|YAML)?$/,
            /^(把|将)(.+)(下载|导出|保存)(下来|到本地)?$/,
            /^保存(当前)?(的)?(.+)?$/
        ],
        type: 'download',
        extractTarget: (matches) => matches[2] || matches[1]
    }
};

// 初始化
function init() {
    loadLocalProjects();
    setupDragAndDrop();
    setupAutoResize();
    
    // 加载之前的状态
    const savedState = localStorage.getItem('pm_agent_state');
    if (savedState) {
        const parsed = JSON.parse(savedState);
        if (parsed.messages && parsed.messages.length > 0) {
            state.messages = parsed.messages;
            renderMessages();
        }
        if (parsed.currentProject) {
            state.currentProject = parsed.currentProject;
            loadProjectToPreview(state.currentProject);
        }
    }
}

// 生成会话ID
function generateSessionId() {
    return 'session_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
}

// 发送消息
async function sendMessage() {
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (!message || state.isGenerating) return;
    
    // 添加用户消息
    addMessage('user', message);
    input.value = '';
    resizeTextarea();
    
    // 解析命令
    const command = parseCommand(message);
    console.log('解析命令:', command);
    
    // 处理命令
    await handleCommand(command, message);
}

// 解析命令
function parseCommand(message) {
    for (const [cmdType, cmdConfig] of Object.entries(COMMAND_PATTERNS)) {
        for (const pattern of cmdConfig.patterns) {
            const matches = message.match(pattern);
            if (matches) {
                return {
                    type: cmdConfig.type,
                    raw: message,
                    matches: matches,
                    extracted: cmdConfig.extractScene ? cmdConfig.extractScene(matches) :
                              cmdConfig.extractTarget ? cmdConfig.extractTarget(matches) :
                              cmdConfig.extractStep ? cmdConfig.extractStep(matches) : null
                };
            }
        }
    }
    
    // 默认作为设计命令处理
    return {
        type: 'design',
        raw: message,
        matches: [message, message],
        extracted: message
    };
}

// 处理命令
async function handleCommand(command, rawMessage) {
    switch (command.type) {
        case 'design':
            await handleDesignCommand(command);
            break;
        case 'modify':
            await handleModifyCommand(command);
            break;
        case 'startFromStep':
            await handleStartFromStepCommand(command);
            break;
        case 'continue':
            await handleContinueCommand();
            break;
        case 'load':
            await handleLoadCommand(command);
            break;
        case 'view':
            await handleViewCommand(command);
            break;
        case 'download':
            await handleDownloadCommand(command);
            break;
        default:
            // 默认处理：作为设计命令
            await handleDesignCommand({
                type: 'design',
                extracted: rawMessage
            });
    }
}

// 处理设计命令
async function handleDesignCommand(command) {
    const scene = command.extracted || command.raw;
    
    if (!scene || scene.length < 5) {
        addMessage('assistant', '请详细描述一下你的业务场景，这样我才能更好地帮你设计原型。比如："帮我设计一个员工考勤系统，支持打卡、请假申请等功能"');
        return;
    }
    
    // 确认开始设计
    addMessage('assistant', `收到！我来帮你设计「${scene.substring(0, 30)}${scene.length > 30 ? '...' : ''}」\n\n我将按照以下步骤进行：\n1️⃣ 业务理解 - 分析你的需求\n2️⃣ 页面拆解 - 确定所需页面\n3️⃣ 组件设计 - 设计具体组件\n4️⃣ 交互逻辑 - 规划交互流程\n5️⃣ 生成原型 - 输出HTML文件\n6️⃣ 结构化输出 - 生成YAML说明\n\n开始生成...`);
    
    // 重置状态
    state.startFromStep = null;
    state.intermediateResults = {
        batch1Result: null,
        batch2Result: null,
        html: null,
        yaml: null,
        prd: null
    };
    
    // 开始生成流程
    await startGeneration(scene);
}

// 处理修改命令
async function handleModifyCommand(command) {
    const target = command.extracted;
    
    if (!state.currentProject) {
        addMessage('assistant', '还没有可修改的原型。请先设计一个原型，或加载已有的项目。');
        return;
    }
    
    addMessage('assistant', `收到修改请求：「${target}」\n\n我将基于现有原型进行修改。请稍候...`);
    
    // 构建修改提示
    const modifyPrompt = `基于以下现有原型，请进行修改：\n\n修改需求：${command.raw}\n\n现有HTML原型：\n${state.intermediateResults.html ? state.intermediateResults.html.substring(0, 2000) : '暂无'}\n\n现有YAML结构：\n${state.intermediateResults.yaml ? state.intermediateResults.yaml.substring(0, 1000) : '暂无'}\n\n请只修改指定的部分，保持其他内容不变。`;
    
    // 调用API进行修改
    await startGeneration(modifyPrompt, true);
}

// 处理指定步骤命令
async function handleStartFromStepCommand(command) {
    let stepInput = command.extracted || command.matches[3];
    
    // 转换中文数字
    const chineseNumbers = {
        '一': 1, '二': 2, '三': 3, '四': 4, '五': 5, '六': 6,
        '1': 1, '2': 2, '3': 3, '4': 4, '5': 5, '6': 6
    };
    
    const stepNum = chineseNumbers[stepInput];
    
    if (!stepNum) {
        showStepSelector();
        return;
    }
    
    const stepKey = Object.keys(SKILL_STEPS).find(key => SKILL_STEPS[key].num === stepNum);
    
    if (!stepKey) {
        addMessage('assistant', '无效的步骤编号，请选择 1-6 之间的步骤。');
        return;
    }
    
    state.startFromStep = stepKey;
    
    const step = SKILL_STEPS[stepKey];
    addMessage('assistant', `好的，我将从「${step.name}」开始设计。\n\n${step.description}\n\n请描述你的业务场景，我将跳过前面的步骤，直接从这一步开始。`);
}

// 处理继续命令
async function handleContinueCommand() {
    const savedProgress = localStorage.getItem('pm_agent_progress');
    
    if (!savedProgress) {
        addMessage('assistant', '没有找到之前的进度。请开始一个新的设计任务。');
        return;
    }
    
    const progress = JSON.parse(savedProgress);
    state.sessionId = progress.sessionId;
    state.currentStep = progress.currentStep;
    state.intermediateResults = progress.intermediateResults;
    
    addMessage('assistant', `恢复之前的进度，当前在「${SKILL_STEPS[state.currentStep]?.name || '未知步骤'}」\n\n继续生成...`);
    
    // 继续生成
    await resumeGeneration();
}

// 处理加载命令
async function handleLoadCommand(command) {
    const target = command.extracted;
    
    // 尝试从本地存储加载
    const projects = getLocalProjects();
    const matchedProject = projects.find(p => 
        p.name.includes(target) || target.includes(p.name)
    );
    
    if (matchedProject) {
        loadProject(matchedProject.id);
        addMessage('assistant', `已加载项目「${matchedProject.name}」，你可以继续修改或查看。`);
    } else {
        showLoadModal();
    }
}

// 处理查看命令
async function handleViewCommand(command) {
    const target = command.extracted?.toLowerCase() || '';
    
    if (target.includes('原型') || target.includes('html')) {
        switchPreviewTab('prototype');
    } else if (target.includes('prd') || target.includes('文档')) {
        switchPreviewTab('prd');
    } else if (target.includes('yaml') || target.includes('结构')) {
        switchPreviewTab('yaml');
    } else {
        // 默认显示原型
        switchPreviewTab('prototype');
    }
    
    addMessage('assistant', `已切换到${target || '原型'}视图。`);
}

// 处理下载命令
async function handleDownloadCommand(command) {
    const target = command.extracted?.toLowerCase() || '';
    
    if (target.includes('原型') || target.includes('html')) {
        downloadHTML();
    } else if (target.includes('prd') || target.includes('文档')) {
        downloadPRD();
    } else if (target.includes('yaml') || target.includes('结构')) {
        downloadYAML();
    } else {
        // 默认下载原型
        downloadHTML();
    }
    
    addMessage('assistant', '文件已下载到本地。');
}

// 开始生成流程
async function startGeneration(scene, isModify = false) {
    state.isGenerating = true;
    showProgress();
    
    try {
        const response = await fetch(`${API_BASE_URL}/generate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                scene,
                sessionId: state.sessionId,
                startFromStep: state.startFromStep,
                intermediateResults: state.intermediateResults,
                isModify
            })
        });
        
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            const chunk = decoder.decode(value);
            const lines = chunk.split('\n');
            
            for (const line of lines) {
                if (line.startsWith('data: ')) {
                    try {
                        const data = JSON.parse(line.slice(6));
                        handleStreamData(data);
                    } catch (e) {
                        console.error('解析SSE数据失败:', e);
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('生成失败:', error);
        addMessage('assistant', `生成过程中出现错误：${error.message}\n\n请稍后重试，或尝试简化你的需求描述。`);
    } finally {
        state.isGenerating = false;
        hideProgress();
        saveState();
    }
}

// 处理流式数据
function handleStreamData(data) {
    switch (data.type) {
        case 'progress':
            updateProgress(data);
            break;
        case 'phase':
            updatePhase(data);
            break;
        case 'step':
            updateStep(data);
            break;
        case 'result':
            handleResult(data);
            break;
        case 'complete':
            handleComplete(data);
            break;
        case 'error':
            handleError(data);
            break;
        case 'message':
            addMessage('assistant', data.message);
            break;
    }
}

// 更新进度
function updateProgress(data) {
    const progressFill = document.getElementById('progress-fill');
    const progressPercent = document.getElementById('progress-percent');
    const progressPhase = document.getElementById('progress-phase');
    
    if (progressFill) progressFill.style.width = `${data.progress}%`;
    if (progressPercent) progressPercent.textContent = `${data.progress}%`;
    if (progressPhase && data.phase) progressPhase.textContent = data.stepData?.title || data.phase;
    
    // 更新步骤状态
    if (data.step) {
        updateStepStatus(data.step, data.status);
    }
}

// 更新阶段
function updatePhase(data) {
    const progressPhase = document.getElementById('progress-phase');
    if (progressPhase) {
        progressPhase.textContent = `${data.name} - ${data.skill}`;
    }
}

// 更新步骤
function updateStep(data) {
    updateStepStatus(data.step, data.status);
}

// 更新步骤状态
function updateStepStatus(stepNum, status) {
    const progressSteps = document.getElementById('progress-steps');
    if (!progressSteps) return;
    
    // 找到对应的步骤
    const stepKey = Object.keys(SKILL_STEPS).find(key => SKILL_STEPS[key].num === stepNum);
    if (!stepKey) return;
    
    const step = SKILL_STEPS[stepKey];
    
    // 更新或添加步骤显示
    let stepEl = document.getElementById(`progress-step-${stepNum}`);
    if (!stepEl) {
        stepEl = document.createElement('div');
        stepEl.id = `progress-step-${stepNum}`;
        stepEl.className = 'progress-step';
        progressSteps.appendChild(stepEl);
    }
    
    const icon = status === 'completed' ? '✅' : 
                 status === 'current' ? '⏳' : 
                 status === 'error' ? '❌' : '⏸️';
    
    stepEl.className = `progress-step ${status}`;
    stepEl.innerHTML = `${icon} ${step.name} - ${step.description}`;
}

// 处理结果
function handleResult(data) {
    if (data.batch1Result) {
        state.intermediateResults.batch1Result = data.batch1Result;
    }
    if (data.batch2Result) {
        state.intermediateResults.batch2Result = data.batch2Result;
    }
    if (data.html) {
        state.intermediateResults.html = data.html;
        showPrototype(data.html);
    }
    if (data.yaml) {
        state.intermediateResults.yaml = data.yaml;
        showYAML(data.yaml);
    }
    if (data.prd) {
        state.intermediateResults.prd = data.prd;
        showPRD(data.prd);
    }
}

// 处理完成
function handleComplete(data) {
    addMessage('assistant', `✅ 生成完成！\n\n我已经为你完成了：\n🎨 可交互HTML原型\n📝 PRD产品需求文档\n📋 结构化YAML数据\n\n你可以在右侧预览所有内容，也可以下载到本地使用。`);
    
    // 保存项目
    saveProject({
        name: data.scene?.substring(0, 30) || '未命名项目',
        scene: data.scene,
        html: state.intermediateResults.html,
        yaml: state.intermediateResults.yaml,
        prd: state.intermediateResults.prd,
        createdAt: new Date().toISOString()
    });
}

// 处理错误
function handleError(data) {
    addMessage('assistant', `❌ 生成失败：${data.message}\n\n请检查你的输入或稍后重试。`);
}

// 显示原型
function showPrototype(html) {
    const frame = document.getElementById('prototype-frame');
    const empty = document.getElementById('prototype-empty');
    
    if (frame && empty) {
        frame.srcdoc = html;
        frame.style.display = 'block';
        empty.style.display = 'none';
    }
}

// 显示PRD
function showPRD(prd) {
    const content = document.getElementById('prd-content');
    const empty = document.getElementById('prd-empty');
    
    if (content && empty) {
        // 简单的Markdown渲染
        const html = renderMarkdown(prd);
        content.innerHTML = html;
        content.style.display = 'block';
        empty.style.display = 'none';
    }
}

// 显示YAML
function showYAML(yaml) {
    const content = document.getElementById('yaml-content');
    const empty = document.getElementById('yaml-empty');
    
    if (content && empty) {
        content.textContent = yaml;
        content.style.display = 'block';
        empty.style.display = 'none';
    }
}

// 简单的Markdown渲染
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

// 添加消息
function addMessage(role, content, isHTML = false) {
    const message = {
        role,
        content,
        timestamp: Date.now(),
        id: Date.now() + Math.random()
    };
    
    state.messages.push(message);
    renderMessage(message, isHTML);
    
    // 滚动到底部
    const chatHistory = document.getElementById('chat-history');
    if (chatHistory) {
        chatHistory.scrollTop = chatHistory.scrollHeight;
    }
}

// 渲染单条消息
function renderMessage(message, isHTML = false) {
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) return;
    
    // 移除欢迎消息
    const welcome = chatHistory.querySelector('.welcome-message');
    if (welcome) welcome.remove();
    
    const messageEl = document.createElement('div');
    messageEl.className = `message ${message.role}`;
    messageEl.id = `msg-${message.id}`;
    
    const avatar = message.role === 'user' ? '👤' : '🤖';
    const content = isHTML ? message.content : escapeHtml(message.content).replace(/\n/g, '<br>');
    const time = new Date(message.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    
    messageEl.innerHTML = `
        <div class="message-avatar">${avatar}</div>
        <div class="message-content-wrapper">
            <div class="message-content">${content}</div>
            <div class="message-time">${time}</div>
        </div>
    `;
    
    chatHistory.appendChild(messageEl);
}

// 渲染所有消息
function renderMessages() {
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) return;
    
    // 清空现有消息
    chatHistory.innerHTML = '';
    
    // 渲染所有消息
    state.messages.forEach(msg => renderMessage(msg));
}

// HTML转义
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// 显示进度条
function showProgress() {
    const progress = document.getElementById('generation-progress');
    if (progress) {
        progress.style.display = 'block';
    }
    
    // 添加思考中的消息
    addThinkingMessage();
}

// 隐藏进度条
function hideProgress() {
    const progress = document.getElementById('generation-progress');
    if (progress) {
        progress.style.display = 'none';
    }
    
    // 移除思考中的消息
    removeThinkingMessage();
}

// 添加思考中消息
function addThinkingMessage() {
    const chatHistory = document.getElementById('chat-history');
    if (!chatHistory) return;
    
    const thinkingEl = document.createElement('div');
    thinkingEl.className = 'message assistant thinking-message';
    thinkingEl.id = 'thinking-message';
    thinkingEl.innerHTML = `
        <div class="message-avatar">🤖</div>
        <div class="message-content">
            <div class="thinking">
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
                <div class="thinking-dot"></div>
            </div>
        </div>
    `;
    
    chatHistory.appendChild(thinkingEl);
    chatHistory.scrollTop = chatHistory.scrollHeight;
}

// 移除思考中消息
function removeThinkingMessage() {
    const thinking = document.getElementById('thinking-message');
    if (thinking) thinking.remove();
}

// 切换预览标签
function switchPreviewTab(tab) {
    // 更新标签按钮
    document.querySelectorAll('.toolbar-tabs .tab-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    document.getElementById(`tab-${tab}`)?.classList.add('active');
    
    // 更新面板
    document.querySelectorAll('.preview-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    document.getElementById(`preview-${tab}`)?.classList.add('active');
}

// 快捷命令
function quickCommand(cmd) {
    const input = document.getElementById('chat-input');
    input.value = cmd;
    resizeTextarea();
    input.focus();
}

// 显示步骤选择器
function showStepSelector() {
    const modal = document.getElementById('step-modal');
    if (modal) modal.style.display = 'flex';
}

// 关闭步骤选择器
function closeStepModal() {
    const modal = document.getElementById('step-modal');
    if (modal) modal.style.display = 'none';
}

// 从指定步骤开始
function startFromStep(stepKey) {
    state.startFromStep = stepKey;
    const step = SKILL_STEPS[stepKey];
    
    closeStepModal();
    
    addMessage('assistant', `已选择从「${step.name}」开始设计。\n\n${step.description}\n\n请描述你的业务场景，我将跳过前面的步骤。`);
    
    // 聚焦输入框
    document.getElementById('chat-input')?.focus();
}

// 加载已有项目
function loadExistingProject() {
    showLoadModal();
}

// 显示加载弹窗
function showLoadModal() {
    const modal = document.getElementById('load-modal');
    if (modal) {
        renderLocalProjects();
        modal.style.display = 'flex';
    }
}

// 关闭加载弹窗
function closeLoadModal() {
    const modal = document.getElementById('load-modal');
    if (modal) modal.style.display = 'none';
}

// 切换加载标签
function switchLoadTab(tab) {
    document.querySelectorAll('.load-tab').forEach(t => t.classList.remove('active'));
    event.target.classList.add('active');
    
    document.getElementById('load-local').style.display = tab === 'local' ? 'block' : 'none';
    document.getElementById('load-upload').style.display = tab === 'upload' ? 'block' : 'none';
}

// 渲染本地项目列表
function renderLocalProjects() {
    const container = document.getElementById('local-projects');
    if (!container) return;
    
    const projects = getLocalProjects();
    
    if (projects.length === 0) {
        container.innerHTML = '<p style="text-align: center; color: var(--text-muted); padding: 40px;">暂无保存的项目</p>';
        return;
    }
    
    container.innerHTML = projects.map(project => `
        <div class="project-item" onclick="loadProject('${project.id}')">
            <div class="project-icon">🎨</div>
            <div class="project-info">
                <div class="project-name">${escapeHtml(project.name)}</div>
                <div class="project-meta">${new Date(project.createdAt).toLocaleString('zh-CN')}</div>
            </div>
        </div>
    `).join('');
}

// 获取本地项目列表
function getLocalProjects() {
    const projects = localStorage.getItem('pm_agent_projects');
    return projects ? JSON.parse(projects) : [];
}

// 加载项目
function loadProject(projectId) {
    const projects = getLocalProjects();
    const project = projects.find(p => p.id === projectId);
    
    if (project) {
        state.currentProject = project;
        state.intermediateResults.html = project.html;
        state.intermediateResults.yaml = project.yaml;
        state.intermediateResults.prd = project.prd;
        
        loadProjectToPreview(project);
        
        addMessage('assistant', `已加载项目「${project.name}」。\n\n你可以继续修改，或查看右侧的预览。`);
        
        closeLoadModal();
        saveState();
    }
}

// 加载项目到预览区
function loadProjectToPreview(project) {
    if (project.html) showPrototype(project.html);
    if (project.prd) showPRD(project.prd);
    if (project.yaml) showYAML(project.yaml);
}

// 保存项目
function saveProject(project) {
    const projects = getLocalProjects();
    
    const newProject = {
        id: 'proj_' + Date.now(),
        ...project
    };
    
    // 添加到开头
    projects.unshift(newProject);
    
    // 最多保存20个项目
    if (projects.length > 20) {
        projects.pop();
    }
    
    localStorage.setItem('pm_agent_projects', JSON.stringify(projects));
    state.currentProject = newProject;
}

// 保存状态
function saveState() {
    const stateToSave = {
        messages: state.messages.slice(-50), // 只保存最近50条
        currentProject: state.currentProject,
        sessionId: state.sessionId
    };
    localStorage.setItem('pm_agent_state', JSON.stringify(stateToSave));
}

// 加载本地项目（初始化用）
function loadLocalProjects() {
    // 已在 getLocalProjects 中实现
}

// 设置拖拽上传
function setupDragAndDrop() {
    const uploadArea = document.getElementById('upload-area');
    if (!uploadArea) return;
    
    uploadArea.addEventListener('click', () => {
        document.getElementById('file-input')?.click();
    });
    
    uploadArea.addEventListener('dragover', (e) => {
        e.preventDefault();
        uploadArea.classList.add('dragover');
    });
    
    uploadArea.addEventListener('dragleave', () => {
        uploadArea.classList.remove('dragover');
    });
    
    uploadArea.addEventListener('drop', (e) => {
        e.preventDefault();
        uploadArea.classList.remove('dragover');
        handleFiles(e.dataTransfer.files);
    });
}

// 处理文件上传
function handleFileUpload(event) {
    handleFiles(event.target.files);
}

// 处理文件
function handleFiles(files) {
    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const content = e.target.result;
            const project = {
                name: file.name.replace(/\.[^/.]+$/, ''),
                html: file.name.endsWith('.html') ? content : null,
                prd: file.name.endsWith('.md') ? content : null,
                yaml: file.name.endsWith('.yaml') || file.name.endsWith('.yml') ? content : null,
                createdAt: new Date().toISOString()
            };
            
            saveProject(project);
            loadProjectToPreview(project);
            
            addMessage('assistant', `已导入文件「${file.name}」。`);
        };
        reader.readAsText(file);
    });
    
    closeLoadModal();
}

// 设置自动调整文本框大小
function setupAutoResize() {
    const textarea = document.getElementById('chat-input');
    if (!textarea) return;
    
    textarea.addEventListener('input', resizeTextarea);
}

// 调整文本框大小
function resizeTextarea() {
    const textarea = document.getElementById('chat-input');
    if (!textarea) return;
    
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

// 处理输入框键盘事件
function handleInputKeydown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendMessage();
    }
}

// 新建对话
function startNewChat() {
    if (confirm('确定要新建对话吗？当前进度将自动保存。')) {
        state.messages = [];
        state.currentProject = null;
        state.sessionId = generateSessionId();
        state.intermediateResults = {
            batch1Result: null,
            batch2Result: null,
            html: null,
            yaml: null,
            prd: null
        };
        
        // 清空对话历史
        const chatHistory = document.getElementById('chat-history');
        if (chatHistory) {
            chatHistory.innerHTML = `
                <div class="welcome-message">
                    <div class="welcome-icon">👋</div>
                    <h3>我是你的原型设计助手</h3>
                    <p>你可以这样跟我交流：</p>
                    <ul class="example-commands">
                        <li>"<span class="highlight">帮我设计</span>一个员工管理系统"</li>
                        <li>"<span class="highlight">修改</span>登录页，添加验证码功能"</li>
                        <li>"<span class="highlight">从第3步开始</span>，重新设计组件"</li>
                        <li>"<span class="highlight">加载</span>上次的原型继续修改"</li>
                    </ul>
                </div>
            `;
        }
        
        // 清空预览
        document.getElementById('prototype-frame').style.display = 'none';
        document.getElementById('prototype-empty').style.display = 'flex';
        document.getElementById('prd-content').style.display = 'none';
        document.getElementById('prd-empty').style.display = 'flex';
        document.getElementById('yaml-content').style.display = 'none';
        document.getElementById('yaml-empty').style.display = 'flex';
        
        saveState();
    }
}

// 下载功能
function downloadCurrent() {
    const activeTab = document.querySelector('.toolbar-tabs .tab-btn.active');
    const tabText = activeTab?.textContent || '';
    
    if (tabText.includes('原型')) {
        downloadHTML();
    } else if (tabText.includes('PRD')) {
        downloadPRD();
    } else if (tabText.includes('YAML')) {
        downloadYAML();
    }
}

function downloadHTML() {
    if (!state.intermediateResults.html) {
        alert('暂无原型可下载');
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
        alert('暂无PRD可下载');
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
        alert('暂无YAML可下载');
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

// 全屏切换
function toggleFullscreen() {
    if (!document.fullscreenElement) {
        document.documentElement.requestFullscreen();
    } else {
        document.exitFullscreen();
    }
}

// 恢复生成
async function resumeGeneration() {
    // 实现断点续传逻辑
    addMessage('assistant', '正在恢复之前的进度...');
    // 这里需要后端支持，暂用重新开始代替
    await startGeneration(state.currentProject?.scene || '继续设计');
}

// 页面加载完成后初始化
document.addEventListener('DOMContentLoaded', init);

// 点击遮罩关闭弹窗
document.addEventListener('click', (e) => {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.style.display = 'none';
    }
});
