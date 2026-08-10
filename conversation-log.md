# RANATI Belitung — Admin Panel & CMS Build Log

Catatan pengembangan panel admin + CMS untuk website **RANATI (Destinasi Terpadu Masa Depan Belitung)**.
Ditulis kronologis sesuai permintaan yang berkembang sepanjang sesi.

---

## Ringkasan Akhir (TL;DR)

Website statis `Ranati Belitung.dc.html` (Claude Design component, React runtime via `support.js`) dijadikan
situs live (`index.html`), lalu dibangun **panel admin bergaya dashboard** dengan **login/register**, **CRUD**,
dan penyimpanan **PostgreSQL**. Gambar-gambar di halaman home kini bisa **diganti/dihapus dari panel admin**
dan langsung tampil di website.

**Jalankan:**
```bash
node setup-db.js     # sekali — buat database 'ranati'
node server.js       # http://localhost:3000
```
- Website : http://localhost:3000
- Admin   : http://localhost:3000/admin.html (daftar akun dulu)

---

## Timeline Permintaan → Hasil

### 1. "Buat panel admin untuk mengedit teks & aset website"
- Membuat panel admin awal berbasis `localStorage`.
- Menandai elemen editable dengan `data-edit` / `data-edit-src`.
- File: `admin.html`, `content-loader.js`.

### 2. "Lanjutkan (versi backend permanen)"
- Membuat backend Node murni (`server.js`) tanpa dependency: statis + API konten + upload aset.
- Penyimpanan pindah dari localStorage ke file `content.json`; upload ke folder `assets/`.

### 3. Import & implement `Ranati Belitung.dc.html`
- Mempelajari runtime `support.js` (self-boot: load React/ReactDOM dari CDN → parse `<x-dc>` → mount).
- Menjadikan design tersebut sebagai website live: **`index.html` = versi runnable** dari `.dc.html`.
- Semua dependensi (`support.js`, `masterplan-3d.html`, `assets/*.jpg`) tervalidasi.
- Diverifikasi via headless Chrome — hero, nav, dark theme, parallax semua render.

### 4. "Panel admin: UI/UX ikut website, disambungin API, ada login & register"
- Backend ditambah **auth**: `POST /api/register`, `/api/login`, `/api/logout`, `GET /api/me`.
  - Password di-hash **scrypt + salt**; token acak disimpan server; endpoint konten/upload butuh token.
- `admin.html` didesain ulang mengikuti gaya website (dark, aksen emas `#B89552`, font Inter, tombol pill)
  dengan layar **login/register** + editor field.

### 5. "Panel admin menggunakan CRUD"
- Backend: API koleksi generik — `GET/POST /api/collections/:name`, `PUT/DELETE /api/collections/:name/:id`.
  - Koleksi diizinkan: `zones`, `news` (whitelist). Item punya `id`, `createdAt`, `updatedAt`.
- Admin: grup Zona & Berita jadi **CRUD** penuh (kartu accordion — tambah/edit/hapus + upload media per item).

### 6. "UI/UX ada dashboard-nya (seperti KeroUI), user friendly"
- `admin.html` dirombak jadi **layout dashboard**:
  - **Sidebar** kiri: brand, menu (Dashboard, Konten Halaman), koleksi (Zona/Berita dengan badge jumlah),
    footer (user, Lihat Website, Keluar).
  - **Topbar** judul dinamis per halaman + tombol hamburger (responsif).
  - **Halaman Dashboard**: 4 kartu statistik (Zona, Berita, Aset Media, Field Konten) + sparkline,
    panel Aktivitas Terakhir, panel Aksi Cepat.
  - Routing hash (`#dashboard`, `#konten`, `#zones`, `#news`) — deep-link & tombol back.
- Backend: `GET /api/stats` (butuh token) untuk angka kartu dashboard.

### 7. "Database kesimpen di mana?" → "Pakai PostgreSQL"
- Sebelumnya data = file JSON (`users.json`, `content.json`, `collections.json`).
- Migrasi ke **PostgreSQL 18** (sudah terpasang & jalan di port 5432):
  - `db.js` — pool `pg` + `init()` buat tabel bila belum ada.
  - `setup-db.js` — buat database `ranati`.
  - `db-config.json` — kredensial (host/port/user/password/database), bisa dioverride env / `DATABASE_URL`.
  - `server.js` di-refactor penuh menjadi **async + query SQL** (transaksi untuk simpan konten).

