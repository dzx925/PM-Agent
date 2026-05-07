// API 基础 URL - 生产环境使用 Render 地址 (v2)
const API_BASE_URL = window.location.hostname === 'localhost'
    ? 'http://localhost:3000'
    : 'https://pm-agent-nkmy.onrender.com';

// 当前结果
let currentResult = {
    html: '',
    prd: ''
};

// 缓存的步骤
let cachedSteps = {
    prototype: [],
    prd: []
};

// 生成状态管理
let generationState = {
    isPaused: false,
    isGenerating: false,
    currentPhase: null,
    currentStep: 0,
    abortController: null,
    intermediateResults: {
        html: '',
        prd: '',
        prdBatch1Result: '',
        prdBatch2Result: '',
        prdBatch3Result: ''
    }
};

/**
 * 显示自定义弹窗
 * @param {string} message - 提示内容
 * @param {string} title - 标题（可选，默认"提示"）
 * @param {string} icon - 图标（可选，默认"💡"）
 */
function showModal(message, title = '提示', icon = '💡') {
    const overlay = getEl('modal-overlay');
    const titleEl = getEl('modal-title');
    const messageEl = getEl('modal-message');
    const iconEl = document.querySelector('.modal-icon');
    
    if (titleEl) titleEl.textContent = title;
    if (messageEl) messageEl.textContent = message;
    if (iconEl) iconEl.textContent = icon;
    if (overlay) overlay.style.display = 'flex';
}

/**
 * 关闭自定义弹窗
 */
function closeModal() {
    const overlay = getEl('modal-overlay');
    if (overlay) overlay.style.display = 'none';
}

// 点击遮罩层关闭弹窗
document.addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') {
        closeModal();
    }
});

// 按 ESC 键关闭弹窗
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        closeModal();
    }
});

/**
 * 安全地获取 DOM 元素
 */
function getEl(id) {
    return document.getElementById(id);
}

/**
 * 动态渲染步骤列表
 */
function renderSteps(phase, steps) {
    const container = getEl(`${phase}-steps`);
    if (!container) return;
    container.innerHTML = '';
    
    steps.forEach((step, index) => {
        const stepEl = document.createElement('div');
        stepEl.className = 'step';
        stepEl.id = `${phase}-step-${index + 1}`;
        stepEl.innerHTML = `
            <span class="step-icon">⏳</span>
            <span class="step-text">
                <strong>${step.title}</strong>
                ${step.description ? `<br><small>${step.description}</small>` : ''}
            </span>
        `;
        container.appendChild(stepEl);
    });
}

/**
 * 更新步骤状态
 */
function updateStepStatus(phase, stepNumber, status) {
    const stepEl = getEl(`${phase}-step-${stepNumber}`);
    if (!stepEl) return;

    const iconEl = stepEl.querySelector('.step-icon');
    if (!iconEl) return;

    // 清除所有状态
    stepEl.classList.remove('active', 'completed', 'ai-generating');
    
    // 移除已有的加载提示
    const existingLoading = stepEl.querySelector('.step-loading');
    if (existingLoading) {
        existingLoading.remove();
    }

    switch (status) {
        case 'processing':
            stepEl.classList.add('active');
            iconEl.textContent = '🔄';
            break;
        case 'ai-generating':
            stepEl.classList.add('ai-generating');
            iconEl.textContent = '🤖';
            // 添加加载提示
            addStepLoading(stepEl);
            break;
        case 'completed':
            stepEl.classList.add('completed');
            iconEl.textContent = '✅';
            break;
        default:
            iconEl.textContent = '⏳';
    }
}

/**
 * 添加步骤加载提示
 */
function addStepLoading(stepEl) {
    // 先检查是否已有加载提示
    let loadingEl = stepEl.querySelector('.step-loading');
    if (loadingEl) return; // 已有则不再添加
    
    // 创建加载提示元素，放在 step 元素内，step-text 之后
    loadingEl = document.createElement('div');
    loadingEl.className = 'step-loading';
    loadingEl.innerHTML = `
        <div class="spinner"></div>
        <span>正在生成，请稍等...</span>
    `;
    stepEl.appendChild(loadingEl);
}

