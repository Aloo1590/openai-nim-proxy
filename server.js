// server.js - OpenAI to NVIDIA NIM API Proxy (Improved)
const express = require('express');
const cors = require('cors');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// NVIDIA NIM API configuration
const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;

// Configuration toggles
const SHOW_REASONING = process.env.SHOW_REASONING === 'true' || false;
const ENABLE_THINKING_MODE = process.env.ENABLE_THINKING_MODE === 'true' || false;
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT) || 120000; // 2 minutes

// Model mapping with better organization
const MODEL_MAPPING = {
  // GPT models
  'gpt-3.5-turbo': 'meta/llama-3.1-8b-instruct',
  'gpt-4': 'meta/llama-3.1-70b-instruct',
  'gpt-4-turbo': 'meta/llama-3.1-405b-instruct',
  'gpt-4o': 'deepseek-ai/deepseek-v3.1',
  
  // Claude models
  'claude-3-opus': 'meta/llama-3.1-405b-instruct',
  'claude-3-sonnet': 'meta/llama-3.1-70b-instruct',
  'claude-3-haiku': 'meta/llama-3.1-8b-instruct',
  
  // Gemini models
  'gemini-pro': 'meta/llama-3.1-70b-instruct',
  
  // Direct NIM models (passthrough)
  'meta/llama-3.1-8b-instruct': 'meta/llama-3.1-8b-instruct',
  'meta/llama-3.1-70b-instruct': 'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-405b-instruct': 'meta/llama-3.1-405b-instruct',
  'deepseek-ai/deepseek-v3.1': 'deepseek-ai/deepseek-v3.1',
  'qwen/qwen3-coder-480b-a35b-instruct': 'qwen/qwen3-coder-480b-a35b-instruct',
  'nvidia/llama-3.1-nemotron-ultra-253b-v1': 'nvidia/llama-3.1-nemotron-ultra-253b-v1'
};

// Validate API key on startup
if (!NIM_API_KEY) {
  console.warn('⚠️  WARNING: NIM_API_KEY not set! Requests will fail.');
} else {
  console.log('✅ NIM_API_KEY configured');
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    service: 'OpenAI to NVIDIA NIM Proxy', 
    reasoning_display: SHOW_REASONING,
    thinking_mode: ENABLE_THINKING_MODE,
    api_configured: !!NIM_API_KEY
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    service: 'OpenAI to NVIDIA NIM Proxy',
    endpoints: {
      health: '/health',
      models: '/v1/models',
      chat: '/v1/chat/completions'
    },
    config: {
      reasoning_display: SHOW_REASONING,
      thinking_mode: ENABLE_THINKING_MODE
    }
  });
});

// List models endpoint (OpenAI compatible)
app.get('/v1/models', (req, res) => {
  const models = Object.keys(MODEL_MAPPING)
    .filter(key => !key.includes('/')) // Only show friendly names
    .map(model => ({
      id: model,
      object: 'model',
      created: Math.floor(Date.now() / 1000),
      owned_by: 'nvidia-nim-proxy'
    }));
  
  res.json({
    object: 'list',
    data: models
  });
});

// Get specific model info
app.get('/v1/models/:model', (req, res) => {
  const model = req.params.model;
  
  res.json({
    id: model,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'nvidia-nim-proxy'
  });
});

// Smart model selection with better fallback logic
function selectModel(requestedModel) {
  // Direct mapping exists
  if (MODEL_MAPPING[requestedModel]) {
    return MODEL_MAPPING[requestedModel];
  }
  
  // Model name looks like a NIM model path - try using it directly
  if (requestedModel.includes('/')) {
    return requestedModel;
  }
  
  // Intelligent fallback based on model name
  const modelLower = requestedModel.toLowerCase();
  
  // Large models
  if (modelLower.includes('opus') || modelLower.includes('405b') || 
      modelLower.includes('gpt-4o') || modelLower.includes('ultra')) {
    return 'meta/llama-3.1-405b-instruct';
  }
  
  // Medium models
  if (modelLower.includes('sonnet') || modelLower.includes('gpt-4') || 
      modelLower.includes('70b') || modelLower.includes('gemini')) {
    return 'meta/llama-3.1-70b-instruct';
  }
  
  // Small/fast models (default)
  return 'meta/llama-3.1-8b-instruct';
}