### 8. "Gambar di home bisa di-remove & di-add dari panel admin"
- 12 gambar home di `index.html` ditandai `data-cms="KEY"` + `data-cms-default="assets/…"`.
- `site-content.js` (baru): fetch `/api/content`, terapkan override ke elemen `data-cms`,
  **tahan re-render React** via `MutationObserver`. Kosong/hapus → kembali ke `data-cms-default`.
- Admin: tambah grup **Gambar Zona (Home)** & **Gambar Berita (Home)** (total 12 slot).
- Diverifikasi: set gambar → website berubah; hapus → website kembali ke bawaan. Semua via PostgreSQL.

---

## Arsitektur Saat Ini

```
Browser (website)         Browser (admin)
   index.html                admin.html
   + support.js (DC runtime)   |  login/register + dashboard + CRUD
   + site-content.js ----------+--------> fetch /api/*
                                                |
                                          server.js (Node http)
                                          - auth (scrypt + token)
                                          - /api/content  (singleton fields)
                                          - /api/collections/:name (CRUD)
                                          - /api/upload -> assets/
                                          - /api/stats
                                                |
                                          db.js (pg Pool)
                                                |
                                          PostgreSQL 'ranati'
                                          tables: users, tokens, content, collections
```

---

## API

| Method | Endpoint | Auth | Fungsi |
|--------|----------|------|--------|
| POST | `/api/register` | – | Daftar akun (email + password ≥6) → token |
| POST | `/api/login` | – | Masuk → token |
| POST | `/api/logout` | token | Hapus token |
| GET | `/api/me` | token | Validasi token |
| GET | `/api/stats` | token | Angka dashboard (zones, news, assets, contentFields, users, contentUpdated) |
| GET | `/api/content` | – | Ambil semua field konten (key→value) |
| POST | `/api/content` | token | Ganti seluruh konten (transaksi) |
| POST | `/api/upload` | token | Upload gambar/video (dataURL base64) → `{url:"assets/…"}` |
| GET | `/api/collections/:name` | – | List item (`zones` \| `news`) |
| POST | `/api/collections/:name` | token | Buat item → item + id |
| PUT | `/api/collections/:name/:id` | token | Update (merge) item |
| DELETE | `/api/collections/:name/:id` | token | Hapus item |

---

## Skema Database (PostgreSQL)

```sql
users       (email PK, salt, derived, created_at)
tokens      (token PK, email FK->users, created_at)
content     (key PK, value)                       -- field tunggal (hero, footer, gambar home, dst)
collections (id PK, name, data JSONB, created_at, updated_at)   -- CRUD zones & news
```

---

## Slot Gambar Home yang Dapat Dikelola (`data-cms`)

| Key | Lokasi di Home | Default |
|-----|----------------|---------|
| `hero_media` | Hero | `assets/hero-marina-sunset.jpg` |
| `project_media` | Proyek Unggulan (Marina Bay) | `assets/zone1-marina.jpg` |
| `home_zone1_media` … `home_zone6_media` | Ring 6 Zona | `assets/zone1-marina.jpg` … `zone6-community.jpg` |
| `invest_media` | Seksi Investasi | `assets/marina-aerial.jpg` |
| `news1_media` … `news3_media` | 3 kartu Berita | `assets/zone1-marina.jpg`, `zone2-residence.jpg`, `zone5-agro.jpg` |

Cara kerja: nilai dari `/api/content` dipakai bila ada; bila kosong/dihapus → `data-cms-default`.
Perubahan bertahan melewati render ulang React lewat `MutationObserver` di `site-content.js`.

---

## Daftar File

**Inti aplikasi**
- `index.html` — website live (DC runtime + `site-content.js`)
- `Ranati Belitung.dc.html` — sumber design component
- `support.js` — runtime DC (React loader + template compiler)
- `site-content.js` — penerap override konten ke website
- `masterplan-3d.html`, `masterplan-model.js`, `three-d-stage.js` — model 3D masterplan
- `admin.html` — panel admin dashboard (login/register, editor, CRUD)
- `server.js` — backend Node + PostgreSQL
- `db.js` — koneksi & init skema PostgreSQL
- `setup-db.js` — buat database `ranati`
- `db-config.json` — kredensial DB (lokal; **jangan commit/bagikan**)
- `db-config.example.json` — contoh kredensial

