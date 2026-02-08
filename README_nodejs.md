# NVIDIA NIM Proxy - Improved Node.js Version

OpenAI-compatible API proxy for NVIDIA NIM with enhanced error handling, reasoning support, and better performance.

## ✨ Improvements Over Original

✅ **Better Error Handling** - Comprehensive error messages and proper HTTP status codes  
✅ **Smarter Model Selection** - Improved fallback logic and direct model passthrough  
✅ **Cleaner Streaming** - Fixed buffer handling and reasoning display  
✅ **Environment Config** - All settings via environment variables  
✅ **Validation** - Input validation and API key checks  
✅ **Timeout Handling** - Configurable request timeouts  
✅ **Client Disconnect** - Proper cleanup on stream cancellation  
✅ **Better Logging** - Request tracking and error visibility  
✅ **Graceful Shutdown** - Clean exit on SIGTERM/SIGINT  

## 🚀 Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Get NVIDIA API Key

1. Visit [build.nvidia.com](https://build.nvidia.com)
2. Sign up/login
3. Select a model
4. Click "Get API Key"
5. Copy your key

### 3. Configure

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and add your API key:

```env
NIM_API_KEY=nvapi-your-actual-key-here
PORT=3000
```

### 4. Run

```bash
npm start
```

Or for development with auto-reload:

```bash
npm run dev
```

## 📱 Janitor AI Android Setup

1. Open Janitor AI app
2. Go to Settings → API Settings
3. Select "OpenAI API" or "Custom API"
4. Configure:
   - **API URL**: `http://YOUR_IP:3000/v1`
   - **API Key**: Any text (ignored by proxy)
   - **Model**: `gpt-4` or any mapped model

### Finding Your IP

**Windows:**
```cmd
ipconfig
```

**Linux/Mac:**
```bash
hostname -I
```

**Or check the server output** - it shows the URL when starting

## 🎯 Model Mapping

The proxy automatically maps OpenAI/Claude/Gemini models to NVIDIA NIM:

| Request Model | → | NVIDIA NIM Model |
|--------------|---|------------------|
| `gpt-3.5-turbo` | → | `meta/llama-3.1-8b-instruct` |
| `gpt-4` | → | `meta/llama-3.1-70b-instruct` |
| `gpt-4-turbo` | → | `meta/llama-3.1-405b-instruct` |
| `gpt-4o` | → | `deepseek-ai/deepseek-v3.1` |
| `claude-3-opus` | → | `meta/llama-3.1-405b-instruct` |
| `claude-3-sonnet` | → | `meta/llama-3.1-70b-instruct` |
| `claude-3-haiku` | → | `meta/llama-3.1-8b-instruct` |
| `gemini-pro` | → | `meta/llama-3.1-70b-instruct` |

You can also use direct NIM model names like `meta/llama-3.1-70b-instruct`.

### Smart Fallback

If a model isn't mapped, the proxy intelligently selects based on the name:
- Contains "opus", "405b", "ultra" → Uses 405B model
- Contains "gpt-4", "sonnet", "70b" → Uses 70B model  
- Everything else → Uses 8B model (fast)

## ⚙️ Configuration Options

All settings via environment variables:

```bash
# Required
NIM_API_KEY=nvapi-xxxxx                    # Your NVIDIA API key

# Optional
NIM_API_BASE=https://integrate.api.nvidia.com/v1  # API endpoint
PORT=3000                                   # Server port
SHOW_REASONING=false                        # Show <think> tags
ENABLE_THINKING_MODE=false                  # Enable thinking parameter
REQUEST_TIMEOUT=120000                      # Timeout in ms (2 min)
```

### Reasoning Display

Set `SHOW_REASONING=true` to see model's reasoning process:

```
<think>
The user is asking about... I should consider...
</think>

Here's my response...
```

### Thinking Mode

Set `ENABLE_THINKING_MODE=true` to enable advanced reasoning for supported models (requires model support).

## 📡 API Endpoints

### Health Check
```bash
GET /health
```

### List Models
```bash
GET /v1/models
```

### Chat Completion
```bash
POST /v1/chat/completions
```

### Example Request

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [
      {"role": "user", "content": "Hello!"}
    ],
    "temperature": 0.7,
    "max_tokens": 2048,
    "stream": false
  }'
