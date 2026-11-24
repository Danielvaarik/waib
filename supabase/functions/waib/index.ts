// Waib: serverifunktsioon (Supabase Edge Function, nimi "waib").
//
// Brauser räägib ainult selle funktsiooniga. Funktsioon:
//   - annab välja käimasoleva nädala kaardid;
//   - võtab vastu 20 vastust koos Google'i sisselogimistõendiga, kontrollib tõendit,
//     arvutab kasutaja tunnusest ja komplektist räsi ning liidab vastused koondarvudele;
//   - annab välja koondstatistika (alles siis, kui vastajaid on piisavalt);
//   - laseb toimetajal komplekte lugeda ja salvestada (toimetaja võtmega).
// Google'i tunnust ega vastuseid ei salvestata ega logita.
//
// Vajalikud saladused (Edge Functions > Secrets):
//   GOOGLE_CLIENT_ID   Google'i sisselogimise kliendi ID
//   WAIB_HASH_SECRET   pikk juhuslik sõne (vähemalt 32 märki)
//   WAIB_ADMIN_TOKEN   toimetaja võti (vähemalt 16 märki)
//   WAIB_ORIGINS       lubatud aadressid komadega, nt https://waib.ee,https://www.waib.ee
//   WAIB_MIN_N         (valikuline) mitu vastajat peab olema, enne kui statistikat näidatakse; vaikimisi 10
// NB! Funktsiooni seadetes peab "Verify JWT" olema VÄLJA lülitatud, sest külastajad ei ole Supabase'i kasutajad.

import { createClient } from "npm:@supabase/supabase-js@2";

const env = (k) => Deno.env.get(k) ?? "";

function secretKey() {
  try {
    const j = JSON.parse(env("SUPABASE_SECRET_KEYS") || "{}");
    if (j && typeof j.default === "string" && j.default) return j.default;
  } catch (_) { /* vana võtmekuju */ }
  return env("SUPABASE_SERVICE_ROLE_KEY");
}

const db = createClient(env("SUPABASE_URL"), secretKey(), {
  auth: { persistSession: false, autoRefreshToken: false },
});

const MIN_N = Math.max(2, parseInt(env("WAIB_MIN_N") || "10", 10) || 10);
const ORIGINS = env("WAIB_ORIGINS").split(",").map((s) => s.trim().replace(/\/$/, "")).filter(Boolean);
const GOOGLE_JWKS = "https://www.googleapis.com/oauth2/v3/certs";
const GOOGLE_ISS = ["https://accounts.google.com", "accounts.google.com"];
const enc = new TextEncoder();

function cors(req) {
  const o = req.headers.get("origin") || "";
  const allow = ORIGINS.length === 0 ? "*" : (ORIGINS.includes(o) ? o : ORIGINS[0]);
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "content-type, authorization, apikey, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin",
  };
}

function json(body, status, headers) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}

function b64urlBytes(s) {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}
const b64urlJson = (s) => JSON.parse(new TextDecoder().decode(b64urlBytes(s)));

let jwksCache = { at: 0, keys: [] };
async function googleKeys(force) {
  if (!force && jwksCache.keys.length && Date.now() - jwksCache.at < 3600_000) return jwksCache.keys;
  const r = await fetch(GOOGLE_JWKS);
  if (!r.ok) throw new Error("jwks");
  const j = await r.json();
  jwksCache = { at: Date.now(), keys: Array.isArray(j.keys) ? j.keys : [] };
  return jwksCache.keys;
}

// Kontrollib Google'i ID-tõendit ja tagastab kasutaja anonüümse tunnuse (sub). Vea korral null.
async function googleSub(token, clientId) {
  try {
    if (typeof token !== "string" || token.length > 4096) return null;
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const head = b64urlJson(parts[0]);
    const pay = b64urlJson(parts[1]);
    if (head.alg !== "RS256" || !head.kid) return null;

    let jwk = (await googleKeys(false)).find((k) => k.kid === head.kid);
    if (!jwk) jwk = (await googleKeys(true)).find((k) => k.kid === head.kid);
    if (!jwk) return null;

    const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
    const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64urlBytes(parts[2]), enc.encode(parts[0] + "." + parts[1]));
    if (!ok) return null;

    const now = Math.floor(Date.now() / 1000);
    if (!GOOGLE_ISS.includes(pay.iss)) return null;
    if (pay.aud !== clientId) return null;
    if (typeof pay.exp !== "number" || pay.exp < now - 60) return null;
    if (typeof pay.sub !== "string" || !pay.sub) return null;
    return pay.sub;
  } catch (_) {
    return null;
  }
}