**Data**
- PostgreSQL database `ranati` (tabel users/tokens/content/collections)
- `assets/` — gambar & aset upload

**Legacy (dari iterasi awal, tidak dipakai website baru)**
- `content-loader.js` — loader localStorage untuk index statis lama

---

## Verifikasi yang Dilakukan

Semua diuji end-to-end (bukan sekadar unit test), banyak lewat headless Chrome + panggilan API nyata:
- Website DC boot & render (hero, nav, dark theme).
- Auth: register, cegah duplikat (409), tolak sandi salah (401), login, `me`, proteksi endpoint (401).
- CRUD: create/read/update/delete + proteksi token + koleksi tak dikenal (404).
- Dashboard: kartu statistik dengan angka real, navigasi sidebar, deep-link hash.
- PostgreSQL: data tersimpan di tabel (bukan file JSON).
- Gambar home: set via admin → tampil di website; hapus → kembali ke bawaan.

---

## Catatan & Langkah Lanjut

- **Teks home** (judul/deskripsi/tombol) belum disambungkan ke API — grup teks ada di admin, tapi elemen
  di website belum ditandai `data-cms`. Polanya sama seperti gambar bila ingin dilanjutkan.
- **Video untuk slot gambar home**: `site-content.js` sengaja hanya menukar `src` gambar (aman untuk React);
  slot gambar tidak menerima video.
- **Keamanan/produksi**: token belum kedaluwarsa otomatis; `db-config.json` menyimpan password lokal —
  untuk produksi gunakan env var / secret manager dan HTTPS.
- Koleksi CRUD `zones`/`news` belum menggerakkan konten home (home masih slot tetap).

_Log dibuat otomatis dari sesi pengembangan._

---
---

# SESI LANJUTAN — Deploy Vercel, Mobile, Fitur, Keamanan, Migrasi Supabase

Kelanjutan: dari lokal → **live di Vercel** (`ranatiweb.vercel.app`), perbaikan mobile & interaksi,
fitur baru (kontak/WhatsApp/SEO), hardening keamanan, dan **migrasi database Neon → Supabase**.

## A. Fix `FUNCTION_INVOCATION_FAILED` (deploy Vercel)
Tiga masalah bertumpuk:
1. Vercel menjalankan `content-loader.js` (skrip browser) sebagai server → `location is not defined`
   (karena `"main"` di package.json). → dihapus, entrypoint jadi `server.js`.
2. `DATABASE_URL` kosong/salah (cuma 11 karakter) → diisi connection string Neon yang benar.
3. `server.js` pakai `listen()` + `process.exit(1)` → diubah export `handler`, `listen()` hanya lokal
   (`require.main === module`), init DB lazy `db.ensureInit()`.
- `vercel.json`: `functions["server.js"].includeFiles` supaya file statis (html/css/js/assets) ikut ke-bundle
  (kalau tidak → CSS/JS 404).
- Deploy via CLI `vercel --prod` (tanpa git; project sudah linked).

## B. Responsif / Mobile
- `index.html` tidak me-load `style.css` (pakai `<style>` inline) & tidak punya media query → ditambah.
- Grid 2 kolom → 1 kolom di ≤900px; nav desktop diganti hamburger.
- Statistik 714/120/6: markup diperbaiki + **center**.
- Celah putih samping section hitam → grid `minmax(300–360px)` melebihi layar → dipaksa 1 kolom +
  `html{overflow-x:hidden}`.
- Efek reveal (fade scroll) & indikator "GULIR" dimatikan.
- Header `Cache-Control: no-cache` untuk HTML.

## C. Tombol tidak responsif
- Elemen dekoratif 3D (`[data-scene]`,`[data-scene-inner]`,`[data-depth]`,`[data-tilt]`,`.stats-band`)
  menangkap klik → diberi `pointer-events:none` (`[data-model-veil]` dikembalikan auto).
- Nav "Investasi"/"Berita" tak jalan di tab Masterplan/Zona → handler `goInvest`/`goBerita`
  (balik Beranda lalu scroll).

## D. Panel Admin — upgrade
- **Upload gambar aktif** via **Vercel Blob** (store `ranati-uploads`, env `BLOB_READ_WRITE_TOKEN`).
- **Video di slot gambar**: `site-content.js` ganti `<img>`→`<video>` (autoplay/loop/muted) bila nilai video.
- **Upload & Hapus auto-save** (dulu perlu klik Simpan) — via `pushContent`.
- **Semua teks disambungkan** `data-cms`: hero (kicker/title/body/cta + badge Marina Bay/Superyacht/
  Kabupaten Belitung), statistik (nilai+label), proyek, investasi, footer, **6 kartu zona** (label/title/desc).
