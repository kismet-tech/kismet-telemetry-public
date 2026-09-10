#!/usr/bin/env node
// Live smoke for the core: the reference adapter against the REAL authority and
// relay, with a real tracking key read from an env file (never from argv, never
// printed). Drives the six visitor shapes and reports what the wire said.
//
//   node scripts/smoke-live.mjs [--adapter reference|next|node] --env ~/.config/kismet/telemetry-lab.env [--host telemetry-smoke.local]
//
// --adapter next drives @kismet-tech/telemetry-next's middleware with a real
// NextRequest and renders the page from the seed headers the way the layout does.
// --adapter node mounts @kismet-tech/telemetry-node in a real Express app on a
// local HTTP server and forwards each request to it behind forwarded headers.
// Both packages must be built (npm run build in their directories).
//
// The env file needs KISMET_TRACKING_KEY and KISMET_COLLECTION_SLUG. Rows land in
// that collection under the smoke host, so use a lab collection when you can.
// Afterwards, verify at ingest (read-only SQL over mgr_insight_v_content_events
// filtered by serving_domain = the smoke host).

import { readFileSync } from "node:fs";
import { createReferenceAdapter } from "../packages/telemetry/src/conformance/reference-adapter.js";
import { KID_SID_MINT_RE } from "../packages/telemetry/src/resolve.js";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const envPath = opt("--env", null);
if (!envPath) {
  console.error("Pass --env with an explicit lab collection configuration; no default credentials are loaded.");
  process.exit(2);
}
const ADAPTER = opt("--adapter", "reference");
const HOST = opt(
  "--host",
  ADAPTER === "reference"
    ? "telemetry-smoke.local"
    : `telemetry-smoke-${ADAPTER}.local`,
);

const env = Object.fromEntries(
  readFileSync(envPath, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      return [
        l.slice(0, i).trim(),
        l
          .slice(i + 1)
          .trim()
          .replace(/^["']|["']$/g, ""),
      ];
    }),
);
const trackingKey = env.KISMET_TRACKING_KEY;
const collectionSlug = env.KISMET_COLLECTION_SLUG;
if (!trackingKey || !collectionSlug) {
  console.error(
    `env file ${envPath} needs KISMET_TRACKING_KEY and KISMET_COLLECTION_SLUG`,
  );
  process.exit(2);
}
console.log(
  `adapter: ${ADAPTER}   collection: ${collectionSlug}   key: ${trackingKey.slice(0, 4)}…(${trackingKey.length} chars)   host: ${HOST}`,
);

// Record every outbound call the adapter makes: URL, status, and the JSON body of
// the answer (never the request headers, which carry the key).
/** @type {{ url: string, status: number | string, ms: number, reply: unknown, sent: any }[]} */
const wire = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (String(url).startsWith("http://127.0.0.1")) return realFetch(url, init); // the node driver's own hop
  const t0 = Date.now();
  let sent = null;
  try {
    sent = init && typeof init.body === "string" ? JSON.parse(init.body) : null;
  } catch {}
  try {
    const res = await realFetch(url, init);
    let reply = null;
    try {
      reply = await res.clone().json();
    } catch {}
    wire.push({
      url: String(url),
      status: res.status,
      ms: Date.now() - t0,
      reply,
      sent,
    });
    return res;
  } catch (e) {
    wire.push({
      url: String(url),
      status: `ERR ${e instanceof Error ? e.message : e}`,
      ms: Date.now() - t0,
      reply: null,
      sent,
    });
    throw e;
  }
};

const adapterConfig = {
  collectionSlug,
  trackingKey,
  // Country default only: the smoke sends cf-ipcountry explicitly per case.
  consent: null,
  profile: {
    property: {
      pattern: /^\/stays\/[^/]+\/([^/]+)\/?$/,
      as: "externalListingId",
    },
    searchPaths: ["/stays"],
    intent: { path: "/stays/checkout" },
  },
};

const seedHtml = (kid, suppressed) => {
  const seed = suppressed
    ? "<script>window.Kismet=window.Kismet||{};window.Kismet._sidSuppressed=1;</script>"
    : kid
      ? `<script>window.Kismet=window.Kismet||{};window.Kismet._kidSid="${kid}";</script>`
      : "";
  return `<!doctype html><html><head>${seed}</head><body></body></html>`;
};