async function hmacHex(secret, msg) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(msg)));
  return Array.from(sig).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function sameSecret(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || !a || !b) return false;
  const [x, y] = await Promise.all([hmacHex("waib-cmp", a), hmacHex("waib-cmp", b)]);
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return d === 0;
}

async function rpc(fn, args) {
  const { data, error } = await db.rpc(fn, args ?? {});
  if (error) throw new Error(fn + ": " + error.message);
  return data;
}

const isId = (s) => typeof s === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(s);

const handler = async (req) => {
  const h = cors(req);
  if (req.method === "OPTIONS") return new Response("ok", { headers: h });
  if (req.method !== "POST") return json({ error: "method" }, 405, h);

  let b;
  try { b = await req.json(); } catch (_) { return json({ error: "bad_json" }, 400, h); }
  if (!b || typeof b !== "object") return json({ error: "bad_json" }, 400, h);

  try {
    switch (b.action) {
      case "set": {
        const set = await rpc("waib_current");
        return json({ set: set ?? null }, 200, h);
      }

      case "stats": {
        if (!isId(b.set_id)) return json({ error: "bad_request" }, 400, h);
        return json({ stats: await rpc("waib_stats", { p_set: b.set_id, p_min: MIN_N }) }, 200, h);
      }

      case "submit": {
        const clientId = env("GOOGLE_CLIENT_ID");
        const hashSecret = env("WAIB_HASH_SECRET");
        if (!clientId || hashSecret.length < 32) return json({ error: "not_configured" }, 500, h);
        if (!isId(b.set_id) || !b.answers || typeof b.answers !== "object" || Array.isArray(b.answers)) {
          return json({ error: "bad_request" }, 400, h);
        }
        const sub = await googleSub(b.id_token, clientId);
        if (!sub) return json({ error: "bad_token" }, 401, h);

        const hash = await hmacHex(hashSecret, b.set_id + ":" + sub);
        const status = await rpc("waib_submit", { p_set: b.set_id, p_hash: hash, p_answers: b.answers });
        if (status === "bad") return json({ error: "bad_request" }, 400, h);
        if (status === "closed") return json({ status }, 200, h);
        const stats = await rpc("waib_stats", { p_set: b.set_id, p_min: MIN_N });
        return json({ status, stats }, 200, h);
      }

      case "admin_list":
      case "admin_get":
      case "admin_save": {
        const adminToken = env("WAIB_ADMIN_TOKEN");
        if (adminToken.length < 16) return json({ error: "not_configured" }, 500, h);
        if (!(await sameSecret(b.admin_token, adminToken))) return json({ error: "forbidden" }, 403, h);

        if (b.action === "admin_list") return json({ sets: await rpc("waib_admin_list") }, 200, h);
        if (!isId(b.set_id)) return json({ error: "bad_request" }, 400, h);
        if (b.action === "admin_get") return json({ set: (await rpc("waib_admin_get", { p_set: b.set_id })) ?? null }, 200, h);

        const status = await rpc("waib_admin_save", {
          p_set: b.set_id,
          p_label: typeof b.label === "string" ? b.label : "",
          p_cards: Array.isArray(b.cards) ? b.cards : null,
          p_published: b.published === true,
          p_opens_at: typeof b.opens_at === "string" && b.opens_at ? b.opens_at : null,
        });
        return json({ status }, status === "saved" ? 200 : 400, h);
      }

      default:
        return json({ error: "unknown_action" }, 400, h);
    }
  } catch (e) {
    // Logisse läheb ainult vea kirjeldus, mitte päringu sisu.
    console.error("waib:", e && e.message ? e.message : "viga");
    return json({ error: "server" }, 500, h);
  }
};

Deno.serve(handler);