/**
 * 更新进度显示
 */
function updateProgress(phase, progress, phaseName) {
    const progressFill = getEl('progress-fill');
    const progressPhase = getEl('progress-phase');
    const progressPercent = getEl('progress-percent');
    
    if (progressFill) progressFill.style.width = `${progress}%`;
    if (progressPercent) progressPercent.textContent = `${progress}%`;
    if (phaseName && progressPhase) progressPhase.textContent = phaseName;
}

/**
 * 显示阶段标题
 */
function showPhase(phase, name, skill) {
    const titleEl = getEl(`${phase}-phase-title`);
    if (!titleEl) return;
    titleEl.style.display = 'block';
    const strongEl = titleEl.querySelector('strong');
    if (strongEl) strongEl.textContent = phase === 'prototype' ? '🎨 ' + name : '📝 ' + name;
    const skillEl = titleEl.querySelector('.phase-skill');
    if (skillEl) skillEl.textContent = skill;
    
    const stepsEl = getEl(`${phase}-steps`);
    if (stepsEl) stepsEl.style.display = 'flex';
}

/**
 * 重置进度
 */
function resetProgress() {
    const progressSection = getEl('progress-section');
    if (progressSection) progressSection.style.display = 'none';
    
    const progressFill = getEl('progress-fill');
    const progressPercent = getEl('progress-percent');
    const progressPhase = getEl('progress-phase');
    
    if (progressFill) progressFill.style.width = '0%';
    if (progressPercent) progressPercent.textContent = '0%';
    if (progressPhase) progressPhase.textContent = '准备生成';
    
    const protoTitle = getEl('prototype-phase-title');
    const prdTitle = getEl('prd-phase-title');
    if (protoTitle) protoTitle.style.display = 'none';
    if (prdTitle) prdTitle.style.display = 'none';
    
    // 清空动态步骤
    const protoSteps = getEl('prototype-steps');
    const prdSteps = getEl('prd-steps');
    if (protoSteps) protoSteps.innerHTML = '';
    if (prdSteps) prdSteps.innerHTML = '';
}

/**
 * 暂停/继续生成
 */
function togglePause() {
    const pauseBtn = getEl('pause-btn');
    const progressPhase = getEl('progress-phase');
    
    if (!generationState.isGenerating) return;
    
    if (generationState.isPaused) {
        // 继续生成
        generationState.isPaused = false;
        if (pauseBtn) {
            pauseBtn.innerHTML = '⏸️ 暂停';
            pauseBtn.classList.remove('paused');
        }
        if (progressPhase) progressPhase.textContent = generationState.currentPhase === 'prototype' ? '原型生成中...' : 'PRD生成中...';
        
        // 触发继续事件
        if (generationState.abortController) {
            generationState.abortController.resume();
        }
    } else {
        // 暂停生成
        generationState.isPaused = true;
        if (pauseBtn) {
            pauseBtn.innerHTML = '▶️ 继续';
            pauseBtn.classList.add('paused');
        }
        if (progressPhase) progressPhase.textContent = '⏸️ 已暂停 - ' + (generationState.currentPhase === 'prototype' ? '原型生成' : 'PRD生成');
        
        // 触发暂停事件
        if (generationState.abortController) {
            generationState.abortController.pause();
        }
    }
}

/**
 * 重置生成状态
 */
function resetGenerationState() {
    generationState = {
        isPaused: false,
        isGenerating: false,
        currentPhase: null,
        currentStep: 0,
        abortController: null,
        intermediateResults: {
            html: '',
            prd: '',
            prdBatch1Result: '',
            prdBatch2Result: '',
            prdBatch3Result: ''
        }
    };
    
    // 重置暂停按钮
    const pauseBtn = getEl('pause-btn');
    if (pauseBtn) {
        pauseBtn.innerHTML = '⏸️ 暂停';
        pauseBtn.classList.remove('paused');
        pauseBtn.disabled = true;
    }
}

