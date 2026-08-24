/* server.js — backend RANATI (PostgreSQL).
   Setup:  1) buat db-config.json dari db-config.example.json (isi password)
           2) node setup-db.js   (buat database 'ranati' bila belum ada)
           3) node server.js     -> http://localhost:5000
   Statis  : index.html, admin.html, assets, dll.
   Auth    : POST /api/register, /api/login, /api/logout, GET /api/me
             GET /api/verify-email?token=..., POST /api/resend-verification
   Email   : set RESEND_API_KEY (+ EMAIL_FROM opsional) di env untuk kirim email asli;
             tanpa itu, link verifikasi hanya dicetak ke console (mode dev).
   Konten  : GET /api/content (publik), POST /api/content (token)
   Koleksi : GET /api/collections/:name  |  POST (token)  |  PUT/DELETE /:id (token)
   Stats   : GET /api/stats (token)      Upload: POST /api/upload (token) -> /assets
*/
"use strict";
require("dotenv").config();
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const db = require("./db");
const mail = require("./mail");

const ROOT = __dirname;
const PORT = process.env.PORT || 5000;
const ASSET_DIR = path.join(ROOT, "assets");
const ALLOWED_COLLECTIONS = ["zones", "news", "gallery"];
const UPLOAD_EXT = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp",
  "video/mp4": ".mp4", "video/webm": ".webm", "video/ogg": ".ogv",
};
const UPLOAD_MAX_BYTES = 100 * 1024 * 1024; // 100MB (video)
/* Cek magic bytes: MIME pada data-URL hanyalah klaim klien; pastikan isi berkas
   benar-benar format yang diklaim sebelum disajikan dari origin kita. */
function sniffOk(mime, buf) {
  if (buf.length < 12) return false;
  const ascii = (a, b) => buf.slice(a, b).toString("latin1");
  switch (mime) {
    case "image/jpeg": return buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF;
    case "image/png":  return ascii(1, 4) === "PNG" && buf[0] === 0x89;
    case "image/gif":  return ascii(0, 3) === "GIF";
    case "image/webp": return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
    case "video/mp4":  return ascii(4, 8) === "ftyp";
    case "video/webm": return buf[0] === 0x1A && buf[1] === 0x45 && buf[2] === 0xDF && buf[3] === 0xA3;
    case "video/ogg":  return ascii(0, 4) === "OggS";
    default: return false;
  }
}
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
/* IP klien. JANGAN pakai x-real-ip atau entri paling kiri dari x-forwarded-for:
   keduanya dikirim klien dan bisa dipalsukan untuk melewati rate limit. Entri
   paling KANAN dari XFF adalah yang ditambahkan proxy tepercaya (Vercel). */
function clientIp(req) {
  const xff = String(req.headers["x-forwarded-for"] || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (xff.length) return xff[xff.length - 1];
  return (req.socket && req.socket.remoteAddress) || "?";
}

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png",
  ".gif": "image/gif", ".svg": "image/svg+xml", ".webp": "image/webp",
  ".mp4": "video/mp4", ".webm": "video/webm", ".ogg": "video/ogg",
  ".pdf": "application/pdf",
  ".xml": "application/xml; charset=utf-8", ".txt": "text/plain; charset=utf-8",
};

/* ---------- util ---------- */
function isHttps(req) {
  return String(req.headers["x-forwarded-proto"] || "").split(",")[0].trim() === "https";
}
/* Header keamanan dasar untuk SEMUA respons. CSP masih memakai 'unsafe-inline'
   (index.html & admin.html penuh inline script), tapi tetap memblokir script dari
   origin asing — kaki eksfiltrasi XSS (connect-src) juga dibatasi. Origin eksternal
   yang diizinkan: unpkg (React), Google Fonts, dan widget Google Translate. */
