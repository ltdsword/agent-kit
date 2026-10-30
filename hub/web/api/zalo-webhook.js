// Zalo webhook relay (Vercel Function).
// Zalo's servers call webhooks with an old "Java/1.8" User-Agent, which Cloudflare's Browser Integrity
// Check rejects (error 1010) on *.workers.dev before the request reaches the proxy. Vercel accepts it,
// so Zalo posts here and this forwards the body and the secret header unchanged to the proxy, which
// still verifies X-Bot-Api-Secret-Token. Set HUB_PROXY_URL on the deployment (e.g. https://agent-hub.example.workers.dev).
export async function POST(request) {
  const proxy = (process.env.HUB_PROXY_URL ?? '').replace(/\/+$/, '');
  if (!proxy) return new Response('relay not configured', { status: 503 });
  const response = await fetch(`${proxy}/api/v1/zalo/webhook`, {
    method: 'POST',
    headers: {
      'content-type': request.headers.get('content-type') ?? 'application/json',
      'x-bot-api-secret-token': request.headers.get('x-bot-api-secret-token') ?? '',
      'user-agent': 'agent-hub-zalo-relay',
    },
    body: await request.arrayBuffer(),
  });
  return new Response(await response.arrayBuffer(), {
    status: response.status,
    headers: { 'content-type': response.headers.get('content-type') ?? 'text/plain' },
  });
}