async function makeAdapter(kind) {
  if (kind === "reference") {
    const a = createReferenceAdapter(adapterConfig);
    return { handle: a.handle, flush: a.flush, close: async () => {} };
  }
  if (kind === "next") {
    const { createKismetMiddleware } =
      await import("../packages/telemetry-next/dist/index.js");
    const { NextRequest } =
      await import("../packages/telemetry-next/node_modules/next/server.js");
    const middleware = createKismetMiddleware(adapterConfig);
    let pending = [];
    const event = {
      waitUntil: (p) => pending.push(Promise.resolve(p).catch(() => undefined)),
    };
    return {
      handle: async (request) => {
        const req = new NextRequest(request.url, {
          method: request.method,
          headers: request.headers,
        });
        const res = await middleware(req, event);
        const kid = res.headers.get("x-middleware-request-x-kismet-kid-sid");
        const sup =
          res.headers.get("x-middleware-request-x-kismet-sid-suppressed") ===
          "1";
        return new Response(seedHtml(kid, sup), {
          status: 200,
          headers: res.headers,
        });
      },
      flush: async () => {
        const p = pending;
        pending = [];
        await Promise.allSettled(p);
      },
      close: async () => {},
    };
  }
  if (kind === "node") {
    const { kismetTelemetry } =
      await import("../packages/telemetry-node/dist/esm/index.js");
    const { default: express } =
      await import("../packages/telemetry-node/node_modules/express/index.js");
    const { createServer } = await import("node:http");
    const middleware = kismetTelemetry(adapterConfig);
    const app = express();
    app.use(middleware);
    app.use((req, res) => {
      const st = res.locals.kismet;
      res
        .type("html")
        .send(st ? seedHtml(st.kidSid, st.suppressed) : seedHtml(null, false));
    });
    const server = createServer(app);
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const port = server.address().port;
    return {
      handle: async (request) => {
        const u = new URL(request.url);
        return realFetch(`http://127.0.0.1:${port}${u.pathname}${u.search}`, {
          method: request.method,
          headers: request.headers,
          redirect: "manual",
        });
      },
      flush: () => middleware.flush(),
      close: () => new Promise((r) => server.close(r)),
    };
  }
  throw new Error(`unknown adapter ${kind}`);
}

const adapter = await makeAdapter(ADAPTER);

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36";
const req = (path, headers = {}) =>
  new Request(`https://${HOST}${path}`, {
    headers: {
      "user-agent": UA,
      accept: "text/html,*/*;q=0.8",
      "accept-language": "en-US,en;q=0.9",
      "x-forwarded-proto": "https",
      "x-forwarded-host": HOST,
      "x-forwarded-for": "203.0.113.7",
      referer: "https://chatgpt.com/",
      "cf-ipcountry": "US",
      ...headers,
    },
  });
const cookieOf = (res) => {
  const c = (res.headers.getSetCookie?.() || []).find((x) =>
    x.startsWith("_kid_sid="),
  );
  return c ? c.split(";")[0].slice("_kid_sid=".length) : null;
};

const results = [];
async function step(name, request, expect) {
  const before = wire.length;
  const t0 = Date.now();
  const res = await adapter.handle(request);
  const dt = Date.now() - t0;
  await adapter.flush();
  const calls = wire.slice(before);
  const kid = cookieOf(res);
  const tier = res.headers.get("x-kismet-anchor-tier");
  const body = await res.text();
  const line = expect({ res, kid, tier, body, calls, dt });
  results.push({ name, ok: line.ok, detail: line.detail, dt });
  console.log(
    `${line.ok ? "PASS" : "FAIL"}  ${name.padEnd(22)} ${dt}ms  ${line.detail}`,
  );
  for (const c of calls) {
    const path = new URL(c.url).pathname;
    const r = c.reply && typeof c.reply === "object" ? c.reply : {};
    const summary = path.includes("resolve-anchor")
      ? `ok=${r.ok} kid_sid=${r.kid_sid ?? "-"} tier=${r.tier ?? "-"} isNew=${r.isNew ?? "-"}${r.error ? " error=" + r.error : ""}`
      : `success=${r.success ?? "-"}${r.error ? " error=" + r.error : ""}`;
    console.log(`        → ${path}  ${c.status}  ${c.ms}ms  ${summary}`);
  }
  return { kid, calls };
}

console.log(
  "\n1. cold human (mint locally, reconcile with the authority after the response)",
);
const cold = await step(
  "cold-human",
  req("/about?gclid=SMOKEgclid123"),
  ({ kid, tier, body, calls, dt }) => {
    const rc = calls.find((c) => c.url.includes("resolve-anchor"));
    const ev = calls.find((c) => c.url.includes("/api/track"));
    const ok =
      !!kid &&
      KID_SID_MINT_RE.test(kid) &&
      tier === "minted" &&
      body.includes(`_kidSid="${kid}"`) &&
      !!rc &&
      rc.status === 200 &&
      rc.reply?.ok === true &&
      rc.reply?.kid_sid === kid &&
      !!ev &&
      ev.status === 200 &&
      dt < 500;
    return {
      ok,
      detail: `kid=${kid} tier=${tier} authority adopted=${rc?.reply?.kid_sid === kid} event=${ev?.status}`,
    };
  },
);

console.log("\n2. warm human (cookie adopted, no authority call)");
await step(
  "warm-human",
  req("/stays", { cookie: `_kid_sid=${cold.kid}` }),
  ({ kid, tier, calls }) => {
    const rc = calls.find((c) => c.url.includes("resolve-anchor"));
    const ev = calls.find((c) => c.url.includes("/api/track"));
    const ok =
      kid === null &&
      tier === "cookie" &&
      !rc &&
      ev?.status === 200 &&
      ev.sent?.clientSessionId === cold.kid;
    return {
      ok,
      detail: `tier=${tier} authority-calls=${rc ? 1 : 0} event.session=${ev?.sent?.clientSessionId}`,
    };
  },
);

