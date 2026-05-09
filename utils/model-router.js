/**
 * SiliconFlow 模型路由工具
 * 仅用于 GitHub 环境，Trae 环境不干预
 */

class SiliconFlowModelRouter {
  constructor() {
    // 免费模型列表（按优先级排序）
    this.models = [
      { id: 'THUDM/GLM-4-9B-0414', name: 'GLM-4-9B' },
      { id: 'Qwen/Qwen3-8B', name: 'Qwen3-8B' }
    ];
    
    this.apiKey = process.env.SILICONFLOW_API_KEY;
    this.baseUrl = 'https://api.siliconflow.cn/v1';
  }

  /**
   * 检测是否在 GitHub 环境
   */
  isGitHubEnvironment() {
    return process.env.GITHUB_ACTIONS === 'true' || 
           process.env.CI === 'true';
  }

  /**
   * 获取可用模型（带自动切换）
   * - Trae 环境：直接使用第一个模型
   * - GitHub 环境：尝试所有模型，失败时切换
   */
  async getAvailableModel() {
    // Trae 环境：不干预，使用默认模型
    if (!this.isGitHubEnvironment()) {
      console.log('[Trae环境] 使用默认模型');
      return this.models[0].id;
    }

    // GitHub 环境：尝试所有模型
    const errors = [];
    
    for (let i = 0; i < this.models.length; i++) {
      const model = this.models[i];
      
      try {
        console.log(`[GitHub环境] 尝试调用模型: ${model.id}`);
        // 试探性调用，验证模型是否可用
        await this.testModel(model.id);
        console.log(`[GitHub环境] 模型可用: ${model.id}`);
        return model.id;
        
      } catch (error) {
        errors.push({ model: model.id, error: error.message });
        
        // 不是最后一个模型，静默切换
        if (i < this.models.length - 1) {
          console.log(`[GitHub环境] ${model.id} 失败，切换到备用模型`);
          continue;
        }
        
        // 所有模型都失败了，给出提示
        throw new Error(
          `所有模型调用失败，可能已开始收费，请检查：\n\n` +
          errors.map(e => `- ${e.model}: ${e.error}`).join('\n') +
          `\n\n请访问 https://siliconflow.cn/models 确认定价`
        );
      }
    }
  }

  /**
   * 测试模型是否可用（试探性调用）
   */
  async testModel(modelId) {
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: modelId,
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 1
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`${response.status}: ${errorText}`);
    }

    return true;
  }

  /**
   * 调用模型（完整调用）
   */
  async callModel(messages, options = {}) {
    const model = await this.getAvailableModel();
    
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: model,
        messages: messages,
        max_tokens: 2000,
        temperature: 0.7,
        ...options
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`模型调用失败: ${errorText}`);
    }

    return response.json();
  }
}

module.exports = SiliconFlowModelRouter;