- **Bisa dikosongkan**: key ADA di content (termasuk `""`) = override; TIDAK ADA = pakai bawaan.
- **Dashboard dirombak**: sparkline palsu dibuang; kartu jadi angka nyata (Field Teks, Media, Zona, Admin);
  panel **Pratinjau Konten** (thumbnail hero + judul); menu Zona/Berita diberi catatan "belum di web".

## E. Fitur baru
- **Form kontak → Inbox admin**: tabel `messages`; `POST /api/messages` (publik, honeypot), `GET/DELETE` (token);
  form di footer (`contact.js`); menu **"Pesan Masuk"** di admin.
- **Kontak + WhatsApp**: field `contact_whatsapp`/`contact_email` (Konten → Footer/Kontak); **tombol WA
  mengambang** muncul otomatis bila nomor diisi (`wireContact`); "Hubungi Kami" buka WA.
- **SEO**: `<title>`, meta description, Open Graph, Twitter card, favicon, canonical, theme-color.

## F. Keamanan (hardening)
- **Registrasi publik DITUTUP** setelah admin pertama (`/api/register` → 403 bila ada user).
- **Multi-admin dari panel**: `/api/users` GET/POST/DELETE (token); Dashboard → **Kelola Admin**
  (tak bisa hapus diri sendiri / admin terakhir).
- **Ganti password**: `/api/change-password` + form Dashboard (cabut sesi lain).
- **Token kedaluwarsa 30 hari** (`TOKEN_TTL_MS`).
- **Rate-limit** login & form pesan (in-memory); **honeypot** anti-spam.
- Password min. 8 karakter.

## G. Migrasi Neon → Supabase
- Aplikasi pakai Postgres biasa → cukup ganti `DATABASE_URL` (kode tak berubah).
- Data dimigrasikan langsung (script `pg`): users 1, tokens 1, content 0, collections 0, messages 1.
- Connection string Supabase (Transaction pooler, **port 6543**):
  `postgresql://postgres.gqdvtgchfdhvhvnhrlwk:<PASSWORD>@aws-0-ap-northeast-1.pooler.supabase.com:6543/postgres`
- Kesalahan umum: password masih dibungkus kurung siku `[ ]` (placeholder) → 500. Harus dihapus.
- `db.js` baca koneksi dari env `DATABASE_URL` → `db-config.json` → `PG*` → localhost
  (string TIDAK di-hardcode). Untuk lokal: set `$env:DATABASE_URL` atau buat `db-config.json`.
- **RLS (Row Level Security)** diaktifkan di semua tabel Supabase (peringatan Supabase). REST API publik
  terkunci; aplikasi tetap jalan (role `postgres` bypass RLS).

## Endpoint tambahan (sesi ini)
| Method | Endpoint | Auth | Fungsi |
|--------|----------|------|--------|
| POST | `/api/messages` | – | Kirim pesan kontak (honeypot + rate-limit) |
| GET | `/api/messages` | token | List pesan masuk |
| DELETE | `/api/messages/:id` | token | Hapus pesan |
| GET | `/api/users` | token | List admin |
| POST | `/api/users` | token | Tambah admin |
| DELETE | `/api/users/:email` | token | Hapus admin |
| POST | `/api/change-password` | token | Ganti password |

## Berkas baru/diubah (sesi ini)
- Baru: `contact.js`, `vercel.json`. Tabel baru: `messages`.
- Diubah besar: `server.js`, `db.js`, `site-content.js`, `admin.html`, `index.html`.

## Status akhir & TODO
- Deploy Vercel jalan; database di **Supabase** (data + RLS beres).
- **Sisa:** pastikan `DATABASE_URL` di Vercel = string Supabase **tanpa kurung siku** + redeploy → verifikasi.
- **Rotate** password Neon & Supabase (sempat tampil saat pengerjaan).
- Menu koleksi Zona/Berita belum dirender di website (homepage hardcoded).
- `spark()` di admin.html = dead code; `contact_email` belum dipakai untuk link mailto.

_Diperbarui pada sesi lanjutan (deploy, mobile, fitur, keamanan, migrasi Supabase)._