/**
 * 生成原型和PRD - 使用 SSE
 */
async function generate() {
    const sceneInput = getEl('scene-input');
    const generateBtn = getEl('generate-btn');
    const btnText = generateBtn?.querySelector('.btn-text');
    const btnLoading = generateBtn?.querySelector('.btn-loading');
    const outputSection = getEl('output-section');
    const errorSection = getEl('error-section');
    
    const scene = sceneInput?.value?.trim();
    
    if (!scene) {
        showModal('请输入业务场景描述', '提示', '✍️');
        return;
    }
    
    // 如果是暂停后继续，不需要重置进度
    if (!generationState.isPaused) {
        // 显示加载状态
        if (generateBtn) generateBtn.disabled = true;
        if (btnText) btnText.style.display = 'none';
        if (btnLoading) btnLoading.style.display = 'inline';
        if (errorSection) errorSection.style.display = 'none';
        if (outputSection) outputSection.style.display = 'none';
        
        // 重置并显示进度区域
        resetProgress();
        const progressSection = getEl('progress-section');
        if (progressSection) progressSection.style.display = 'block';
    }
    
    // 设置生成状态
    generationState.isGenerating = true;
    generationState.isPaused = false;
    
    // 启用暂停按钮
    const pauseBtn = getEl('pause-btn');
    if (pauseBtn) pauseBtn.disabled = false;
    
    try {
        // 使用 fetch 发起 POST 请求并读取 SSE 流
        const response = await fetch(`${API_BASE_URL}/generate`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ scene })
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        // 获取 reader 读取流
        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        
        let buffer = '';
        
        while (true) {
            const { done, value } = await reader.read();
            
            if (done) break;
            
            buffer += decoder.decode(value, { stream: true });
            
            // 处理 SSE 事件
            const events = buffer.split('\n\n');
            buffer = events.pop(); // 保留未完成的部分
            
            for (const event of events) {
                const dataMatch = event.match(/^data: (.+)$/m);
                if (dataMatch) {
                    try {
                        const data = JSON.parse(dataMatch[1]);
                        handleSSEEvent(data);
                    } catch (e) {
                        console.error('解析 SSE 数据失败:', e);
                    }
                }
            }
        }
        
    } catch (error) {
        console.error('生成失败:', error);
        showError(`生成失败: ${error.message}`);
        resetProgress();
    } finally {
        // 恢复按钮状态
        if (generateBtn) generateBtn.disabled = false;
        if (btnText) btnText.style.display = 'inline';
        if (btnLoading) btnLoading.style.display = 'none';
    }
}

/**
 * 处理 SSE 事件
 */