console.log("\n3. threaded id (adopted, authority told to back-stitch)");
await step(
  "threaded",
  req(`/about?kid_sid=${cold.kid}`),
  ({ kid, tier, calls }) => {
    const rc = calls.find((c) => c.url.includes("resolve-anchor"));
    const ok =
      kid === cold.kid &&
      tier === "threaded" &&
      rc?.status === 200 &&
      rc.sent?.threadedKidSid === cold.kid;
    return {
      ok,
      detail: `tier=${tier} sent.threadedKidSid=${rc?.sent?.threadedKidSid} authority=${rc?.status}`,
    };
  },
);

console.log("\n4. bot (no cookie, no authority, event with null session)");
await step(
  "bot-gptbot",
  req("/stays/porthleven/harbour-house", {
    "user-agent":
      "Mozilla/5.0 AppleWebKit/537.36; compatible; GPTBot/1.2; +https://openai.com/gptbot",
  }),
  ({ kid, tier, body, calls }) => {
    const rc = calls.find((c) => c.url.includes("resolve-anchor"));
    const ev = calls.find((c) => c.url.includes("/api/track"));
    const ok =
      kid === null &&
      tier === "suppressed" &&
      !rc &&
      body.includes("_sidSuppressed=1") &&
      ev?.status === 200 &&
      ev.sent?.clientSessionId === null &&
      ev.sent?.isBot === true &&
      ev.sent?.actionType === "property_view";
    return {
      ok,
      detail: `tier=${tier} event.session=${ev?.sent?.clientSessionId} isBot=${ev?.sent?.isBot} actionType=${ev?.sent?.actionType} externalListingId=${ev?.sent?.externalListingId}`,
    };
  },
);

console.log("\n5. agent surface (fetch, no identity work)");
await step(
  "agent-llms-txt",
  req("/llms.txt", { "user-agent": "ClaudeBot/1.0" }),
  ({ kid, calls }) => {
    const rc = calls.find((c) => c.url.includes("resolve-anchor"));
    const ev = calls.find((c) => c.url.includes("/api/track"));
    const ok =
      kid === null &&
      !rc &&
      ev?.status === 200 &&
      ev.sent?.actionType === "fetch" &&
      ev.sent?.clientSessionId === null;
    return {
      ok,
      detail: `event=${ev?.status} actionType=${ev?.sent?.actionType} session=${ev?.sent?.clientSessionId}`,
    };
  },
);

console.log(
  "\n6. consent-denied human (GB, no hook): no session, event still recorded",
);
await step(
  "gb-no-consent",
  req("/about", { "cf-ipcountry": "GB" }),
  ({ kid, tier, body, calls }) => {
    const rc = calls.find((c) => c.url.includes("resolve-anchor"));
    const ev = calls.find((c) => c.url.includes("/api/track"));
    const ok =
      kid === null &&
      tier === "suppressed" &&
      !rc &&
      body.includes("_sidSuppressed=1") &&
      ev?.status === 200 &&
      ev.sent?.clientSessionId === null &&
      ev.sent?.isBot === false;
    return {
      ok,
      detail: `tier=${tier} event=${ev?.status} session=${ev?.sent?.clientSessionId} isBot=${ev?.sent?.isBot}`,
    };
  },
);

console.log("\n7. intent path with the stay (cta_click)");
await step(
  "intent-checkout",
  req("/stays/checkout?checkin=2026-10-03&checkout=2026-10-06&guests=2", {
    cookie: `_kid_sid=${cold.kid}`,
  }),
  ({ calls }) => {
    const ev = calls.find((c) => c.url.includes("/api/track"));
    const ok =
      ev?.status === 200 &&
      ev.sent?.actionType === "cta_click" &&
      ev.sent?.stayCheckIn === "2026-10-03" &&
      ev.sent?.guestCount === 2;
    return {
      ok,
      detail: `event=${ev?.status} actionType=${ev?.sent?.actionType} stay=${ev?.sent?.stayCheckIn}..${ev?.sent?.stayCheckOut} guests=${ev?.sent?.guestCount}`,
    };
  },
);

await adapter.close();
const failed = results.filter((r) => !r.ok);
console.log(
  `\n${failed.length === 0 ? "ALL PASS" : failed.length + " FAILED"}  (${results.length} steps)  smoke session: ${cold.kid}`,
);
console.log(
  `verify at ingest: SELECT action_type, resource_class, is_bot, bot_name, classification, client_session_id, page_url FROM mgr_insight_v_content_events WHERE serving_domain = '${HOST}' ORDER BY timestamp DESC;`,
);
process.exit(failed.length === 0 ? 0 : 1);
