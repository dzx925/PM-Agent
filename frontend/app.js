// API 配置 - 部署后需要修改为实际的 Render 服务地址
const API_BASE_URL = 'https://pm-agent-api.onrender.com'; // 部署后修改为实际地址

// 存储生成的结果
let currentResult = {
    html: '',
    prd: ''
};

/**
 * 生成原型和PRD
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
    
    try {
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
        
        const result = await response.json();
        
        if (result.error) {
            throw new Error(result.error);
        }
        
        // 保存结果
        currentResult.html = result.html;
        currentResult.prd = result.prd;
        
        // 显示结果
        displayResults();
        outputSection.style.display = 'block';
        
        // 滚动到结果区域
        outputSection.scrollIntoView({ behavior: 'smooth' });
        
    } catch (error) {
        console.error('生成失败:', error);
        showError(`生成失败: ${error.message}`);
    } finally {
        // 恢复按钮状态
        generateBtn.disabled = false;
        btnText.style.display = 'inline';
        btnLoading.style.display = 'none';
    }
}

/**
 * 显示生成结果
 */
function displayResults() {
    // 显示 HTML 原型
    const htmlPreview = document.getElementById('html-preview');
    htmlPreview.srcdoc = currentResult.html;
    
    // 显示 PRD
    const prdContent = document.getElementById('prd-content');
    prdContent.textContent = currentResult.prd;
}

/**
 * 切换标签页
 */
function switchTab(tab) {
    const tabBtns = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.panel');
    
    tabBtns.forEach(btn => btn.classList.remove('active'));
    panels.forEach(panel => panel.classList.remove('active'));
    
    if (tab === 'html') {
        tabBtns[0].classList.add('active');
        document.getElementById('html-panel').classList.add('active');
    } else {
        tabBtns[1].classList.add('active');
        document.getElementById('prd-panel').classList.add('active');
    }
}

/**
 * 下载 HTML 文件
 */
function downloadHTML() {
    if (!currentResult.html) {
        alert('请先生成原型');
        return;
    }
    
    const blob = new Blob([currentResult.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prototype_${getTimestamp()}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 下载 PRD Markdown 文件
 */
function downloadPRD() {
    if (!currentResult.prd) {
        alert('请先生成PRD');
        return;
    }
    
    const blob = new Blob([currentResult.prd], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PRD_${getTimestamp()}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * 显示错误信息
 */
function showError(message) {
    const errorSection = document.getElementById('error-section');
    const errorMessage = errorSection.querySelector('.error-message');
    errorMessage.textContent = message;
    errorSection.style.display = 'block';
}

/**
 * 获取时间戳字符串
 */
function getTimestamp() {
    const now = new Date();
    return now.toISOString().slice(0, 19).replace(/:/g, '-');
}

// 监听 Enter 键
document.getElementById('scene-input').addEventListener('keydown', function(e) {
    if (e.key === 'Enter' && e.ctrlKey) {
        generate();
    }
});