```

### Streaming Example

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -d '{
    "model": "gpt-4",
    "messages": [{"role": "user", "content": "Count to 10"}],
    "stream": true
  }'
```

## 🐳 Docker Deployment

### Build Image

```bash
docker build -t nvidia-nim-proxy .
```

### Run Container

```bash
docker run -d \
  -p 3000:3000 \
  -e NIM_API_KEY=your-key \
  --name nim-proxy \
  nvidia-nim-proxy
```

### Docker Compose

```bash
docker-compose up -d
```

## 🌐 Deploy to Cloud

### Railway

1. Create account at [railway.app](https://railway.app)
2. New Project → Deploy from GitHub
3. Add environment variable `NIM_API_KEY`
4. Use provided URL in Janitor AI

### Render

1. Create account at [render.com](https://render.com)
2. New Web Service → Connect repository
3. Add environment variable `NIM_API_KEY`
4. Use provided URL in Janitor AI

### Heroku

```bash
heroku create your-app-name
heroku config:set NIM_API_KEY=your-key
git push heroku main
```

## 🔧 Troubleshooting

### "NIM_API_KEY not configured"
Set the environment variable:
```bash
export NIM_API_KEY="nvapi-xxxxx"
```

### "Connection refused" from Janitor AI
- Ensure phone and computer on same WiFi
- Use actual IP address, not `localhost`
- Check firewall isn't blocking port 3000

### "Request timeout"
- Increase timeout: `export REQUEST_TIMEOUT=180000`
- Try a smaller model (8B instead of 405B)
- Check internet connection

### "Invalid model"
- Check NVIDIA API supports the model
- Try a mapped model name like `gpt-4`
- Use direct NIM model name

### Streaming not working
- Ensure `stream: true` in request
- Check client supports SSE (Server-Sent Events)
- Verify Content-Type header

## 📊 Performance Tips

1. **Use smaller models for faster responses**
   - 8B for quick replies
   - 70B for quality balance
   - 405B only when needed

2. **Adjust max_tokens**
   - Lower = faster responses
   - Default is 2048

3. **Enable caching** (if needed)
   - Add Redis for response caching
   - Reduces duplicate API calls

4. **Monitor usage**
   - Check server logs for errors
   - Track response times

## 🔒 Security Notes

⚠️ **Important Security Considerations:**

- This proxy does NOT validate client API keys
- Your NVIDIA API key is used for all requests
- Only expose on trusted networks
- Consider adding authentication for public deployment

### Adding Basic Auth (Optional)

```javascript
// Add before routes
app.use((req, res, next) => {
  const auth = req.headers.authorization;
  const token = process.env.PROXY_AUTH_TOKEN;
  
  if (token && auth !== `Bearer ${token}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});
```

## 📝 Changelog

### v2.0.0 - Improved Version
- ✅ Better error handling and validation
- ✅ Improved streaming with proper cleanup
- ✅ Environment-based configuration
- ✅ Smarter model selection logic
- ✅ Request timeout handling
- ✅ Better logging and debugging
- ✅ Graceful shutdown
- ✅ Fixed reasoning display bugs
- ✅ Added health check endpoint
- ✅ Comprehensive documentation

### v1.0.0 - Original Version
- Basic OpenAI to NIM proxy
- Reasoning display support
- Model mapping

## 📄 License

MIT License - Free to use and modify!

## 🤝 Contributing

Issues and improvements welcome! This is an improved version with focus on reliability and ease of use.

## 💡 Tips

- Use `npm run dev` during development for auto-reload
- Check `/health` endpoint to verify configuration
- Monitor console output for request tracking
- Set `NODE_ENV=production` for production deployment
- Use environment variables instead of hardcoding keys

## 🆘 Support

For NVIDIA NIM API issues:
- [NVIDIA API Documentation](https://docs.nvidia.com)
- [NVIDIA API Catalog](https://build.nvidia.com)

For proxy issues:
- Check console logs
- Verify environment variables
- Test with `/health` endpoint
- Try direct curl requests
