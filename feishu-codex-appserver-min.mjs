import * as Lark from '@larksuiteoapi/node-sdk';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

// ====== Env ======
const FEISHU_APP_ID = "";//process.env.FEISHU_APP_ID;
const FEISHU_APP_SECRET = "";//process.env.FEISHU_APP_SECRET";
const CODEX_MODEL = process.env.CODEX_MODEL; // optional
const CODEX_CWD = process.env.CODEX_CWD;     // optional
const CODEX_BIN = process.env.CODEX_BIN;     // optional
const STREAM_EVERY_MS = Number(process.env.STREAM_EVERY_MS || 1500);

if (!FEISHU_APP_ID || !FEISHU_APP_SECRET) {
  console.error('Missing FEISHU_APP_ID / FEISHU_APP_SECRET');
  process.exit(1);
}

// ====== Feishu client ======
const client = new Lark.Client({ appId: FEISHU_APP_ID, appSecret: FEISHU_APP_SECRET });
const wsClient = new Lark.WSClient({ appId: FEISHU_APP_ID, appSecret: FEISHU_APP_SECRET });

// ====== Codex App Server (stdio JSONL) ======
function resolveCodexBin() {
  return 'E:\\cloudflare\\bin\\codex.ps1';
}

const codexBin = resolveCodexBin();
const proc = spawn('pwsh', ['-File',codexBin,'app-server'], { stdio: ['pipe', 'pipe', 'pipe'] });
proc.stdin.setEncoding('utf8');
proc.stdout.setEncoding('utf8');
proc.stderr.setEncoding('utf8');
// ====== Codex stdio debug ======
proc.stdout.on('data', (chunk) => {
  const text = chunk.toString();
  console.log(`[codex stdout]\n${text}`);
});
proc.stderr.on('data', (chunk) => {
  const text = chunk.toString();
  console.error(`[codex stderr]\n${text}`);
});

proc.on('error', (err) => {
  if (err?.code === 'ENOENT') {
    console.error('Failed to start Codex CLI.');
    console.error('Install @openai/codex (global or local) or set CODEX_BIN to the codex executable path.');
  } else {
    console.error('Codex CLI error:', err);
  }
  process.exit(1);
});
const rl = readline.createInterface({ input: proc.stdout });

let nextId = 1;
const pending = new Map();

// chatId -> { threadId, activeTurnId, queue: [] }
const chatState = new Map();
// threadId -> chatId
const threadToChat = new Map();
// turnId -> chatId
const turnToChat = new Map();
// turnId -> { text, lastFlush }
const streamBuffer = new Map();
// itemId -> accumulated output (for commandExecution)
const commandOutput = new Map();

function sendRpc(message) {
  const line = `${JSON.stringify(message)}\n`;
  console.log(`[codex stdin]\n${line}`);
  proc.stdin.write(line);
}

function request(method, params, meta) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, meta });
    sendRpc({ method, id, params });
  });
}

// ====== Codex init ======
sendRpc({
  method: 'initialize',
  id: nextId++,
  params: {
    clientInfo: {
      name: 'feishu_codex_min',
      title: 'Feishu Codex Min',
      version: '0.1.0',
    },
  },
});
sendRpc({ method: 'initialized', params: {} });

// ====== Helpers ======
function getChatState(chatId) {
  if (!chatState.has(chatId)) {
    chatState.set(chatId, { threadId: null, activeTurnId: null, queue: [] });
  }
  return chatState.get(chatId);
}

async function sendText(chatId, text) {
  if (!text || !text.trim()) return;
  await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: {
      receive_id: chatId,
      msg_type: 'text',
      content: JSON.stringify({ text }),
    },
  });
}

async function ensureThread(chatId) {
  const state = getChatState(chatId);
  if (state.threadId) return state.threadId;

  const result = await request('thread/start', {
    model: CODEX_MODEL,
    cwd: CODEX_CWD,
    approvalPolicy: 'never',
    serviceName: 'feishu_codex_min',
  });

  const threadId = result?.thread?.id;
  if (!threadId) throw new Error('No thread id from app-server');
  state.threadId = threadId;
  threadToChat.set(threadId, chatId);
  return threadId;
}

