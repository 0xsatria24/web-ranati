/* server.js — backend RANATI (PostgreSQL).
   Setup:  1) buat db-config.json dari db-config.example.json (isi password)
           2) node setup-db.js   (buat database 'ranati' bila belum ada)
           3) node server.js     -> http://localhost:3000
   Statis  : index.html, admin.html, assets, dll.
   Auth    : POST /api/register, /api/login, /api/logout, GET /api/me
   Konten  : GET /api/content (publik), POST /api/content (token)
   Koleksi : GET /api/collections/:name  |  POST (token)  |  PUT/DELETE /:id (token)
   Stats   : GET /api/stats (token)      Upload: POST /api/upload (token) -> /assets
*/
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");

const ROOT = __dirname;
const PORT = process.env.PORT || 3000;
const ASSET_DIR = path.join(ROOT, "assets");
const ALLOWED_COLLECTIONS = ["zones", "news"];
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // token berlaku 30 hari

/* Rate limit sederhana (in-memory per instance; defense-in-depth, bukan jaminan
   mutlak karena serverless bisa banyak instance). */
const rlHits = new Map();
function rateLimited(key, max, windowMs) {
  const now = Date.now();
  const arr = (rlHits.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  rlHits.set(key, arr);
  if (rlHits.size > 5000) rlHits.clear();
  return arr.length > max;
}
function clientIp(req) {
  return String(req.headers["x-forwarded-for"] || "").split(",")[0].trim() ||
    (req.socket && req.socket.remoteAddress) || "?";
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".mp4": "video/mp4", ".webm": "video/webm", ".ogg": "video/ogg",
  ".pdf": "application/pdf",
};

/* ---------- util ---------- */
function send(res, code, body, type) {
  res.writeHead(code, { "Content-Type": type || "text/plain; charset=utf-8" });
  res.end(body);
}
function json(res, code, obj) { send(res, code, JSON.stringify(obj), MIME[".json"]); }
function readBody(req, cb) {
  let data = "";
  req.on("data", (c) => { data += c; if (data.length > 60 * 1024 * 1024) req.destroy(); });
  req.on("end", () => cb(data));
}
function readJson(req, cb) { readBody(req, (b) => { try { cb(null, JSON.parse(b)); } catch (e) { cb(e); } }); }

/* ---------- auth helpers ---------- */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  return { salt, derived: crypto.scryptSync(password, salt, 64).toString("hex") };
}
function verifyPassword(password, salt, derived) {
  const h = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(h), Buffer.from(derived));
}
function newToken() { return crypto.randomBytes(24).toString("hex"); }
function newId() { return crypto.randomBytes(8).toString("hex"); }

async function userFromToken(req) {
  const auth = req.headers["authorization"] || "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  const { rows } = await db.query("SELECT email, created_at FROM tokens WHERE token = $1", [token]);
  if (!rows.length) return null;
  // Token kedaluwarsa -> hapus & tolak.
  if (Date.now() - Number(rows[0].created_at) > TOKEN_TTL_MS) {
    await db.query("DELETE FROM tokens WHERE token = $1", [token]);
    return null;
  }
  return { email: rows[0].email, token };
}

/* ---------- static ---------- */
function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (!filePath.startsWith(ROOT)) return send(res, 403, "Forbidden");
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, "Not found");
    const ext = path.extname(filePath).toLowerCase();
    // HTML jangan di-cache agar update langsung tampil; aset statis boleh di-cache.
    res.setHeader("Cache-Control", ext === ".html"
      ? "no-cache, no-store, must-revalidate"
      : "public, max-age=3600");
    send(res, 200, buf, MIME[ext] || "application/octet-stream");
  });
}

