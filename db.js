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
  if (cfg.connectionString && !/sslmode=/.test(cfg.connectionString)) {
    cfg.ssl = { rejectUnauthorized: false };
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
      email       TEXT PRIMARY KEY,
      salt        TEXT NOT NULL,
      derived     TEXT NOT NULL,
      created_at  BIGINT NOT NULL
    );
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
    CREATE TABLE IF NOT EXISTS visits (
      id          TEXT PRIMARY KEY,
      ts          BIGINT NOT NULL,
      day         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS visits_day_idx ON visits(day);
  `);
}

module.exports = { pool, query, init, ensureInit, loadConfig };
