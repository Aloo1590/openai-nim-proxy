// test.js - Simple test script for the NVIDIA NIM proxy
const axios = require('axios');

const BASE_URL = process.env.TEST_URL || 'http://localhost:3000';

async function runTests() {
  console.log('🧪 Testing NVIDIA NIM Proxy\n');
  console.log(`Base URL: ${BASE_URL}\n`);
  
  let passed = 0;
  let failed = 0;
  
  // Test 1: Health Check
  try {
    console.log('✓ Test 1: Health Check');
    const response = await axios.get(`${BASE_URL}/health`);
    console.log(`  Status: ${response.status}`);
    console.log(`  API Configured: ${response.data.api_configured}`);
    console.log(`  Reasoning: ${response.data.reasoning_display}`);
    console.log(`  Thinking: ${response.data.thinking_mode}\n`);
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}\n`);
    failed++;
  }
  
  // Test 2: List Models
  try {
    console.log('✓ Test 2: List Models');
    const response = await axios.get(`${BASE_URL}/v1/models`);
    console.log(`  Status: ${response.status}`);
    console.log(`  Models found: ${response.data.data.length}`);
    console.log(`  Sample: ${response.data.data.slice(0, 3).map(m => m.id).join(', ')}\n`);
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}\n`);
    failed++;
  }
  
  // Test 3: Get Specific Model
  try {
    console.log('✓ Test 3: Get Model Info');
    const response = await axios.get(`${BASE_URL}/v1/models/gpt-4`);
    console.log(`  Status: ${response.status}`);
    console.log(`  Model ID: ${response.data.id}\n`);
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}\n`);
    failed++;
  }
  
  // Test 4: Chat Completion (Non-streaming)
  try {
    console.log('✓ Test 4: Chat Completion (non-streaming)');
    const response = await axios.post(`${BASE_URL}/v1/chat/completions`, {
      model: 'gpt-3.5-turbo',
      messages: [
        { role: 'user', content: 'Say "Hello World" and nothing else.' }
      ],
      max_tokens: 50,
      temperature: 0.1
    });
    console.log(`  Status: ${response.status}`);
    console.log(`  Model: ${response.data.model}`);
    console.log(`  Response: ${response.data.choices[0].message.content.slice(0, 100)}`);
    console.log(`  Tokens: ${response.data.usage.total_tokens}\n`);
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}`);
    if (error.response?.data) {
      console.log(`  Error: ${JSON.stringify(error.response.data)}\n`);
    } else {
      console.log();
    }
    failed++;
  }
  
  // Test 5: Chat Completion (Streaming)
  try {
    console.log('✓ Test 5: Chat Completion (streaming)');
    const response = await axios.post(
      `${BASE_URL}/v1/chat/completions`,
      {
        model: 'gpt-3.5-turbo',
        messages: [
          { role: 'user', content: 'Count from 1 to 3.' }
        ],
        max_tokens: 50,
        stream: true
      },
      {
        responseType: 'stream'
      }
    );
    
    let chunks = 0;
    let content = '';
    
    await new Promise((resolve, reject) => {
      response.data.on('data', (chunk) => {
        chunks++;
        const lines = chunk.toString().split('\n');
        lines.forEach(line => {
          if (line.startsWith('data: ') && !line.includes('[DONE]')) {
            try {
              const data = JSON.parse(line.slice(6));
              if (data.choices?.[0]?.delta?.content) {
                content += data.choices[0].delta.content;
              }
            } catch (e) {}
          }
        });
      });
      response.data.on('end', resolve);
      response.data.on('error', reject);
    });
    
    console.log(`  Status: ${response.status}`);
    console.log(`  Chunks received: ${chunks}`);
    console.log(`  Content: ${content.slice(0, 100)}\n`);
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}\n`);
    failed++;
  }
  
  // Test 6: Invalid Model Fallback
  try {
    console.log('✓ Test 6: Invalid Model Fallback');
    const response = await axios.post(`${BASE_URL}/v1/chat/completions`, {
      model: 'some-unknown-model-12345',
      messages: [
        { role: 'user', content: 'Hi' }
      ],
      max_tokens: 20
    });
    console.log(`  Status: ${response.status}`);
    console.log(`  Fallback worked: Request succeeded\n`);
    passed++;
  } catch (error) {
    console.log(`  ✗ Failed: ${error.message}\n`);
    failed++;
  }
  
  // Summary
  console.log('═══════════════════════════════════════');
  console.log(`Tests Passed: ${passed}/${passed + failed}`);
  console.log(`Tests Failed: ${failed}/${passed + failed}`);
  
  if (failed === 0) {
    console.log('\n✅ All tests passed! Proxy is working correctly.');
  } else {
    console.log('\n⚠️  Some tests failed. Check your configuration.');
    console.log('   - Make sure NIM_API_KEY is set');
    console.log('   - Verify server is running');
    console.log('   - Check NVIDIA API status');
  }
  
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runTests().catch(error => {
  console.error('Test suite error:', error.message);
  process.exit(1);
});