const CSP = [
  "default-src 'self'",
  // 'unsafe-eval' dibutuhkan support.js: kompilasi JSX via Babel standalone + new Function.
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://translate.google.com https://translate.googleapis.com https://translate-pa.googleapis.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://www.gstatic.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' data: blob: https:",
  "connect-src 'self' https://translate.googleapis.com https://translate-pa.googleapis.com",
  // 'self': index.html menyematkan masterplan-3d.html lewat iframe.
  "frame-src 'self' https://translate.googleapis.com https://translate.google.com https://www.google.com",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-ancestors 'self'",
  "form-action 'self'",
].join("; ");
function securityHeaders(req, res) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Content-Security-Policy", CSP);
  if (isHttps(req)) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
}
function send(res, code, body, type) {
  res.writeHead(code, { "Content-Type": type || "text/plain; charset=utf-8" });
  res.end(body);
}
function json(res, code, obj) { send(res, code, JSON.stringify(obj), MIME[".json"]); }
/* Batas ukuran body PER ROUTE, bukan satu batas global 140MB: endpoint publik
   seperti /api/messages tidak boleh bisa dipakai memenuhi memori server. */
const BODY_LIMIT_DEFAULT = 1 * 1024 * 1024;              // 1MB — cukup untuk semua JSON biasa
const BODY_LIMIT_CONTENT = 5 * 1024 * 1024;              // 5MB — konten situs bisa besar
const BODY_LIMIT_UPLOAD = 140 * 1024 * 1024;             // 100MB file + overhead base64 (~1.37x)
function readBody(req, res, cb, limit) {
  limit = limit || BODY_LIMIT_DEFAULT;
  let data = "", aborted = false;
  req.on("data", (c) => {
    if (aborted) return;
    data += c;
    if (data.length > limit) {
      // Kirim respons DULU, baru putuskan koneksi — setelah destroy() tidak bisa menulis lagi,
      // dan klien akan menggantung tanpa pesan error.
      aborted = true;
      if (!res.headersSent) json(res, 413, { error: "Data terlalu besar." });
      req.destroy();
    }
  });
  req.on("end", () => { if (!aborted) cb(data); });
}
function readJson(req, res, cb, limit) {
  readBody(req, res, (b) => {
    let parsed;
    try { parsed = JSON.parse(b); } catch (e) { return cb(e); }
    // cb bisa async (mis. kirim email); tangkap reject-nya di sini supaya tidak jadi
    // unhandled rejection yang mematikan seluruh proses server.
    Promise.resolve(cb(null, parsed)).catch((e) => {
      console.error("[server] route error:", e);
      if (!res.headersSent) json(res, 500, { error: "Kesalahan server" });
    });
  }, limit);
}

/* ---------- auth helpers ---------- */
function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  return { salt, derived: crypto.scryptSync(password, salt, 64).toString("hex") };
}
function verifyPassword(password, salt, derived) {
  const h = crypto.scryptSync(password, String(salt || ""), 64).toString("hex");
  const a = Buffer.from(h), b = Buffer.from(String(derived || ""));
  // timingSafeEqual melempar bila panjang berbeda -> baris rusak jadi 500, bukan 401.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}
function newToken() { return crypto.randomBytes(24).toString("hex"); }
function newId() { return crypto.randomBytes(8).toString("hex"); }
/* Hash sesi sebelum disimpan: bocornya isi tabel tokens (backup, log, konsol DB)
   tidak lagi memberi sesi admin siap pakai — cookie-lah satu-satunya pemegang nilai asli. */
function hashToken(t) { return crypto.createHash("sha256").update(String(t)).digest("hex"); }
/* Kredensial palsu untuk menyamakan waktu respons login saat email tidak terdaftar:
   tanpa ini, "email tidak ada" terjawab instan sedangkan "password salah" butuh ~100ms
   scrypt — beda waktu itu membocorkan daftar email terdaftar. */
const DUMMY_CRED = hashPassword("dummy-password-timing-equalizer");
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // link verifikasi berlaku 24 jam
function originOf(req) {
  const proto = String(req.headers["x-forwarded-proto"] || "http").split(",")[0].trim();
  const host = req.headers.host;
  return proto + "://" + host;
}
async function sendVerification(req, email) {
  const verifyToken = newToken();
  await db.query(
    "UPDATE users SET verify_token=$1, verify_expires=$2 WHERE email=$3",
    [verifyToken, Date.now() + VERIFY_TTL_MS, email]
  );
  const link = originOf(req) + "/api/verify-email?token=" + verifyToken;
  await mail.sendVerificationEmail(email, link);
}
// Insert lalu kirim verifikasi; kalau pengiriman gagal, hapus lagi baris yang baru
// dibuat supaya email tidak "terkunci" (409 Email sudah terdaftar) tanpa pernah
// menerima link — pengguna bisa langsung coba daftar ulang.
async function createUserWithVerification(req, email, salt, derived) {
  await db.query("INSERT INTO users(email,salt,derived,created_at,verified) VALUES($1,$2,$3,$4,false)", [email, salt, derived, Date.now()]);
  try {
    await sendVerification(req, email);
  } catch (e) {
    await db.query("DELETE FROM users WHERE email=$1", [email]);
    throw e;
  }
}

/* ---------- sesi via cookie HttpOnly ----------
   Token disimpan di cookie HttpOnly, bukan localStorage, supaya XSS di panel admin
   tidak bisa mencuri token 30 hari. SameSite=Strict sudah menutup CSRF, jadi tidak
   perlu token CSRF terpisah. Secure hanya saat https agar dev lokal tetap jalan. */
const COOKIE_NAME = "ranati_session";
function parseCookies(req) {
  const out = {};
  String(req.headers.cookie || "").split(";").forEach((part) => {
    const i = part.indexOf("=");
    if (i < 0) return;
    // decodeURIComponent melempar pada cookie rusak (%zz) -> jangan sampai 500 semua route.
    try { out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim()); } catch (e) {}
  });
  return out;
}
function setSessionCookie(req, res, token) {
  const bits = [COOKIE_NAME + "=" + encodeURIComponent(token), "Path=/", "HttpOnly",
    "SameSite=Strict", "Max-Age=" + Math.floor(TOKEN_TTL_MS / 1000)];
  if (isHttps(req)) bits.push("Secure");
  res.setHeader("Set-Cookie", bits.join("; "));
}
function clearSessionCookie(req, res) {
  const bits = [COOKIE_NAME + "=", "Path=/", "HttpOnly", "SameSite=Strict", "Max-Age=0"];
  if (isHttps(req)) bits.push("Secure");
  res.setHeader("Set-Cookie", bits.join("; "));
}

