// Reports the visitor's country as Cloudflare sees it, so the analytics gate can
// appear only where consent is actually required.
//
// The country comes from Cloudflare's own request metadata (request.cf.country),
// so this adds no third-party lookup and sends nothing about the visitor anywhere:
// the answer is computed at the edge from the connection itself.
export async function onRequestGet({ request }) {
  const country = (request.cf && request.cf.country) || "XX";
  return new Response(JSON.stringify({ country }), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

export async function onRequest(context) {
  if (context.request.method === "GET" || context.request.method === "HEAD") {
    return onRequestGet(context);
  }
  return new Response("Method not allowed", { status: 405, headers: { allow: "GET, HEAD" } });
}
