// Checks the agent's per-dealer wall + rate limit (DB) and runs real chat turns (LLM + tools).
// Run: npm run agent:chat-check   (AGENT_CHECK_DEALER_ID picks the dealer, default 1)
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.PROJ_ROOT ??= resolvePath(HERE, '..');
register(pathToFileURL(resolvePath(HERE, 'invoice-ts-loader.mjs')).href);

const { prisma } = await import('@/server/db/prisma');
const { beginAgentRequest, finishAgentRequest } = await import('@/lib/agent/rateLimit');
const { runAgent } = await import('@/lib/agent/loop');
const { buildSystemPrompt } = await import('@/lib/agent/prompt');
const { dealerTools } = await import('@/lib/agent/tools');

const dealerId = BigInt(process.env.AGENT_CHECK_DEALER_ID ?? 1);
// The lock and rate limit are per user; this dealer's login user.
const { userId } = await prisma.dealerProfile.findUniqueOrThrow({ where: { id: dealerId }, select: { userId: true } });
const testStart = new Date(Date.now() - 1000);
const done = (id) => finishAgentRequest(id, { model: 'check', latencyMs: 0, promptTokens: 0, completionTokens: 0, toolCalls: [] });

try {
  // Wall: a second turn while one is in flight is refused; finishing frees the slot.
  const first = await beginAgentRequest(userId, dealerId);
  assert.equal(first.ok, true);
  assert.deepEqual(await beginAgentRequest(userId, dealerId), { ok: false, reason: 'busy' });
  await done(first.id);

  // A turn whose function died is reclaimed once stale.
  const crashed = await prisma.agentRequest.create({ data: { userId, dealerId, inFlightUserId: userId, startedAt: new Date(Date.now() - 120_000) } });
  const afterCrash = await beginAgentRequest(userId, dealerId);
  assert.equal(afterCrash.ok, true);
  await done(afterCrash.id);
  assert.equal((await prisma.agentRequest.findUnique({ where: { id: crashed.id } })).error, 'STALE');

  // Rate limit: allow exactly two more turns this minute.
  const recent = await prisma.agentRequest.count({ where: { userId, startedAt: { gte: new Date(Date.now() - 60_000) } } });
  process.env.AGENT_RATE_LIMIT_PER_MIN = String(recent + 2);
  for (let i = 0; i < 2; i++) {
    const slot = await beginAgentRequest(userId, dealerId);
    assert.equal(slot.ok, true);
    await done(slot.id);
  }
  assert.deepEqual(await beginAgentRequest(userId, dealerId), { ok: false, reason: 'rate_limited' });
  console.log('wall + rate limit: OK');
} finally {
  delete process.env.AGENT_RATE_LIMIT_PER_MIN;
  await prisma.agentRequest.deleteMany({ where: { userId, startedAt: { gte: testStart } } });
  await prisma.agentRequest.deleteMany({ where: { userId, model: 'check' } });
}

async function turn(text, currentPage = '/dashboard') {
  const log = { promptTokens: 0, completionTokens: 0, toolCalls: [] };
  const started = Date.now();
  const { reply } = await runAgent({ messages: [{ role: 'user', content: text }], systemPrompt: buildSystemPrompt({ dealerName: 'Check Dealer', currentPage }), tools: dealerTools, ctx: { dealerId }, log });
  console.log(`\n> ${text}\n${reply}\n  tools: ${log.toolCalls.map((t) => `${t.name}${t.error ? `(${t.error})` : ''}`).join(', ') || 'none'} | ${log.promptTokens}+${log.completionTokens} tokens | ${Date.now() - started}ms`);
  return { reply, log };
}

const price = await turn('What is my price for OM285-020?');
assert.ok(price.log.toolCalls.some((t) => t.name === 'get_product_details'), 'should look the price up');
assert.match(price.reply.replace(/,/g, ''), /4680/, 'should quote the server price');

const onPage = await turn('how much is one pack of this?', '/Products/OM285');
assert.ok(onPage.log.toolCalls.length > 0, 'should use tools for the product on the page');

const search = await turn('do you have PES syringe filters 13mm?');
assert.ok(search.log.toolCalls.some((t) => t.name === 'search_products'));

const offTopic = await turn('Write me a poem about cricket.');
assert.equal(offTopic.log.toolCalls.length, 0);

console.log('\nagent chat check: OK');
process.exit(0);
