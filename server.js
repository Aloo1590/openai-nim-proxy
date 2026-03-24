// server.js - OpenAI to NVIDIA NIM API Proxy (Fast)
const express = require('express');
const cors = require('cors');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: '50mb' }));

const NIM_API_BASE = process.env.NIM_API_BASE || 'https://integrate.api.nvidia.com/v1';
const NIM_API_KEY = process.env.NIM_API_KEY;
const SHOW_REASONING = process.env.SHOW_REASONING === 'true';
const ENABLE_THINKING_MODE = process.env.ENABLE_THINKING_MODE === 'true';
const REQUEST_TIMEOUT = parseInt(process.env.REQUEST_TIMEOUT) || 120000;

const MODEL_MAPPING = {
  'deepseek-v3.1-terminus': 'deepseek-ai/deepseek-v3.1-terminus',
  'deepseek-v3.2': 'deepseek-ai/deepseek-v3.2',
  'mistral': 'mistralai/mistral-large-3-675b-instruct-2512',
  'deepseek-v3.1': 'deepseek-ai/deepseek-v3.1',
  'minimax': 'minimaxai/minimax-m2.1',
  'stepfun': 'stepfun-ai/step-3.5-flash',
  'kimi': 'moonshotai/kimi-k2.5',
  'glm4.7': 'z-ai/glm4.7',
  'glm5': 'z-ai/glm5',
  'meta/llama-3.1-8b-instruct': 'meta/llama-3.1-8b-instruct',
  'meta/llama-3.1-70b-instruct': 'meta/llama-3.1-70b-instruct',
  'meta/llama-3.1-405b-instruct': 'meta/llama-3.1-405b-instruct',
  'deepseek-ai/deepseek-v3.1': 'deepseek-ai/deepseek-v3.1',
  'qwen/qwen3-coder-480b-a35b-instruct': 'qwen/qwen3-coder-480b-a35b-instruct',
  'nvidia/llama-3.1-nemotron-ultra-253b-v1': 'nvidia/llama-3.1-nemotron-ultra-253b-v1',
};

const REASONING_CAPABLE_MODELS = new Set([
  'z-ai/glm5', 'z-ai/glm4.7',
  'deepseek-ai/deepseek-v3.1', 'deepseek-ai/deepseek-v3.1-terminus',
  'moonshotai/kimi-k2.5',
]);

if (!NIM_API_KEY) {
  console.warn('⚠️  WARNING: NIM_API_KEY not set! Requests will fail.');
} else {
  console.log('✅ NIM_API_KEY configured');
}

function selectModel(requested) {
  if (MODEL_MAPPING[requested]) return MODEL_MAPPING[requested];
  if (requested.includes('/')) return requested;
  const m = requested.toLowerCase();
  if (m.includes('opus') || m.includes('405b') || m.includes('gpt-4o') || m.includes('ultra'))
    return 'meta/llama-3.1-405b-instruct';
  if (m.includes('sonnet') || m.includes('gpt-4') || m.includes('70b') || m.includes('gemini'))
    return 'meta/llama-3.1-70b-instruct';
  return 'meta/llama-3.1-8b-instruct';
}

// Rewrite a single SSE line to merge reasoning_content into content
// Only parses JSON when reasoning is actually involved — skips otherwise
function rewriteLine(line, showReasoning, inReasoning) {
  if (!line.startsWith('data: ')) return { line, inReasoning };
  const jsonStr = line.slice(6);
  if (jsonStr === '[DONE]') return { line, inReasoning };

  try {
    const data = JSON.parse(jsonStr);
    const delta = data.choices?.[0]?.delta;
    if (!delta) return { line: `data: ${JSON.stringify(data)}`, inReasoning };

    const reasoning = delta.reasoning_content;
    const content = delta.content;
    let outputContent = '';
    let nextInReasoning = inReasoning;

    if (showReasoning) {
      if (reasoning && !inReasoning) {
        outputContent = '<think>\n' + reasoning;
        nextInReasoning = true;
      } else if (reasoning && inReasoning) {
        outputContent = reasoning;
      } else if (content && inReasoning) {
        outputContent = '\n</think>\n\n' + content;
        nextInReasoning = false;
      } else if (content) {
        outputContent = content;
      }
    } else {
      // Hide reasoning entirely — only pass through actual content
      if (content) outputContent = content;
    }

    data.choices[0].delta = outputContent
      ? { content: outputContent, role: delta.role }
      : { role: delta.role };

    return { line: `data: ${JSON.stringify(data)}`, inReasoning: nextInReasoning };
  } catch {
    return { line, inReasoning };
  }
}

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'OpenAI to NVIDIA NIM Proxy',
    reasoning_display: SHOW_REASONING,
    thinking_mode: ENABLE_THINKING_MODE,
    api_configured: !!NIM_API_KEY,
  });
});

app.get('/', (req, res) => {
  res.json({
    service: 'OpenAI to NVIDIA NIM Proxy',
    endpoints: { health: '/health', models: '/v1/models', chat: '/v1/chat/completions' },
    config: { reasoning_display: SHOW_REASONING, thinking_mode: ENABLE_THINKING_MODE },
  });
});

