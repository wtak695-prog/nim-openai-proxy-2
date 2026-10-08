const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

const PORT = process.env.PORT || 8080;
const NIM_API_KEY = process.env.NIM_API_KEY;   // your NVIDIA key
const PROXY_KEY = process.env.PROXY_KEY || ''; // optional: your own private password
const NIM_BASE = 'https://integrate.api.nvidia.com/v1';

const DEFAULT_MODEL = 'moonshotai/kimi-k3';
const MODEL_MAP = {
  'gpt-3.5-turbo': 'meta/llama-3.1-8b-instruct',
  'gpt-4':         'z-ai/glm-5.3',
  'gpt-4-turbo':   'deepseek-ai/deepseek-v4-flash-0731',
  'gpt-4o':        'moonshotai/kimi-k3'
};

function checkAuth(req, res) {
  if (!PROXY_KEY) return true;
  const auth = req.headers.authorization || '';
  if (auth === `Bearer ${PROXY_KEY}`) return true;
  res.status(401).json({ error: { message: 'Invalid proxy key' } });
  return false;
}

app.get('/health', (req, res) => res.json({ ok: true }));

app.get('/v1/models', (req, res) => {
  res.json({
    object: 'list',
    data: Object.keys(MODEL_MAP).map(id => ({ id, object: 'model', owned_by: 'nim-proxy' }))
  });
});

app.post('/v1/chat/completions', async (req, res) => {
    const startedAt = Date.now();
  if (!checkAuth(req, res)) return;
  if (!NIM_API_KEY) return res.status(500).json({ error: { message: 'NIM_API_KEY not set' } });

  const body = req.body || {};
  const nimModel = MODEL_MAP[body.model] || DEFAULT_MODEL;
  console.log(`[request] JanitorAI asked for "${body.model}" -> using NIM model "${nimModel}"`);
  const isStream = !!body.stream;

  const payload = {
    model: nimModel,
    messages: body.messages,
    temperature: body.temperature ?? 1,
    top_p: body.top_p ?? 0.95,
    max_tokens: body.max_tokens ?? 128000,
    stream: isStream
  };

  try {
    const nimRes = await fetch(`${NIM_BASE}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${NIM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (isStream) {
      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache');
      res.setHeader('Connection', 'keep-alive');
      nimRes.body.pipe(res);
      return;
    }

    const data = await nimRes.json();
    console.log(`[timing] NIM responded in ${Date.now() - startedAt}ms`);
    res.status(nimRes.status).json(data);
  } catch (err) {
    res.status(500).json({ error: { message: err.message } });
  }
});

app.use((req, res) => res.status(404).json({ error: { message: `${req.path} not found` } }));

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
