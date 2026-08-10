/* setup-db.js — buat database aplikasi bila belum ada.
   Terhubung ke database bawaan 'postgres' memakai kredensial db-config.json,
   lalu CREATE DATABASE <database>. Jalankan sekali:  node setup-db.js  */
"use strict";
const { Client } = require("pg");
const cfg = require("./db").loadConfig();

const target = cfg.database || "ranati";
const admin = Object.assign({}, cfg, { database: "postgres" });
delete admin.connectionString; // pakai field terpisah untuk konek ke 'postgres'

(async () => {
  const client = new Client(admin);
  try {
    await client.connect();
    const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [target]);
    if (exists.rows.length) {
      console.log("Database '" + target + "' sudah ada — tidak ada perubahan.");
    } else {
      await client.query('CREATE DATABASE "' + target + '"');
      console.log("Database '" + target + "' berhasil dibuat.");
    }
  } catch (e) {
    console.error("Gagal:", e.message);
    console.error("Cek db-config.json (host/port/user/password).");
    process.exit(1);
  } finally {
    await client.end();
  }
})();
