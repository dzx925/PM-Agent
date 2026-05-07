// API 基础 URL - 生产环境使用 Render 地址
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

/**
 * 动态渲染步骤列表
 */
function renderSteps(phase, steps) {
    const container = document.getElementById(`${phase}-steps`);
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
    const stepEl = document.getElementById(`${phase}-step-${stepNumber}`);
    if (!stepEl) return;
    
    const iconEl = stepEl.querySelector('.step-icon');
    
    // 清除所有状态
    stepEl.classList.remove('active', 'completed', 'ai-generating');
    
    switch (status) {
        case 'processing':
            stepEl.classList.add('active');
            iconEl.textContent = '🔄';
            break;
        case 'ai-generating':
            stepEl.classList.add('ai-generating');
            iconEl.textContent = '🤖';
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
 * 更新进度显示
 */
function updateProgress(phase, progress, phaseName) {
    const progressFill = document.getElementById('progress-fill');
    const progressPhase = document.getElementById('progress-phase');
    const progressPercent = document.getElementById('progress-percent');
    
    progressFill.style.width = `${progress}%`;
    progressPercent.textContent = `${progress}%`;
    
    if (phaseName) {
        progressPhase.textContent = phaseName;
    }
}

/**
 * 显示阶段标题
 */
function showPhase(phase, name, skill) {
    const titleEl = document.getElementById(`${phase}-phase-title`);
    titleEl.style.display = 'block';
    titleEl.querySelector('strong').textContent = phase === 'prototype' ? '🎨 ' + name : '📝 ' + name;
    titleEl.querySelector('.phase-skill').textContent = skill;
    
    document.getElementById(`${phase}-steps`).style.display = 'flex';
}

/**
 * 重置进度
 */
function resetProgress() {
    const progressSection = document.getElementById('progress-section');
    progressSection.style.display = 'none';
    
    document.getElementById('progress-fill').style.width = '0%';
    document.getElementById('progress-percent').textContent = '0%';
    document.getElementById('progress-phase').textContent = '准备生成';
    
    document.getElementById('prototype-phase-title').style.display = 'none';
    document.getElementById('prd-phase-title').style.display = 'none';
    
    // 清空动态步骤
    document.getElementById('prototype-steps').innerHTML = '';
    document.getElementById('prd-steps').innerHTML = '';
}

/**
 * 生成原型和PRD - 使用 SSE
 */
async function generate() {
    const sceneInput = document.getElementById('scene-input');
    const generateBtn = document.getElementById('generate-btn');
    const btnText = generateBtn.querySelector('.btn-text');
    const btnLoading = generateBtn.querySelector('.btn-loading');
    const outputSection = document.getElementById('output-section');
    const errorSection = document.getElementById('error-section');
    
    const scene = sceneInput.value.trim();
    
    if (!scene) {
        alert('请输入业务场景描述');
        return;
    }
    
    // 显示加载状态
    generateBtn.disabled = true;
    btnText.style.display = 'none';
    btnLoading.style.display = 'inline';
    errorSection.style.display = 'none';
    outputSection.style.display = 'none';
    
    // 重置并显示进度区域
    resetProgress();
    document.getElementById('progress-section').style.display = 'block';
    
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
        generateBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
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
            document.getElementById('progress-phase').textContent = data.message;
            break;
            
        case 'steps':
            // 接收步骤信息，动态渲染
            cachedSteps.prototype = data.prototypeSteps || [];
            cachedSteps.prd = data.prdSteps || [];
            
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
            document.getElementById('output-section').style.display = 'block';
            
            // 延迟隐藏进度
            setTimeout(() => {
                document.getElementById('progress-section').style.display = 'none';
            }, 2000);
            
            // 滚动到结果区域
            document.getElementById('output-section').scrollIntoView({ behavior: 'smooth' });
            break;
            
        case 'error':
            // 错误
            showError(`生成失败: ${data.message}`);
            resetProgress();
            break;
    }
}

/**
 * 显示生成结果
 */
function displayResults() {
    const htmlPreview = document.getElementById('html-preview');
    const prdPreview = document.getElementById('prd-preview');
    
    htmlPreview.innerHTML = currentResult.html;
    prdPreview.innerHTML = marked.parse(currentResult.prd);
}

/**
 * 显示错误
 */
function showError(message) {
    const errorSection = document.getElementById('error-section');
    const errorText = document.getElementById('error-text');
    
    errorText.textContent = message;
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