app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: Object.keys(MODEL_MAPPING)
      .filter(k => !k.includes('/'))
      .map(id => ({
        id,
        object: 'model',
        created: Math.floor(Date.now() / 1000),
        owned_by: 'nvidia-nim-proxy',
        reasoning_capable: REASONING_CAPABLE_MODELS.has(MODEL_MAPPING[id]),
      })),
  });
});

app.get('/v1/models/:model', (req, res) => {
  res.json({
    id: req.params.model,
    object: 'model',
    created: Math.floor(Date.now() / 1000),
    owned_by: 'nvidia-nim-proxy',
  });
});

// Main proxy endpoint
app.post('/v1/chat/completions', async (req, res) => {
  try {
    if (!NIM_API_KEY) {
      return res.status(401).json({
        error: { message: 'NIM_API_KEY not configured', type: 'authentication_error', code: 'api_key_missing' },
      });
    }

    const body = req.body;
    if (!body.model || !body.messages || !Array.isArray(body.messages)) {
      return res.status(400).json({
        error: { message: 'model and messages are required', type: 'invalid_request_error', code: 'invalid_request' },
      });
    }

    const nimModel = selectModel(body.model);

    // Build NIM body — only forward what NIM supports
    const nimBody = {
      model: nimModel,
      messages: body.messages,
      stream: body.stream || false,
    };

    // Optional params — only add if provided
    if (body.temperature !== undefined) nimBody.temperature = body.temperature;
    if (body.max_tokens !== undefined) nimBody.max_tokens = body.max_tokens;
    if (body.top_p !== undefined) nimBody.top_p = body.top_p;
    if (body.frequency_penalty !== undefined) nimBody.frequency_penalty = body.frequency_penalty;
    if (body.presence_penalty !== undefined) nimBody.presence_penalty = body.presence_penalty;

    // Thinking mode via env var
    if (ENABLE_THINKING_MODE && REASONING_CAPABLE_MODELS.has(nimModel)) {
      nimBody.chat_template_kwargs = { enable_thinking: true, clear_thinking: !SHOW_REASONING };
    }

    console.log(`[${new Date().toISOString()}] ${nimBody.stream ? 'STREAM' : 'REQUEST'} ${body.model} -> ${nimModel}`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(`${NIM_API_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(nimBody),
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // --- STREAMING ---
    if (nimBody.stream) {
      if (!response.ok) {
        const err = await response.json().catch(() => ({ error: 'Unknown NIM error' }));
        return res.status(response.status).json(err);
      }

      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let tail = '';       // carry-over from previous chunk (incomplete line)
      let inReasoning = false;
      const needsRewrite = SHOW_REASONING || ENABLE_THINKING_MODE;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        // If no reasoning involved, pipe bytes directly — fastest possible path
        if (!needsRewrite) {
          res.write(value);
          continue;
        }

        // Otherwise parse and rewrite reasoning chunks
        const text = tail + decoder.decode(value, { stream: true });
        const lines = text.split('\n');
        tail = lines.pop() ?? ''; // last element may be incomplete

        const out = [];
        for (const line of lines) {
          const result = rewriteLine(line.trim(), SHOW_REASONING, inReasoning);
          inReasoning = result.inReasoning;
          out.push(result.line);
        }
        res.write(out.join('\n') + '\n');
      }

      // Flush any remaining tail
      if (tail) res.write(tail);
      res.end();
      return;
    }

    // --- NON-STREAMING ---
    const data = await response.json();

    if (response.ok && data.choices) {
      data.choices = data.choices.map(choice => {
        const reasoning = choice.message?.reasoning_content;
        if (reasoning) {
          if (SHOW_REASONING) {
            choice.message.content = `<think>\n${reasoning}\n</think>\n\n${choice.message.content || ''}`;
          }
          delete choice.message.reasoning_content;
        }
        // Always return original requested model name
        return choice;
      });
      data.model = body.model;
    }

    res.status(response.status).json(data);

  } catch (err) {
    if (err.name === 'AbortError') {
      return res.status(504).json({
        error: { message: 'Request timed out', type: 'timeout_error', code: 504 },
      });
    }
    console.error('Proxy error:', err.message);
    res.status(500).json({
      error: { message: err.message || 'Internal server error', type: 'internal_error', code: 500 },
    });
  }
});

app.all('*', (req, res) => {
  res.status(404).json({
    error: { message: `${req.method} ${req.path} not found`, type: 'invalid_request_error', code: 404 },
  });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: { message: 'Internal server error', type: 'internal_error', code: 500 } });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║       OpenAI to NVIDIA NIM API Proxy (Fast)             ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');
  console.log(`🚀 Running on: http://0.0.0.0:${PORT}`);
  console.log(`🔑 API Key: ${NIM_API_KEY ? '✅ Configured' : '❌ NOT SET'}`);
  console.log(`⚙️  SHOW_REASONING: ${SHOW_REASONING ? '✅ ON' : '❌ OFF'}`);
  console.log(`⚙️  ENABLE_THINKING_MODE: ${ENABLE_THINKING_MODE ? '✅ ON' : '❌ OFF'}`);
  console.log(`⚙️  REQUEST_TIMEOUT: ${REQUEST_TIMEOUT}ms`);
});

process.on('SIGTERM', () => { console.log('Shutting down...'); process.exit(0); });
process.on('SIGINT', () => { console.log('\nShutting down...'); process.exit(0); });
