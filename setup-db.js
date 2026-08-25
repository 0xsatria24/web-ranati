
/* setup-db.js — buat database aplikasi bila belum ada.
   Terhubung ke database bawaan 'postgres' memakai kredensial db-config.json,
   lalu CREATE DATABASE <database>. Jalankan sekali:  node setup-db.js  */
"use strict";
// server.js memuat .env lewat dotenv; skrip ini harus melakukannya juga, kalau tidak
// DATABASE_URL yang ditaruh di .env tak terlihat di sini dan konfigurasinya beda sendiri.
require("dotenv").config();
const { Client } = require("pg");
const cfg = require("./db").loadConfig();

/* Dua bentuk konfigurasi harus ditangani terpisah.
   Dulu kode ini menyalin cfg lalu menghapus connectionString — pada mode DATABASE_URL
   itu menyisakan objek KOSONG, sehingga Client jatuh ke default localhost dan database
   dibuat di mesin yang salah sambil melaporkan "berhasil". */
let target, admin;
if (cfg.connectionString) {
  const url = new URL(cfg.connectionString);
  target = decodeURIComponent(url.pathname.replace(/^\//, "")) || "ranati";
  // Server yang sama, tapi konek ke database bawaan 'postgres' untuk menjalankan CREATE.
  const adminUrl = new URL(cfg.connectionString);
  adminUrl.pathname = "/postgres";
  admin = { connectionString: adminUrl.toString() };
  // Samakan perilaku SSL dengan db.js: penyedia cloud hampir selalu mewajibkannya.
  if (!/sslmode=/.test(cfg.connectionString))
    admin.ssl = { rejectUnauthorized: process.env.DB_SSL_INSECURE !== "1" };
} else {
  target = cfg.database || "ranati";
  admin = Object.assign({}, cfg, { database: "postgres" });
}

(async () => {
  const client = new Client(admin);
  try {
    await client.connect();
    // Cetak tujuan sebenarnya: bug lama diam-diam mengenai localhost.
    const at = admin.connectionString
      ? new URL(admin.connectionString).host
      : (admin.host || "localhost") + ":" + (admin.port || 5432);
    console.log("Terhubung ke " + at + " — target database: '" + target + "'");
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [target]);
    if (exists.rows.length) {
      console.log("Database '" + target + "' sudah ada — tidak ada perubahan.");
    } else {
      await client.query('CREATE DATABASE "' + target + '"');
      console.log("Database '" + target + "' berhasil dibuat.");
    }
  } catch (e) {
    console.error("Gagal:", e.message);
    console.error(cfg.connectionString
      ? "Cek DATABASE_URL (host/kredensial), dan pastikan penggunanya boleh CREATE DATABASE."
      : "Cek db-config.json (host/port/user/password).");
    process.exit(1);
  } finally {
    await client.end();
  }
})();