function handleSSEEvent(data) {
    console.log('SSE 事件:', data);
    
    switch (data.type) {
        case 'status':
            // 状态更新
            const progressPhase = document.getElementById('progress-phase');
            if (progressPhase) {
                progressPhase.textContent = data.message;
            }
            break;
            
        case 'steps':
            // 接收步骤信息，动态渲染
            cachedSteps.prototype = data.prototypeSteps || [];
            cachedSteps.prd = data.prdSteps || data.prdSubSteps || [];
            
            if (cachedSteps.prototype.length > 0) {
                renderSteps('prototype', cachedSteps.prototype);
            }
            if (cachedSteps.prd.length > 0) {
                renderSteps('prd', cachedSteps.prd);
            }
            break;
            
        case 'phase':
            // 阶段切换
            showPhase(data.phase, data.name, data.skill);
            break;
            
        case 'progress':
            // 进度更新
            updateProgress(data.phase, data.progress, data.stepData?.title);
            
            // 更新步骤状态
            // 将之前的步骤标记为完成
            for (let i = 1; i < data.step; i++) {
                updateStepStatus(data.phase, i, 'completed');
            }
            
            // 当前步骤
            updateStepStatus(data.phase, data.step, data.status);
            break;
            
        case 'complete':
            // 完成
            updateProgress('', 100, '完成');
            
            // 标记所有步骤完成
            if (cachedSteps.prototype.length > 0) {
                for (let i = 1; i <= cachedSteps.prototype.length; i++) {
                    updateStepStatus('prototype', i, 'completed');
                }
            }
            if (cachedSteps.prd.length > 0) {
                for (let i = 1; i <= cachedSteps.prd.length; i++) {
                    updateStepStatus('prd', i, 'completed');
                }
            }
            
            // 保存结果
            currentResult.html = data.html;
            currentResult.prd = data.prd;
            
            // 显示结果
            displayResults();
            const outputSection2 = getEl('output-section');
            if (outputSection2) outputSection2.style.display = 'block';
            
            // 延迟隐藏进度
            setTimeout(() => {
                const progressSection2 = getEl('progress-section');
                if (progressSection2) progressSection2.style.display = 'none';
            }, 2000);
            
            // 滚动到结果区域
            if (outputSection2) outputSection2.scrollIntoView({ behavior: 'smooth' });
            break;
            
        case 'validation_error':
            // 输入验证错误 - 使用弹窗显示
            showModal(data.message, '输入验证失败', '⚠️');
            resetProgress();
            resetGenerateButton();
            break;
            
        case 'error':
            // 错误
            showModal(data.message, '生成失败', '❌');
            resetProgress();
            resetGenerateButton();
            break;
    }
}

/**
 * 重置生成按钮状态
 */
function resetGenerateButton() {
    const generateBtn = getEl('generate-btn');
    const btnText = generateBtn?.querySelector('.btn-text');
    const btnLoading = generateBtn?.querySelector('.btn-loading');
    const progressSection = getEl('progress-section');
    
    if (generateBtn) generateBtn.disabled = false;
    if (btnText) btnText.style.display = 'inline';
    if (btnLoading) btnLoading.style.display = 'none';
    if (progressSection) progressSection.style.display = 'none';
}

/**
 * 切换标签页
 */
function switchTab(tab) {
    const htmlTab = document.querySelector('.tab-btn:nth-child(1)');
    const prdTab = document.querySelector('.tab-btn:nth-child(2)');
    const htmlPreview = getEl('html-preview');
    const prdPreview = getEl('prd-preview');
    
    if (tab === 'html') {
        htmlTab?.classList.add('active');
        prdTab?.classList.remove('active');
        if (htmlPreview) htmlPreview.style.display = 'block';
        if (prdPreview) prdPreview.style.display = 'none';
    } else {
        htmlTab?.classList.remove('active');
        prdTab?.classList.add('active');
        if (htmlPreview) htmlPreview.style.display = 'none';
        if (prdPreview) prdPreview.style.display = 'block';
    }
}

/**
 * 显示生成结果
 */
function displayResults() {
    const htmlPreview = getEl('html-preview');
    const prdPreview = getEl('prd-preview');
    
    if (htmlPreview) htmlPreview.innerHTML = currentResult.html;
    if (prdPreview && typeof marked !== 'undefined') prdPreview.innerHTML = marked.parse(currentResult.prd);
}

/**
 * 显示错误
 */
function showError(message) {
    const errorSection = getEl('error-section');
    if (!errorSection) return;
    const errorText = errorSection.querySelector('.error-message');
    
    if (errorText) {
        errorText.textContent = message;
    }
    errorSection.style.display = 'block';
}

/**
 * 查看 HTML
 */
function viewHTML() {
    const blob = new Blob([currentResult.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    window.open(url, '_blank');
}

/**
 * 下载 HTML
 */
function downloadHTML() {
    const blob = new Blob([currentResult.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'prototype.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 下载 PRD
 */
function downloadPRD() {
    const blob = new Blob([currentResult.prd], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'PRD.md';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// 初始化
document.addEventListener('DOMContentLoaded', () => {
    console.log('PM Agent 前端已加载');
    console.log('API地址:', API_BASE_URL);
    console.log('支持 SSE 实时进度');
});