async function startNextTurn(chatId) {
  const state = getChatState(chatId);
  if (state.activeTurnId) return;
  if (!state.queue.length) return;

  const text = state.queue.shift();
  const threadId = await ensureThread(chatId);

  const result = await request('turn/start', {
    threadId,
    input: [{ type: 'text', text }],
    cwd: CODEX_CWD,
    model: CODEX_MODEL,
  });

  const turnId = result?.turn?.id;
  if (turnId) {
    state.activeTurnId = turnId;
    turnToChat.set(turnId, chatId);
  }
}

function findChatId(params) {
  const turnId = params?.turnId || params?.turn?.id || params?.item?.turnId;
  if (turnId && turnToChat.has(turnId)) return turnToChat.get(turnId);
  const threadId = params?.threadId || params?.thread?.id;
  if (threadId && threadToChat.has(threadId)) return threadToChat.get(threadId);
  return null;
}

function flushStream(turnId, chatId) {
  const buf = streamBuffer.get(turnId);
  if (!buf || !buf.text) return;
  sendText(chatId, buf.text).catch(() => { });
  buf.text = '';
  buf.lastFlush = Date.now();
}

// ====== Codex event stream ======
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message || 'RPC error'));
    else resolve(msg.result);
    return;
  }

  if (!msg.method) return;
  const method = msg.method;
  const params = msg.params || {};
  const chatId = findChatId(params);

  if (!chatId) return;

  if (method === 'turn/completed') {
    const turnId = params?.turn?.id;
    if (turnId) {
      streamBuffer.set(turnId, { text: '', lastFlush: 0 });
      flushStream(turnId, chatId);
      const state = getChatState(chatId);
      if (state.activeTurnId === turnId) state.activeTurnId = null;
      startNextTurn(chatId).catch(() => { });
    }
    return;
  }

  if (method === 'item/agentMessage/delta') {
    const turnId = params?.turnId;
    const delta = params?.delta || params?.text || '';
    if (!turnId || !delta) return;

    if (!streamBuffer.has(turnId)) {
      streamBuffer.set(turnId, { text: '', lastFlush: 0 });
    }
    const buf = streamBuffer.get(turnId);
    buf.text += delta;

    //if (Date.now() - buf.lastFlush > STREAM_EVERY_MS) {
    //  flushStream(turnId, chatId);
    // }
    return;
  }

  if (method === 'item/commandExecution/outputDelta') {
    const itemId = params?.itemId;
    const delta = params?.delta || '';
    if (!itemId || !delta) return;
    commandOutput.set(itemId, (commandOutput.get(itemId) || '') + delta);
    return;
  }

  if (method === 'item/started') {
    const item = params?.item;
    if (!item?.type) return;
    if (item.type === 'commandExecution') {
      sendText(chatId, `command start: ${item.command || ''}`).catch(() => { });
    } else if (item.type === 'fileChange') {
      sendText(chatId, `file change started: ${item.changes?.length || 0} file(s)`).catch(() => { });
    }
    return;
  }

  if (method === 'item/completed') {
    const item = params?.item;
    if (!item?.type) return;

    if (item.type === 'agentMessage') {
      const text = item.text || '';
      if (text) sendText(chatId, text).catch(() => { });
      return;
    }

    if (item.type === 'commandExecution') {
      const output = commandOutput.get(item.id) || '';
      commandOutput.delete(item.id);
      const tail = output.length > 1500 ? output.slice(-1500) : output;
      sendText(chatId, `command done (exit ${item.exitCode ?? 'n/a'}):\n${tail}`).catch(() => { });
      return;
    }

    if (item.type === 'fileChange') {
      sendText(chatId, `file change ${item.status || 'done'}`).catch(() => { });
      return;
    }
  }
});

// ====== Feishu event handler ======
const dispatcher = new Lark.EventDispatcher({}).register({
  'im.message.receive_v1': async (data) => {
    console.log(data);
    const chatId = data?.message?.chat_id;
    if (!chatId) return;

    let text = '';
    try {
      text = JSON.parse(data.message.content || '{}').text || '';
    } catch {
      text = '';
    }
    if (!text.trim()) return;

    const state = getChatState(chatId);
    state.queue.push(text);
    if (!state.activeTurnId) {
      startNextTurn(chatId).catch(async (err) => {
        await sendText(chatId, `error: ${err?.message || String(err)}`);
      });
    }
  },
});

wsClient.start({ eventDispatcher: dispatcher });
console.log('Feishu Codex App Server bridge started.');