/* ---------- router (async) ---------- */
async function route(req, res) {
  const url = req.url.split("?")[0];

  // REGISTER
  if (url === "/api/register" && req.method === "POST") {
    return readJson(req, async (err, b) => {
      if (err) return json(res, 400, { error: "Body tidak valid" });
      let email = String(b.email || "").trim().toLowerCase();
      const password = String(b.password || "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: "Email tidak valid" });
      if (password.length < 8) return json(res, 400, { error: "Kata sandi minimal 8 karakter" });
      // Registrasi hanya untuk admin PERTAMA. Setelah ada akun, registrasi ditutup.
      const total = await db.query("SELECT count(*)::int AS n FROM users");
      if (total.rows[0].n > 0) return json(res, 403, { error: "Registrasi ditutup. Akun admin sudah ada." });
      const exists = await db.query("SELECT 1 FROM users WHERE email = $1", [email]);
      if (exists.rows.length) return json(res, 409, { error: "Email sudah terdaftar" });
      const { salt, derived } = hashPassword(password);
      await db.query("INSERT INTO users(email,salt,derived,created_at) VALUES($1,$2,$3,$4)", [email, salt, derived, Date.now()]);
      const token = newToken();
      await db.query("INSERT INTO tokens(token,email,created_at) VALUES($1,$2,$3)", [token, email, Date.now()]);
      return json(res, 200, { token, email });
    });
  }

  // LOGIN
  if (url === "/api/login" && req.method === "POST") {
    return readJson(req, async (err, b) => {
      if (err) return json(res, 400, { error: "Body tidak valid" });
      if (rateLimited("login:" + clientIp(req), 8, 5 * 60 * 1000))
        return json(res, 429, { error: "Terlalu banyak percobaan. Coba lagi beberapa menit." });
      const email = String(b.email || "").trim().toLowerCase();
      const { rows } = await db.query("SELECT * FROM users WHERE email = $1", [email]);
      const user = rows[0];
      if (!user || !verifyPassword(String(b.password || ""), user.salt, user.derived))
        return json(res, 401, { error: "Email atau kata sandi salah" });
      const token = newToken();
      await db.query("INSERT INTO tokens(token,email,created_at) VALUES($1,$2,$3)", [token, email, Date.now()]);
      return json(res, 200, { token, email });
    });
  }

  // GANTI PASSWORD (token)
  if (url === "/api/change-password" && req.method === "POST") {
    const u = await userFromToken(req);
    if (!u) return json(res, 401, { error: "Perlu masuk" });
    return readJson(req, async (err, b) => {
      if (err) return json(res, 400, { error: "Body tidak valid" });
      const oldPw = String(b.oldPassword || ""), newPw = String(b.newPassword || "");
      if (newPw.length < 8) return json(res, 400, { error: "Kata sandi baru minimal 8 karakter" });
      const { rows } = await db.query("SELECT salt, derived FROM users WHERE email = $1", [u.email]);
      const user = rows[0];
      if (!user || !verifyPassword(oldPw, user.salt, user.derived))
        return json(res, 401, { error: "Kata sandi lama salah" });
      const { salt, derived } = hashPassword(newPw);
      await db.query("UPDATE users SET salt=$1, derived=$2 WHERE email=$3", [salt, derived, u.email]);
      // Cabut semua sesi lain (token lain) demi keamanan; token saat ini tetap.
      await db.query("DELETE FROM tokens WHERE email=$1 AND token<>$2", [u.email, u.token]);
      return json(res, 200, { ok: true });
    });
  }

  // KELOLA ADMIN — list / tambah / hapus (semua perlu login).
  if (url === "/api/users" && req.method === "GET") {
    if (!(await userFromToken(req))) return json(res, 401, { error: "Perlu masuk" });
    const { rows } = await db.query("SELECT email, created_at FROM users ORDER BY created_at ASC");
    return json(res, 200, rows.map((r) => ({ email: r.email, createdAt: Number(r.created_at) })));
  }
  if (url === "/api/users" && req.method === "POST") {
    if (!(await userFromToken(req))) return json(res, 401, { error: "Perlu masuk" });
    return readJson(req, async (err, b) => {
      if (err) return json(res, 400, { error: "Body tidak valid" });
      const email = String(b.email || "").trim().toLowerCase();
      const password = String(b.password || "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: "Email tidak valid" });
      if (password.length < 8) return json(res, 400, { error: "Kata sandi minimal 8 karakter" });
      const exists = await db.query("SELECT 1 FROM users WHERE email = $1", [email]);
      if (exists.rows.length) return json(res, 409, { error: "Email sudah terdaftar" });
      const { salt, derived } = hashPassword(password);
      await db.query("INSERT INTO users(email,salt,derived,created_at) VALUES($1,$2,$3,$4)", [email, salt, derived, Date.now()]);
      return json(res, 200, { ok: true, email });
    });
  }
  const usr = url.match(/^\/api\/users\/(.+)$/);
  if (usr && req.method === "DELETE") {
    const me = await userFromToken(req);
    if (!me) return json(res, 401, { error: "Perlu masuk" });
    const target = decodeURIComponent(usr[1]).trim().toLowerCase();
    if (target === me.email) return json(res, 400, { error: "Tidak bisa menghapus akun sendiri" });
    const cnt = await db.query("SELECT count(*)::int AS n FROM users");
    if (cnt.rows[0].n <= 1) return json(res, 400, { error: "Minimal harus ada satu admin" });
    await db.query("DELETE FROM users WHERE email = $1", [target]);
    return json(res, 200, { ok: true });
  }

  // LOGOUT
  if (url === "/api/logout" && req.method === "POST") {
    const u = await userFromToken(req);
    if (u) await db.query("DELETE FROM tokens WHERE token = $1", [u.token]);
    return json(res, 200, { ok: true });
  }

  // ME
  if (url === "/api/me" && req.method === "GET") {
    const u = await userFromToken(req);
    if (!u) return json(res, 401, { error: "Belum masuk" });
    return json(res, 200, { email: u.email });
  }

  // STATS
  if (url === "/api/stats" && req.method === "GET") {
    if (!(await userFromToken(req))) return json(res, 401, { error: "Perlu masuk" });
    const z = await db.query("SELECT count(*) FROM collections WHERE name='zones'");
    const n = await db.query("SELECT count(*) FROM collections WHERE name='news'");
    const cf = await db.query("SELECT count(*) FROM content");
    const us = await db.query("SELECT count(*) FROM users");
    const lu = await db.query("SELECT max(updated_at) AS u FROM collections");
    let assets = 0;
    try { assets = fs.readdirSync(ASSET_DIR).filter((f) => !f.startsWith(".")).length; } catch (e) {}
    return json(res, 200, {
      zones: +z.rows[0].count, news: +n.rows[0].count, assets,
      contentFields: +cf.rows[0].count, users: +us.rows[0].count,
      contentUpdated: lu.rows[0].u ? Number(lu.rows[0].u) : null,
    });
  }

  // CONTENT (get, publik)
  if (url === "/api/content" && req.method === "GET") {
    const { rows } = await db.query("SELECT key, value FROM content");
    const obj = {};
    rows.forEach((r) => { obj[r.key] = r.value; });
    return json(res, 200, obj);
  }

  // CONTENT (post, token) — ganti seluruh isi
  if (url === "/api/content" && req.method === "POST") {
    if (!(await userFromToken(req))) return json(res, 401, { error: "Perlu masuk" });
    return readJson(req, async (err, obj) => {
      if (err || obj === null || typeof obj !== "object") return json(res, 400, { error: "JSON tidak valid" });
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM content");
        for (const k of Object.keys(obj)) {
          await client.query("INSERT INTO content(key,value) VALUES($1,$2)", [k, String(obj[k])]);
        }
        await client.query("COMMIT");
        json(res, 200, { ok: true });
      } catch (e) { await client.query("ROLLBACK"); json(res, 500, { error: String(e.message || e) }); }
      finally { client.release(); }
    });
  }

  // UPLOAD (token). Di Vercel -> Vercel Blob (permanen). Lokal -> tulis ke /assets.
  if (url === "/api/upload" && req.method === "POST") {
    if (!(await userFromToken(req))) return json(res, 401, { error: "Perlu masuk" });
    return readJson(req, async (err, b) => {
      if (err) return json(res, 400, { error: "JSON tidak valid" });
      const m = /^data:([^;]+);base64,(.*)$/s.exec((b && b.dataUrl) || "");
      if (!m) return json(res, 400, { error: "dataUrl tidak valid" });
      const buf = Buffer.from(m[2], "base64");
      const ext = "." + (m[1].split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "");
      const safe = String(b.name || "asset").replace(/[^a-z0-9._-]/gi, "_").replace(/\.[^.]*$/, "");
      const fname = safe + "-" + Date.now() + ext;
      // Vercel Blob bila token tersedia (di Vercel).
      if (process.env.BLOB_READ_WRITE_TOKEN) {
        try {
          const { put } = require("@vercel/blob");
          const blob = await put("uploads/" + fname, buf, { access: "public", contentType: m[1] });
          return json(res, 200, { url: blob.url });
        } catch (e) {
          return json(res, 500, { error: "Upload gagal: " + String(e.message || e) });
        }
      }
      // Fallback lokal (development).
      if (!fs.existsSync(ASSET_DIR)) fs.mkdirSync(ASSET_DIR, { recursive: true });
      fs.writeFile(path.join(ASSET_DIR, fname), buf, (e) =>
        e ? json(res, 500, { error: String(e) }) : json(res, 200, { url: "assets/" + fname }));
    });
  }

  // MESSAGES — kirim pesan (publik), list & hapus (token)
  if (url === "/api/messages" && req.method === "POST") {
    return readJson(req, async (err, b) => {
      if (err || !b || typeof b !== "object") return json(res, 400, { error: "Data tidak valid" });
      if (b.website) return json(res, 200, { ok: true }); // honeypot: bot isi field tersembunyi -> abaikan diam-diam
      if (rateLimited("msg:" + clientIp(req), 5, 10 * 60 * 1000))
        return json(res, 429, { error: "Terlalu banyak pesan terkirim. Coba lagi nanti." });
      const name = String(b.name || "").trim();
      const body = String(b.message || b.body || "").trim();
      const email = String(b.email || "").trim();
      const phone = String(b.phone || "").trim();
      if (!name || !body) return json(res, 400, { error: "Nama dan pesan wajib diisi" });
      if (name.length > 120 || body.length > 5000 || email.length > 160 || phone.length > 40)
        return json(res, 400, { error: "Isian terlalu panjang" });
      await db.query("INSERT INTO messages(id,name,email,phone,body,created_at) VALUES($1,$2,$3,$4,$5,$6)",
        [newId(), name, email, phone, body, Date.now()]);
      return json(res, 200, { ok: true });
    });
  }
  if (url === "/api/messages" && req.method === "GET") {
    if (!(await userFromToken(req))) return json(res, 401, { error: "Perlu masuk" });
    const { rows } = await db.query(
      "SELECT id,name,email,phone,body,created_at,seen FROM messages ORDER BY created_at DESC");
    return json(res, 200, rows.map((r) => ({
      id: r.id, name: r.name, email: r.email, phone: r.phone, body: r.body,
      createdAt: Number(r.created_at), seen: r.seen,
    })));
  }
  const msg = url.match(/^\/api\/messages\/([a-z0-9]+)$/i);
  if (msg && req.method === "DELETE") {
    if (!(await userFromToken(req))) return json(res, 401, { error: "Perlu masuk" });
    await db.query("DELETE FROM messages WHERE id=$1", [msg[1]]);
    return json(res, 200, { ok: true });
  }

  // TRACK — catat kunjungan (publik, dipanggil beacon di halaman).
  if (url === "/api/track" && req.method === "POST") {
    if (rateLimited("track:" + clientIp(req), 40, 60 * 1000)) return json(res, 200, { ok: true });
    const ua = String(req.headers["user-agent"] || "");
    if (/bot|crawl|spider|slurp|facebookexternalhit|preview|monitor|curl|wget|headless/i.test(ua))
      return json(res, 200, { ok: true }); // abaikan bot (tidak dihitung)
    const day = new Date().toISOString().slice(0, 10);
    await db.query("INSERT INTO visits(id,ts,day) VALUES($1,$2,$3)", [newId(), Date.now(), day]);
    return json(res, 200, { ok: true });
  }

  // TRAFFIC — ringkasan kunjungan untuk dashboard (token).
  if (url === "/api/traffic" && req.method === "GET") {
    if (!(await userFromToken(req))) return json(res, 401, { error: "Perlu masuk" });
    const { rows } = await db.query("SELECT day, count(*)::int AS n FROM visits GROUP BY day");
    const map = {};
    rows.forEach((r) => { map[r.day] = r.n; });
    const series = [];
    let d7 = 0, d30 = 0, total = 0;
    rows.forEach((r) => { total += r.n; });
    const today = new Date();
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today); d.setUTCDate(d.getUTCDate() - i);
      const k = d.toISOString().slice(0, 10);
      const n = map[k] || 0;
      if (i <= 13) series.push({ day: k, count: n }); // 14 hari terakhir untuk grafik
      d30 += n;
      if (i <= 6) d7 += n;
    }
    const todayKey = today.toISOString().slice(0, 10);
    return json(res, 200, { today: map[todayKey] || 0, d7, d30, total, series });
  }

  // USAGE — ukuran database (Supabase) + penyimpanan file (Vercel Blob), real-time (token).
  if (url === "/api/usage" && req.method === "GET") {
    if (!(await userFromToken(req))) return json(res, 401, { error: "Perlu masuk" });
    let dbBytes = 0, blobBytes = 0, blobCount = 0;
    try {
      const r = await db.query("SELECT pg_database_size(current_database())::bigint AS b");
      dbBytes = Number(r.rows[0].b);
    } catch (e) {}
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      try {
        const { list } = require("@vercel/blob");
        let cursor, more = true;
        while (more) {
          const page = await list({ cursor, limit: 1000 });
          (page.blobs || []).forEach((b) => { blobBytes += b.size || 0; blobCount++; });
          cursor = page.cursor; more = page.hasMore;
        }
      } catch (e) {}
    }
    return json(res, 200, {
      dbBytes, dbLimit: 500 * 1024 * 1024,        // free plan Supabase: 500 MB
      blobBytes, blobCount, blobLimit: 1024 * 1024 * 1024, // Vercel Blob free: 1 GB
    });
  }

  // COLLECTIONS CRUD
  const col = url.match(/^\/api\/collections\/([a-z0-9_-]+)(?:\/([a-z0-9]+))?$/i);
  if (col) {
    const name = col[1], id = col[2];
    if (ALLOWED_COLLECTIONS.indexOf(name) === -1) return json(res, 404, { error: "Koleksi tidak dikenal" });

    // READ list (publik) — urut created_at
    if (!id && req.method === "GET") {
      const { rows } = await db.query(
        "SELECT id, data, created_at, updated_at FROM collections WHERE name=$1 ORDER BY created_at ASC", [name]);
      return json(res, 200, rows.map((r) =>
        Object.assign({}, r.data, { id: r.id, createdAt: Number(r.created_at), updatedAt: r.updated_at ? Number(r.updated_at) : null })));
    }
    // CREATE (token)
    if (!id && req.method === "POST") {
      if (!(await userFromToken(req))) return json(res, 401, { error: "Perlu masuk" });
      return readJson(req, async (err, item) => {
        if (err || !item || typeof item !== "object") return json(res, 400, { error: "JSON tidak valid" });
        delete item.id; delete item.createdAt; delete item.updatedAt;
        const nid = newId(), now = Date.now();
        await db.query("INSERT INTO collections(id,name,data,created_at) VALUES($1,$2,$3,$4)", [nid, name, item, now]);
        return json(res, 200, Object.assign({}, item, { id: nid, createdAt: now, updatedAt: null }));
      });
    }
    // UPDATE (token)
    if (id && (req.method === "PUT" || req.method === "PATCH")) {
      if (!(await userFromToken(req))) return json(res, 401, { error: "Perlu masuk" });
      return readJson(req, async (err, patch) => {
        if (err || !patch || typeof patch !== "object") return json(res, 400, { error: "JSON tidak valid" });
        delete patch.id; delete patch.createdAt; delete patch.updatedAt;
        const cur = await db.query("SELECT data, created_at FROM collections WHERE id=$1 AND name=$2", [id, name]);
        if (!cur.rows.length) return json(res, 404, { error: "Item tidak ditemukan" });
        const merged = Object.assign({}, cur.rows[0].data, patch);
        const now = Date.now();
        await db.query("UPDATE collections SET data=$1, updated_at=$2 WHERE id=$3", [merged, now, id]);
        return json(res, 200, Object.assign({}, merged, { id, createdAt: Number(cur.rows[0].created_at), updatedAt: now }));
      });
    }
    // DELETE (token)
    if (id && req.method === "DELETE") {
      if (!(await userFromToken(req))) return json(res, 401, { error: "Perlu masuk" });
      const del = await db.query("DELETE FROM collections WHERE id=$1 AND name=$2 RETURNING id", [id, name]);
      if (!del.rows.length) return json(res, 404, { error: "Item tidak ditemukan" });
      return json(res, 200, { ok: true });
    }
    return json(res, 405, { error: "Metode tidak diizinkan" });
  }

  return serveStatic(req, res);
}

/* Handler utama: pastikan skema DB siap (sekali per instance), lalu route.
   Dipakai oleh server lokal maupun serverless function Vercel (api/index.js). */
async function handler(req, res) {
  try {
    await db.ensureInit();
    await route(req, res);
  } catch (e) {
    console.error("[server] error:", e);
    if (!res.headersSent) json(res, 500, { error: "Kesalahan server" });
  }
}

// Jalankan HTTP server hanya bila dieksekusi langsung (lokal), bukan di Vercel.
if (require.main === module) {
  http.createServer(handler).listen(PORT, () => {
    console.log("RANATI server  ->  http://localhost:" + PORT + "   (PostgreSQL)");
    console.log("Panel admin     ->  http://localhost:" + PORT + "/admin.html");
  });
}

module.exports = handler;