async function userFromToken(req) {
  const auth = req.headers["authorization"] || "";
  // Cookie lebih diutamakan; header Bearer tetap didukung agar sesi lama tidak putus.
  const token = parseCookies(req)[COOKIE_NAME] || auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  // Di DB token disimpan sebagai sha256; cari hash dulu. Bila tidak ketemu, coba nilai
  // mentah (sesi lama dari sebelum hashing) dan upgrade barisnya ke hash.
  const hashed = hashToken(token);
  let { rows } = await db.query("SELECT email, created_at FROM tokens WHERE token = $1", [hashed]);
  if (!rows.length) {
    ({ rows } = await db.query(
      "UPDATE tokens SET token=$1 WHERE token=$2 RETURNING email, created_at", [hashed, token]));
    if (!rows.length) return null;
  }
  // Token kedaluwarsa -> hapus & tolak.
  if (Date.now() - Number(rows[0].created_at) > TOKEN_TTL_MS) {
    await db.query("DELETE FROM tokens WHERE token = $1", [hashed]);
    return null;
  }
  // token = kunci baris di DB (hash) — dipakai logout & change-password.
  return { email: rows[0].email, token: hashed };
}

/* ---------- static ----------
   Allowlist EKSPLISIT, bukan blocklist. Sebelumnya seluruh isi folder proyek bisa
   diunduh: /.env, /db-config.json, /users.json, /server.js, /db.js, /conversation-log.md.
   Filter berdasarkan ekstensi tidak cukup karena server.js & db.js sama-sama ".js". */
const PUBLIC_FILES = new Set([
  "index.html", "admin.html", "masterplan-3d.html",
  "style.css",
  "contact.js", "site-content.js", "support.js", "three-d-stage.js", "masterplan-model.js",
  "robots.txt", "sitemap.xml",
]);
const PUBLIC_DIRS = ["assets/", "uploads/"];
const PUBLIC_DIR_EXT = new Set([".jpg", ".jpeg", ".png", ".gif", ".webp", ".svg", ".mp4", ".webm", ".ogg", ".pdf"]);

function isPublicPath(rel) {
  if (!rel || rel.includes("\0")) return false;
  const posix = rel.split(path.sep).join("/");
  if (posix.split("/").some((seg) => seg.startsWith("."))) return false; // .env, .git, .thumbnail
  if (PUBLIC_FILES.has(posix)) return true;
  if (PUBLIC_DIRS.some((d) => posix.startsWith(d)))
    return PUBLIC_DIR_EXT.has(path.extname(posix).toLowerCase());
  return false;
}

