/* api/index.js — titik masuk serverless function untuk Vercel.
   Vercel (zero-config) hanya memperlakukan berkas di dalam folder `api/` sebagai
   serverless function. server.js sudah diakhiri `module.exports = handler` — persis
   bentuk yang dibutuhkan — jadi berkas ini cukup mengekspornya ulang.
   Tanpa berkas ini, `server.js` di root tidak pernah dijalankan sebagai function dan
   seluruh /api/* mengembalikan 404 di produksi.
   Perutean semua request ke sini diatur oleh `routes` di vercel.json. */
"use strict";
module.exports = require("../server.js");