// Process reasoning content for display
function processReasoningContent(choice, showReasoning) {
  if (!choice.message) return choice;
  
  const reasoning = choice.message.reasoning_content;
  const content = choice.message.content || '';
  
  if (showReasoning && reasoning) {
    // Combine reasoning and content with tags
    choice.message.content = `<think>\n${reasoning}\n</think>\n\n${content}`;
    delete choice.message.reasoning_content;
  } else {
    // Remove reasoning, keep only content
    delete choice.message.reasoning_content;
  }
  
  return choice;
}

// Chat completions endpoint (main proxy)
app.post('/v1/chat/completions', async (req, res) => {
  try {
    // Validate API key
    if (!NIM_API_KEY) {
      return res.status(401).json({
        error: {
          message: 'NIM_API_KEY not configured on server',
          type: 'authentication_error',
          code: 'api_key_missing'
        }
      });
    }
    
    const { model, messages, temperature, max_tokens, stream, top_p, frequency_penalty, presence_penalty } = req.body;
    
    // Validate required fields
    if (!model || !messages || !Array.isArray(messages)) {
      return res.status(400).json({
        error: {
          message: 'Missing required fields: model and messages are required',
          type: 'invalid_request_error',
          code: 'invalid_request'
        }
      });
    }
    
    // Select appropriate NIM model
    const nimModel = selectModel(model);
    
    // Build NIM request with only supported parameters
    const nimRequest = {
      model: nimModel,
      messages: messages,
      temperature: temperature !== undefined ? temperature : 0.7,
      max_tokens: max_tokens || 2048,
      stream: stream || false
    };
    
    // Add optional parameters if provided
    if (top_p !== undefined) nimRequest.top_p = top_p;
    if (frequency_penalty !== undefined) nimRequest.frequency_penalty = frequency_penalty;
    if (presence_penalty !== undefined) nimRequest.presence_penalty = presence_penalty;
    
    // Add thinking mode if enabled
    if (ENABLE_THINKING_MODE) {
      nimRequest.extra_body = { chat_template_kwargs: { thinking: true } };
    }
    
    console.log(`[${new Date().toISOString()}] ${stream ? 'STREAM' : 'REQUEST'} ${model} -> ${nimModel}`);
    
    // Make request to NVIDIA NIM API
    const response = await axios.post(
      `${NIM_API_BASE}/chat/completions`,
      nimRequest,
      {
        headers: {
          'Authorization': `Bearer ${NIM_API_KEY}`,
          'Content-Type': 'application/json'
        },
        responseType: stream ? 'stream' : 'json',
        timeout: REQUEST_TIMEOUT
      }
    );
    
    if (stream) {
      // Handle streaming response
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      
      let buffer = '';
      let reasoningBuffer = '';
      let inReasoning = false;
      
      response.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        lines.forEach(line => {
          line = line.trim();
          
          if (!line || line === '') return;
          
          if (line.startsWith('data: ')) {
            const dataStr = line.slice(6);
            
            // Handle [DONE] marker
            if (dataStr === '[DONE]') {
              res.write('data: [DONE]\n\n');
              return;
            }
            
            try {
              const data = JSON.parse(dataStr);
              
              if (data.choices?.[0]?.delta) {
                const delta = data.choices[0].delta;
                const reasoning = delta.reasoning_content;
                const content = delta.content;
                
                if (SHOW_REASONING) {
                  let outputContent = '';
                  
                  // Start of reasoning
                  if (reasoning && !inReasoning) {
                    outputContent = '<think>\n' + reasoning;
                    inReasoning = true;
                    reasoningBuffer = reasoning;
                  }
                  // Continuation of reasoning
                  else if (reasoning && inReasoning) {
                    outputContent = reasoning;
                    reasoningBuffer += reasoning;
                  }
                  // End of reasoning, start of content
                  else if (content && inReasoning) {
                    outputContent = '\n</think>\n\n' + content;
                    inReasoning = false;
                    reasoningBuffer = '';
                  }
                  // Just content (no reasoning)
                  else if (content) {
                    outputContent = content;
                  }
                  
                  if (outputContent) {
                    data.choices[0].delta = { content: outputContent, role: delta.role };
                  } else {
                    data.choices[0].delta = { role: delta.role };
                  }
                } else {
                  // Hide reasoning, only show content
                  if (content) {
                    data.choices[0].delta = { content: content, role: delta.role };
                  } else {
                    data.choices[0].delta = { role: delta.role };
                  }
                }
              }
              
              res.write(`data: ${JSON.stringify(data)}\n\n`);
            } catch (e) {
              // If JSON parsing fails, forward as-is
              console.error('JSON parse error:', e.message);
              res.write(line + '\n\n');
            }
          } else {
            // Non-data lines, forward as-is
            res.write(line + '\n');
          }
        });
      });
      
      response.data.on('end', () => {
        res.end();
      });
      
      response.data.on('error', (err) => {
        console.error('Stream error:', err.message);
        res.end();
      });
      
      // Handle client disconnect
      req.on('close', () => {
        response.data.destroy();
      });
      
    } else {
      // Handle non-streaming response
      const nimResponse = response.data;
      
      // Transform to OpenAI format with reasoning processing
      const openaiResponse = {
        id: nimResponse.id || `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: nimResponse.created || Math.floor(Date.now() / 1000),
        model: model, // Return original requested model
        choices: nimResponse.choices.map(choice => 
          processReasoningContent({
            index: choice.index,
            message: {
              role: choice.message?.role || 'assistant',
              content: choice.message?.content || '',
              reasoning_content: choice.message?.reasoning_content
            },
            finish_reason: choice.finish_reason || 'stop'
          }, SHOW_REASONING)
        ),
        usage: nimResponse.usage || {
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: 0
        }
      };
      
      res.json(openaiResponse);
    }
    
  } catch (error) {
    console.error('Proxy error:', error.message);
    
    // Handle axios errors
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      
      return res.status(status).json({
        error: {
          message: data.error?.message || data.message || 'NVIDIA NIM API error',
          type: data.error?.type || 'api_error',
          code: status
        }
      });
    }
    
    // Handle timeout
    if (error.code === 'ECONNABORTED') {
      return res.status(504).json({
        error: {
          message: 'Request timeout - response took too long',
          type: 'timeout_error',
          code: 504
        }
      });
    }
    
    // Generic error
    res.status(500).json({
      error: {
        message: error.message || 'Internal server error',
        type: 'internal_error',
        code: 500
      }
    });
  }
});

// Catch-all for unsupported endpoints
app.all('*', (req, res) => {
  res.status(404).json({
    error: {
      message: `Endpoint ${req.method} ${req.path} not found`,
      type: 'invalid_request_error',
      code: 404
    }
  });
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({
    error: {
      message: 'Internal server error',
      type: 'internal_error',
      code: 500
    }
  });
});

// Start server
app.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║       OpenAI to NVIDIA NIM API Proxy (Improved)         ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`🚀 Server running on: http://0.0.0.0:${PORT}`);
  console.log(`📡 Use in apps: http://YOUR_IP:${PORT}/v1`);
  console.log(`🔑 API Key: ${NIM_API_KEY ? '✅ Configured' : '❌ NOT SET'}`);
  console.log(`\n⚙️  Configuration:`);
  console.log(`   Reasoning Display: ${SHOW_REASONING ? '✅ ENABLED' : '❌ DISABLED'}`);
  console.log(`   Thinking Mode: ${ENABLE_THINKING_MODE ? '✅ ENABLED' : '❌ DISABLED'}`);
  console.log(`   Request Timeout: ${REQUEST_TIMEOUT}ms`);
  console.log(`\n📚 Endpoints:`);
  console.log(`   Health: http://localhost:${PORT}/health`);
  console.log(`   Models: http://localhost:${PORT}/v1/models`);
  console.log(`   Chat: http://localhost:${PORT}/v1/chat/completions`);
  console.log('\n💡 Tip: Set NIM_API_KEY environment variable');
  console.log('   export NIM_API_KEY="your-key-here"\n');
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('\nSIGINT received, shutting down gracefully...');
  process.exit(0);
});