function serveStatic(req, res) {
  let urlPath = decodeURIComponent(req.url.split("?")[0]);
  if (urlPath === "/") urlPath = "/index.html";
  const filePath = path.normalize(path.join(ROOT, urlPath));
  if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) return send(res, 403, "Forbidden");
  if (!isPublicPath(path.relative(ROOT, filePath))) return send(res, 404, "Not found");
  fs.readFile(filePath, (err, buf) => {
    if (err) return send(res, 404, "Not found");
    const ext = path.extname(filePath).toLowerCase();
    // HTML & JS jangan di-cache agar update langsung tampil; aset media boleh di-cache lama.
    res.setHeader("Cache-Control", (ext === ".html" || ext === ".js")
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
    return readJson(req, res, async (err, b) => {
      if (err) return json(res, 400, { error: "Body tidak valid" });
      let email = String(b.email || "").trim().toLowerCase();
      const password = String(b.password || "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: "Email tidak valid" });
      if (password.length < 8) return json(res, 400, { error: "Kata sandi minimal 8 karakter" });
      // Registrasi hanya untuk admin PERTAMA. Setelah ada akun, registrasi ditutup.
      const total = await db.query("SELECT count(*)::int AS n FROM users");
      if (total.rows[0].n > 0) return json(res, 403, { error: "Registrasi ditutup. Akun admin sudah ada." });
      // Bila env SETUP_TOKEN diset, pendaftaran pertama pun butuh token itu — menutup
      // celah "siapa cepat dia jadi admin" antara deploy dan pendaftaran pertama.
      if (process.env.SETUP_TOKEN && String(b.setupToken || "") !== process.env.SETUP_TOKEN)
        return json(res, 403, { error: "Token setup salah atau belum diisi.", needsSetupToken: true });
      const exists = await db.query("SELECT 1 FROM users WHERE email = $1", [email]);
      if (exists.rows.length) return json(res, 409, { error: "Email sudah terdaftar" });
      const { salt, derived } = hashPassword(password);
      await createUserWithVerification(req, email, salt, derived);
      return json(res, 200, { needsVerification: true, email });
    });
  }

  // VERIFIKASI EMAIL — GET hanya menampilkan halaman konfirmasi, TIDAK mengubah apa pun.
  // Banyak klien email & pemindai antivirus melakukan prefetch tautan; kalau GET yang
  // mengonsumsi token, tautan sudah "terpakai" sebelum pengguna sempat mengklik.
  // Token TIDAK disisipkan ke HTML (dulu lewat JSON.stringify — bisa reflected XSS
  // karena "</script>" tidak di-escape); skrip membacanya sendiri dari location.search.
  if (url === "/api/verify-email" && req.method === "GET") {
    const token = new URL(req.url, "http://x").searchParams.get("token") || "";
    if (!token) return send(res, 400, "Tautan tidak valid.");
    const page =
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>Verifikasi akun RANATI</title>' +
      '<body style="font-family:system-ui,sans-serif;max-width:420px;margin:12vh auto;padding:0 20px;text-align:center">' +
      '<h1 style="font-weight:400">Verifikasi akun</h1>' +
      '<p style="color:#666">Klik tombol di bawah untuk menyelesaikan verifikasi akun admin RANATI.</p>' +
      '<button id="go" style="padding:12px 22px;border:0;border-radius:8px;background:#111;color:#fff;font-size:15px;cursor:pointer">Verifikasi sekarang</button>' +
      '<p id="msg" style="margin-top:18px"></p><script>' +
      'var token=new URLSearchParams(location.search).get("token")||"";' +
      'document.getElementById("go").onclick=function(){this.disabled=true;' +
      'fetch("/api/verify-email",{method:"POST",headers:{"Content-Type":"application/json"},' +
      'body:JSON.stringify({token:token})})' +
      '.then(function(r){return r.json().catch(function(){return{};}).then(function(b){' +
      'document.getElementById("msg").textContent=b.error||"Email terverifikasi. Silakan masuk ke panel admin.";});});' +
      '<\/script></body>';
    return send(res, 200, page, "text/html; charset=utf-8");
  }
  if (url === "/api/verify-email" && req.method === "POST") {
    return readJson(req, res, async (err, b) => {
      if (err) return json(res, 400, { error: "Body tidak valid" });
      const token = String((b && b.token) || "");
      if (!token) return json(res, 400, { error: "Tautan tidak valid." });
      const { rows } = await db.query("SELECT email, verify_expires FROM users WHERE verify_token = $1", [token]);
      const user = rows[0];
      if (!user) return json(res, 400, { error: "Tautan verifikasi tidak valid atau sudah dipakai." });
      if (Date.now() > Number(user.verify_expires))
        return json(res, 400, { error: "Tautan verifikasi sudah kedaluwarsa. Minta tautan baru." });
      await db.query("UPDATE users SET verified=true, verify_token=NULL, verify_expires=NULL WHERE email=$1", [user.email]);
      return json(res, 200, { ok: true });
    });
  }

  // KIRIM ULANG VERIFIKASI
  if (url === "/api/resend-verification" && req.method === "POST") {
    return readJson(req, res, async (err, b) => {
      if (err) return json(res, 400, { error: "Body tidak valid" });
      if (rateLimited("resend:" + clientIp(req), 3, 15 * 60 * 1000))
        return json(res, 429, { error: "Terlalu banyak percobaan. Coba lagi beberapa menit." });
      const email = String(b.email || "").trim().toLowerCase();
      const { rows } = await db.query("SELECT email, verified FROM users WHERE email = $1", [email]);
      const user = rows[0];
      // Respons sama baik akun ada atau tidak, agar tidak bocorkan daftar email terdaftar.
      if (user && !user.verified) await sendVerification(req, email);
      return json(res, 200, { ok: true });
    });
  }

  // LOGIN
  if (url === "/api/login" && req.method === "POST") {
    return readJson(req, res, async (err, b) => {
      if (err) return json(res, 400, { error: "Body tidak valid" });
      const email = String(b.email || "").trim().toLowerCase();
      // Limit per-IP DAN per-akun: spray terdistribusi ke satu email tetap terbendung.
      if (rateLimited("login:" + clientIp(req), 8, 5 * 60 * 1000) ||
          rateLimited("login-email:" + email, 10, 5 * 60 * 1000))
        return json(res, 429, { error: "Terlalu banyak percobaan. Coba lagi beberapa menit." });
      const { rows } = await db.query("SELECT * FROM users WHERE email = $1", [email]);
      const user = rows[0];
      // Email tak terdaftar -> tetap jalankan scrypt (kredensial dummy) supaya durasi
      // respons sama dengan kasus "password salah" (anti enumerasi via timing).
      const ok = user
        ? verifyPassword(String(b.password || ""), user.salt, user.derived)
        : (verifyPassword(String(b.password || ""), DUMMY_CRED.salt, DUMMY_CRED.derived), false);
      if (!ok) return json(res, 401, { error: "Email atau kata sandi salah" });
      if (!user.verified) return json(res, 403, { error: "Email belum diverifikasi. Cek kotak masuk kamu." });
      const token = newToken();
      await db.query("INSERT INTO tokens(token,email,created_at) VALUES($1,$2,$3)", [hashToken(token), email, Date.now()]);
      // Bersihkan token kedaluwarsa sekalian (murah, dan tabel tidak tumbuh selamanya).
      await db.query("DELETE FROM tokens WHERE created_at < $1", [Date.now() - TOKEN_TTL_MS]);
      setSessionCookie(req, res, token);
      // Token TIDAK lagi dikirim di body: klien memakai cookie HttpOnly.
      return json(res, 200, { email });
    });
  }

  // GANTI PASSWORD (token)
  if (url === "/api/change-password" && req.method === "POST") {
    const u = await userFromToken(req);
    if (!u) return json(res, 401, { error: "Perlu masuk" });
    return readJson(req, res, async (err, b) => {
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
    return readJson(req, res, async (err, b) => {
      if (err) return json(res, 400, { error: "Body tidak valid" });
      const email = String(b.email || "").trim().toLowerCase();
      const password = String(b.password || "");
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: "Email tidak valid" });
      if (password.length < 8) return json(res, 400, { error: "Kata sandi minimal 8 karakter" });
      const exists = await db.query("SELECT 1 FROM users WHERE email = $1", [email]);
      if (exists.rows.length) return json(res, 409, { error: "Email sudah terdaftar" });
      const { salt, derived } = hashPassword(password);
      await createUserWithVerification(req, email, salt, derived);
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
    clearSessionCookie(req, res);
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
    const g = await db.query("SELECT count(*) FROM collections WHERE name='gallery'");
    const cf = await db.query("SELECT count(*) FROM content");
    const us = await db.query("SELECT count(*) FROM users");
    const lu = await db.query("SELECT max(updated_at) AS u FROM collections");
    let assets = 0;
    try { assets = fs.readdirSync(ASSET_DIR).filter((f) => !f.startsWith(".")).length; } catch (e) {}
    return json(res, 200, {
      zones: +z.rows[0].count, news: +n.rows[0].count, gallery: +g.rows[0].count, assets,
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
    return readJson(req, res, async (err, obj) => {
      if (err || obj === null || typeof obj !== "object") return json(res, 400, { error: "JSON tidak valid" });
      // Batasi jumlah & ukuran field supaya sesi yang dibajak tidak bisa memenuhi kuota DB.
      const keys = Object.keys(obj);
      if (keys.length > 1000) return json(res, 400, { error: "Terlalu banyak field konten." });
      for (const k of keys) {
        if (k.length > 200 || String(obj[k]).length > 500 * 1024)
          return json(res, 400, { error: "Field konten terlalu besar: " + k.slice(0, 80) });
      }
      const client = await db.pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("DELETE FROM content");
        for (const k of keys) {
          await client.query("INSERT INTO content(key,value) VALUES($1,$2)", [k, String(obj[k])]);
        }
        await client.query("COMMIT");
        json(res, 200, { ok: true });
      } catch (e) {
        await client.query("ROLLBACK");
        console.error("[server] content error:", e);
        json(res, 500, { error: "Gagal menyimpan konten." }); // jangan bocorkan detail skema DB
      }
      finally { client.release(); }
    }, BODY_LIMIT_CONTENT);
  }

  // UPLOAD (token). Di Vercel -> Vercel Blob (permanen). Lokal -> tulis ke /assets.
  if (url === "/api/upload" && req.method === "POST") {
    const uploader = await userFromToken(req);
    if (!uploader) return json(res, 401, { error: "Perlu masuk" });
    if (rateLimited("upload:" + uploader.email, 30, 10 * 60 * 1000))
      return json(res, 429, { error: "Terlalu banyak unggahan. Coba lagi beberapa menit." });
    return readJson(req, res, async (err, b) => {
      if (err) return json(res, 400, { error: "JSON tidak valid" });
      const m = /^data:([^;]+);base64,(.*)$/s.exec((b && b.dataUrl) || "");
      if (!m) return json(res, 400, { error: "dataUrl tidak valid" });
      const mime = m[1].toLowerCase();
      const ext = UPLOAD_EXT[mime];
      // Whitelist tipe berkas: cegah unggah SVG/HTML/script berbahaya yang bisa
      // dieksekusi saat dibuka langsung dari /assets (stored XSS same-origin).
      if (!ext) return json(res, 400, { error: "Tipe berkas tidak didukung. Hanya gambar (jpg/png/gif/webp) dan video (mp4/webm/ogg)." });
      const buf = Buffer.from(m[2], "base64");
      if (buf.length > UPLOAD_MAX_BYTES) return json(res, 400, { error: "Berkas terlalu besar (maks 100MB)." });
      if (!sniffOk(mime, buf)) return json(res, 400, { error: "Isi berkas tidak cocok dengan tipenya." });
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
    }, BODY_LIMIT_UPLOAD);
  }

  // MESSAGES — kirim pesan (publik), list & hapus (token)
  if (url === "/api/messages" && req.method === "POST") {
    return readJson(req, res, async (err, b) => {
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
    // Simpan sebagai hitungan per hari, bukan satu baris per kunjungan: tabel visits
    // lama tumbuh tanpa batas terhadap kuota 500MB.
    await db.query(
      "INSERT INTO visit_days(day,n) VALUES($1,1) ON CONFLICT (day) DO UPDATE SET n = visit_days.n + 1", [day]);
    return json(res, 200, { ok: true });
  }

  // TRAFFIC — ringkasan kunjungan untuk dashboard (token).
  if (url === "/api/traffic" && req.method === "GET") {
    if (!(await userFromToken(req))) return json(res, 401, { error: "Perlu masuk" });
    const { rows } = await db.query("SELECT day, n FROM visit_days");
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
      return readJson(req, res, async (err, item) => {
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
      return readJson(req, res, async (err, patch) => {
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
    securityHeaders(req, res);
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
