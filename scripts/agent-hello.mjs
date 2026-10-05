// Smoke test for the agent's LLM env: sends "hello" through src/lib/agent/llm.ts.
// Run: npm run agent:hello
import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.PROJ_ROOT ??= resolvePath(HERE, '..');
register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);

const { llm, MODEL } = await import('@/lib/agent/llm');

const started = Date.now();
const res = await llm.chat.completions.create({
  model: MODEL,
  messages: [{ role: 'user', content: 'hello' }],
  temperature: 0.2,
});

console.log({
  baseURL: llm.baseURL,
  model: MODEL,
  latencyMs: Date.now() - started,
  reply: res.choices[0]?.message?.content,
  usage: res.usage,
});
