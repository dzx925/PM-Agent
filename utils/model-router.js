/**
 * SiliconFlow 免费模型路由管理器
 * 自动选择可用的免费模型，处理模型切换和重试逻辑
 */

class SiliconFlowModelRouter {
  constructor() {
    // 免费模型列表（按优先级排序）
    this.models = [
      { id: 'THUDM/GLM-4-9B-0414', name: 'GLM-4-9B' },
      { id: 'Qwen/Qwen3-8B', name: 'Qwen3-8B' }
    ];
    
    this.baseUrl = 'https://api.siliconflow.cn/v1';
    this.currentModelIndex = 0;
    this.retryCount = 0;
    this.maxRetries = 2;
  }

  /**
   * 获取 API Key（延迟获取，确保环境变量已设置）
   */
  getApiKey() {
    return process.env.OPENAI_API_KEY;
  }

  /**
   * 获取当前模型
   */
  getCurrentModel() {
    return this.models[this.currentModelIndex];
  }

  /**
   * 切换到下一个模型
   */
  switchToNextModel() {
    this.currentModelIndex = (this.currentModelIndex + 1) % this.models.length;
    this.retryCount = 0;
    console.log(`[ModelRouter] 切换到模型: ${this.getCurrentModel().name}`);
    return this.getCurrentModel();
  }

  /**
   * 检查模型是否可用
   */
  async checkModelAvailability(modelId) {
    try {
      console.log(`[ModelRouter] 检查模型可用性: ${modelId}`);
      
      const response = await fetch(`${this.baseUrl}/models`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.getApiKey()}`,
          'Content-Type': 'application/json'
        }
      });

      if (!response.ok) {
        console.error(`[ModelRouter] 获取模型列表失败: ${response.status}`);
        return true; // 如果无法检查，假设可用
      }

      const data = await response.json();
      const model = data.data?.find(m => m.id === modelId);
      
      if (!model) {
        console.warn(`[ModelRouter] 模型 ${modelId} 不在列表中`);
        return false;
      }

      const isAvailable = model.status === 'available';
      console.log(`[ModelRouter] 模型 ${modelId} 可用性: ${isAvailable}`);
      return isAvailable;
    } catch (error) {
      console.error(`[ModelRouter] 检查模型可用性失败:`, error.message);
      return true; // 出错时假设可用
    }
  }

  /**
   * 获取可用模型
   */
  async getAvailableModel() {
    console.log('[ModelRouter] 获取可用模型...');
    
    for (let i = 0; i < this.models.length; i++) {
      const model = this.models[this.currentModelIndex];
      const isAvailable = await this.checkModelAvailability(model.id);
      
      if (isAvailable) {
        console.log(`[ModelRouter] 选择模型: ${model.name} (${model.id})`);
        return model.id;
      }
      
      // 切换到下一个模型
      this.switchToNextModel();
    }

    // 如果所有模型都不可用，返回第一个作为默认值
    console.warn('[ModelRouter] 所有模型都不可用，使用默认模型');
    return this.models[0].id;
  }

  /**
   * 调用模型（完整调用）
   */
  async callModel(messages, options = {}) {
    console.log('[ModelRouter] callModel 开始调用');
    console.log('[ModelRouter] API Key:', this.getApiKey() ? '已设置' : '未设置');
    
    const model = await this.getAvailableModel();
    console.log('[ModelRouter] 使用模型:', model);
    
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.getApiKey()}`,
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
        console.error('[ModelRouter] 模型调用失败:', response.status, errorText);
        throw new Error(`模型调用失败: ${errorText}`);
      }

      console.log('[ModelRouter] 模型调用成功');
      return response.json();
    } catch (error) {
      console.error('[ModelRouter] callModel 异常:', error.message);
      throw error;
    }
  }

  /**
   * 流式调用模型（SSE）
   */
  async *streamModel(messages, options = {}) {
    const model = await this.getAvailableModel();
    
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.getApiKey()}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          model: model,
          messages: messages,
          max_tokens: 2000,
          temperature: 0.7,
          stream: true,
          ...options
        })
      });

      if (!response.ok) {
        throw new Error(`模型调用失败: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') return;
            
            try {
              const parsed = JSON.parse(data);
              yield parsed;
            } catch (e) {
              console.warn('解析流数据失败:', e);
            }
          }
        }
      }
    } catch (error) {
      console.error('流式调用失败:', error);
      throw error;
    }
  }

  /**
   * 带重试的模型调用
   */
  async callWithRetry(messages, options = {}) {
    while (this.retryCount < this.maxRetries) {
      try {
        return await this.callModel(messages, options);
      } catch (error) {
        this.retryCount++;
        console.warn(`[ModelRouter] 调用失败，重试 ${this.retryCount}/${this.maxRetries}`);
        
        if (this.retryCount >= this.maxRetries) {
          // 切换到下一个模型重试
          this.switchToNextModel();
          this.retryCount = 0;
        }
        
        // 等待后重试
        await new Promise(resolve => setTimeout(resolve, 1000 * this.retryCount));
      }
    }
    
    throw new Error('所有模型都调用失败');
  }
}

module.exports = SiliconFlowModelRouter;
