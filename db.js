/* db.js — koneksi PostgreSQL + inisialisasi skema untuk RANATI.
   Kredensial dibaca dari (prioritas): DATABASE_URL env → db-config.json → env PG* → default.
   Buat db-config.json (lihat db-config.example.json) berisi password 'postgres'. */
"use strict";
const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

function loadConfig() {
  // 1) DATABASE_URL penuh
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  // 2) db-config.json di folder proyek
  let file = {};
  try { file = JSON.parse(fs.readFileSync(path.join(__dirname, "db-config.json"), "utf8")); } catch (e) {}
  return {
    host: process.env.PGHOST || file.host || "localhost",
    port: parseInt(process.env.PGPORT || file.port || "5432", 10),
    user: process.env.PGUSER || file.user || "postgres",
    password: process.env.PGPASSWORD || file.password || "postgres",
    database: process.env.PGDATABASE || file.database || "ranati",
  };
}

function poolConfig() {
  const cfg = loadConfig();
  // Postgres cloud (Neon/Supabase/dll) hampir selalu wajib SSL.
  // rejectUnauthorized:false menerima sertifikat apa pun -> koneksi bisa disadap (MITM).
  // Default sekarang ketat; set DB_SSL_INSECURE=1 hanya bila penyedia memakai CA privat
  // dan sertifikatnya belum dipasang.
  if (cfg.connectionString && !/sslmode=/.test(cfg.connectionString)) {
    cfg.ssl = { rejectUnauthorized: process.env.DB_SSL_INSECURE !== "1" };
  }
  return cfg;
}

const pool = new Pool(poolConfig());
pool.on("error", (err) => console.error("[db] pool error:", err.message));

/* init() idempotent + di-cache: di serverless (Vercel) dipanggil sekali per
   instance lewat ensureInit(), bukan sekali saat "server start". */
let _initPromise = null;
function ensureInit() {
  if (!_initPromise) {
    _initPromise = init().catch((e) => { _initPromise = null; throw e; });
  }
  return _initPromise;
}

async function query(text, params) {
  return pool.query(text, params);
}

/* Buat tabel bila belum ada. Dipanggil sekali saat server start. */
async function init() {
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      email           TEXT PRIMARY KEY,
      salt            TEXT NOT NULL,
      derived         TEXT NOT NULL,
      created_at      BIGINT NOT NULL,
      verified        BOOLEAN NOT NULL DEFAULT false,
      verify_token    TEXT,
      verify_expires  BIGINT
    );
    ALTER TABLE users ADD COLUMN IF NOT EXISTS verified BOOLEAN NOT NULL DEFAULT false;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_token TEXT;
    ALTER TABLE users ADD COLUMN IF NOT EXISTS verify_expires BIGINT;
    -- Akun yang sudah ada SEBELUM fitur verifikasi email ditambahkan (verify_token belum
    -- pernah diisi) dianggap sudah terverifikasi, supaya tidak terkunci dari akunnya sendiri.
    UPDATE users SET verified = true WHERE verified = false AND verify_token IS NULL;
    CREATE TABLE IF NOT EXISTS tokens (
      token       TEXT PRIMARY KEY,
      email       TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      created_at  BIGINT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS content (
      key         TEXT PRIMARY KEY,
      value       TEXT
    );
    CREATE TABLE IF NOT EXISTS collections (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      data        JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at  BIGINT NOT NULL,
      updated_at  BIGINT
    );
    CREATE INDEX IF NOT EXISTS collections_name_idx ON collections(name);
    CREATE TABLE IF NOT EXISTS messages (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT,
      phone       TEXT,
      body        TEXT NOT NULL,
      created_at  BIGINT NOT NULL,
      seen        BOOLEAN NOT NULL DEFAULT false
    );
    CREATE INDEX IF NOT EXISTS messages_created_idx ON messages(created_at);
    -- Kunjungan disimpan sebagai hitungan per hari. Tabel 'visits' lama (satu baris per
    -- kunjungan) tumbuh tanpa batas; datanya dipindahkan lalu tabelnya dibuang.
    -- Migrasi harus idempotent: init() jalan sekali per instance serverless, bisa paralel.
    CREATE TABLE IF NOT EXISTS visit_days (
      day  TEXT PRIMARY KEY,
      n    INTEGER NOT NULL DEFAULT 0
    );
    DO $mig$
    BEGIN
      IF to_regclass('public.visits') IS NOT NULL THEN
        INSERT INTO visit_days(day, n)
          SELECT day, count(*)::int FROM visits GROUP BY day
          ON CONFLICT (day) DO NOTHING;
        DROP TABLE visits;
      END IF;
    END
    $mig$;
  `);
}

module.exports = { pool, query, init, ensureInit, loadConfig };
