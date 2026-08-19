/* site-content.js — menerapkan konten dari panel admin (/api/content) ke website.
   Elemen bertanda data-cms="KEY" memakai nilai dari /api/content bila ada.
   Jenis field:
     - <img data-cms>            : gambar; bila nilainya video, otomatis diganti <video>.
     - [data-cms][data-cms-html] : judul/HTML; diisi via innerHTML.
     - [data-cms][data-count]    : angka statistik; memperbarui target animasi.
     - [data-cms] lain           : teks biasa (textContent).
   Nilai asli tiap elemen di-cache agar bisa dikembalikan bila field dikosongkan.
   Tahan render ulang React (DC runtime) via MutationObserver. */
(function () {
  "use strict";
  if (location.protocol !== "http:" && location.protocol !== "https:") return;

  var content = {};
  var cache = new WeakMap();
  var isVideo = function (u) { return /^data:video\//.test(u) || /\.(mp4|webm|ogg)(\?|$)/i.test(u); };

  function orig(el) {
    var o = cache.get(el);
    if (!o) {
      o = {};
      if (el.tagName === "IMG") o.src = el.getAttribute("src");
      else if (el.hasAttribute("data-cms-html")) o.html = el.innerHTML;
      else o.text = el.textContent;
      if (el.hasAttribute("data-count")) o.count = el.getAttribute("data-count");
      cache.set(el, o);
    }
    return o;
  }

  function applyEl(el) {
    var key = el.getAttribute("data-cms");
    var o = orig(el);
    // Beda antara "belum diatur" (pakai teks bawaan) dan "sengaja dikosongkan" (tampil kosong):
    //   key tidak ada di content  -> val = null  -> pakai bawaan
    //   key ada (termasuk string kosong) -> override eksplisit dari admin
    var has = Object.prototype.hasOwnProperty.call(content, key);
    var raw = content[key];
    var val = has ? String(raw == null ? "" : raw) : null;

    // --- MEDIA (img / video) ---
    if (el.tagName === "IMG") {
      var parent = el.parentNode;
      var vid = parent ? parent.querySelector('video[data-cms-video="' + key + '"]') : null;
      var want = val || o.src;
      if (want && isVideo(want)) {
        el.style.display = "none";
        if (!vid && parent) {
          vid = document.createElement("video");
          vid.setAttribute("data-cms-video", key);
          vid.muted = true; vid.defaultMuted = true; vid.loop = true;
          vid.autoplay = true; vid.playsInline = true;
          vid.setAttribute("muted", ""); vid.setAttribute("autoplay", "");
          vid.setAttribute("loop", ""); vid.setAttribute("playsinline", "");
          vid.style.cssText = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;";
          if (el.style && el.style.filter) vid.style.filter = el.style.filter;
          parent.insertBefore(vid, el.nextSibling);
        }
        if (vid && vid.getAttribute("src") !== want) {
          vid.src = want;
          if (vid.play) { var p = vid.play(); if (p && p.catch) p.catch(function () {}); }
        }
      } else {
        el.style.display = "";
        if (vid && vid.parentNode) vid.parentNode.removeChild(vid);
        if (want && el.getAttribute("src") !== want) el.src = want;
      }
      return;
    }

    // --- ANGKA STATISTIK (data-count) ---
    if (el.hasAttribute("data-count")) {
      if (val != null) {
        el.dataset.counted = "1"; // matikan animasi hitung, tampilkan nilai admin
        if (el.getAttribute("data-count") !== val) el.setAttribute("data-count", val);
        if (el.textContent !== val) el.textContent = val;
      }
      // val kosong -> biarkan bawaan & animasinya
      return;
    }

    // --- JUDUL / HTML ---
    if (el.hasAttribute("data-cms-html")) {
      var html = val != null ? val : o.html;
      if (html != null && el.innerHTML !== html) el.innerHTML = html;
      return;
    }

    // --- TEKS BIASA ---
    var text = val != null ? val : o.text;
    if (text != null && el.textContent !== text) el.textContent = text;
  }

  function wireContact() {
    var wa = String(content.contact_whatsapp || "").replace(/[^0-9]/g, "");
    var mail = String(content.contact_email || "").trim();
    // Tombol WhatsApp mengambang: tampil hanya bila nomor diisi.
    document.querySelectorAll("#dc-root [data-wa-float]").forEach(function (el) {
      if (wa) { el.setAttribute("href", "https://wa.me/" + wa); el.style.display = "flex"; }
      else { el.style.display = "none"; }
    });
    // Tombol "Hubungi Kami" -> buka WhatsApp bila nomor ada (kalau tidak, biarkan ke #kontak).
    document.querySelectorAll("#dc-root [data-wa-link]").forEach(function (el) {
      if (wa) { el.setAttribute("href", "https://wa.me/" + wa); el.setAttribute("target", "_blank"); el.setAttribute("rel", "noopener"); }
    });
    document.querySelectorAll("#dc-root [data-mail-link]").forEach(function (el) {
      if (mail) el.setAttribute("href", "mailto:" + mail);
    });
  }

  // ---- KOLEKSI (Kelola Zona / Kelola Berita / Kelola Galeri) ----
  var collections = { zones: null, news: null, gallery: null };
  var esc = function (s) {
    return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c];
    });
  };
  function mediaTag(url, alt, imgStyle) {
    var u = String(url || "");
    if (isVideo(u)) {
      return '<video muted autoplay loop playsinline src="' + esc(u) +
        '" style="position:absolute; inset:0; width:100%; height:100%; object-fit:cover"></video>';
    }
    return '<img loading="lazy" src="' + esc(u) + '" alt="' + esc(alt) +
      '" style="' + imgStyle + '" />';
  }
  function zonaFullRow(it, i) {
    var num = it.index || String(i + 1).padStart(2, "0");
    var goto = "zona/" + it.id;
    return '<li><a href="#/' + goto + '" data-goto="' + goto + '" data-zone-row="true" style="display:flex; align-items:center; gap:clamp(16px,3vw,40px); padding:clamp(20px,2.6vw,30px) 0; border-bottom:1px solid #E7E7E7; transition:padding-left .35s">' +
      '<span style="font-size:11px; letter-spacing:0.2em; color:#B89552; width:34px; flex-shrink:0">' + esc(num) + '</span>' +
      '<span style="flex:1; min-width:0"><span style="display:block; font-size:clamp(19px,2.2vw,28px); font-weight:300; letter-spacing:-0.01em">' + esc(it.title) + '</span>' +
      '<span style="display:block; font-size:13px; color:#777777; margin-top:5px">' + esc(it.desc) + '</span></span>' +
      '<span style="flex-shrink:0; font-size:11px; letter-spacing:0.14em; text-transform:uppercase; color:#111111">Lihat →</span>' +
      '</a></li>';
  }
  function zonaSliderCard(it, i) {
    var num = it.index || String(i + 1).padStart(2, "0");
    var goto = "zona/" + it.id;
    var cover = Array.isArray(it.media) ? it.media[0] : it.media;
    return '<li style="flex:0 0 auto; scroll-snap-align:start; width:min(400px,82vw)">' +
      '<a href="#/' + goto + '" data-goto="' + goto + '" style="display:block; position:relative; height:clamp(420px,52vw,500px); border-radius:20px; overflow:hidden; background:#111111">' +
      mediaTag(cover, it.title, "position:absolute; inset:0; filter:saturate(0.74) contrast(1.03) sepia(0.06)") +
      '<div style="position:absolute; inset:0; background:linear-gradient(to top, rgba(17,17,17,0.88) 0%, rgba(17,17,17,0.05) 62%)"></div>' +
      '<div style="position:absolute; left:28px; right:28px; bottom:28px; color:#F8F8F6">' +
      '<span style="display:block; font-size:11px; letter-spacing:0.24em; color:#B89552; margin-bottom:9px">ZONA ' + esc(num) + '</span>' +
      '<h3 style="font-size:24px; font-weight:400; line-height:1.2">' + esc(it.title) + '</h3>' +
      '<p style="font-size:12.5px; font-weight:300; color:rgba(248,248,246,0.72); margin-top:9px">' + esc(it.desc) + '</p>' +
      '</div></a></li>';
  }
  function beritaFullCard(it) {
    return '<article data-reveal="true">' +
      '<div data-tilt="true" style="height:250px; border-radius:18px; overflow:hidden; background:#E7E7E7; margin-bottom:18px; will-change:transform">' +
      mediaTag(it.media, "", "filter:saturate(0.7) contrast(1.02) sepia(0.06)") +
      '</div>' +
      '<span style="display:block; font-size:11px; color:#B89552; letter-spacing:0.18em; text-transform:uppercase; margin-bottom:9px">' + esc(it.date) + '</span>' +
      '<h3 style="font-size:19px; font-weight:400; line-height:1.35; margin-bottom:9px">' + esc(it.title) + '</h3>' +
      '<p style="font-size:14px; font-weight:300; color:#777777; line-height:1.6">' + esc(it.body) + '</p>' +
      '</article>';
  }
  function renderCollection(gridId, items, cardFn) {
    var grid = document.getElementById(gridId);
    if (!grid || !Array.isArray(items) || !items.length) return; // kosong -> pertahankan kartu statis
    var sig = "c" + items.length + ":" + items.map(function (it) {
      return (it.id || "") + (it.updatedAt || "");
    }).join(",");
    if (grid.getAttribute("data-col-sig") === sig) return; // sudah dirender, tak ada perubahan
    grid.innerHTML = items.map(cardFn).join("");
    grid.setAttribute("data-col-sig", sig);
  }

  function galleryItemCard(it) {
    return '<figure data-reveal="true" style="margin:0">' +
      '<div data-tilt="true" style="position:relative; height:270px; border-radius:16px; overflow:hidden; background:#E7E7E7; margin-bottom:14px; will-change:transform">' +
      mediaTag(it.media, it.title, "filter:saturate(0.72) contrast(1.02) sepia(0.06)") +
      '</div>' +
      (it.title ? '<figcaption style="font-size:16px; font-weight:400; line-height:1.35; margin-bottom:4px">' + esc(it.title) + '</figcaption>' : '') +
      (it.desc ? '<p style="font-size:13px; font-weight:300; color:#777777; line-height:1.6">' + esc(it.desc) + '</p>' : '') +
      '</figure>';
  }
  function renderGallery(items) {
    var host = document.getElementById("gallery-groups");
    if (!host || !Array.isArray(items) || !items.length) return; // kosong -> pertahankan pesan bawaan
    var sig = "g" + items.length + ":" + items.map(function (it) {
      return (it.id || "") + (it.updatedAt || "");
    }).join(",");
    if (host.getAttribute("data-col-sig") === sig) return;

    var groups = {}; var order = [];
    items.forEach(function (it) {
      var key = String(it.subsection || "").trim() || "Lainnya";
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(it);
    });
    host.innerHTML = order.map(function (name) {
      return '<div style="margin-bottom:clamp(50px,6vw,80px)">' +
        '<h2 style="font-size:clamp(20px,2.2vw,26px); font-weight:300; letter-spacing:-0.01em; margin-bottom:24px; padding-bottom:14px; border-bottom:1px solid #E7E7E7">' + esc(name) + '</h2>' +
        '<div style="display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:clamp(20px,2.6vw,30px) 22px">' +
        groups[name].map(galleryItemCard).join("") +
        '</div></div>';
    }).join("");
    host.setAttribute("data-col-sig", sig);
  }

  // Halaman detail dinamis #/zona/<id> — dipanggil oleh router (window.renderZonaDetail)
  // dan juga di sini tiap kali data berubah, untuk kasus buka link langsung sebelum fetch selesai.
  function renderZonaDetail(id) {
    var eyebrow = document.getElementById("zonaDetail-eyebrow");
    var title = document.getElementById("zonaDetail-title");
    var desc = document.getElementById("zonaDetail-desc");
    var body = document.getElementById("zonaDetail-body");
    var gallery = document.getElementById("zonaDetail-gallery");
    if (!title || !desc) return;
    var item = (collections.zones || []).filter(function (z) { return z.id === id; })[0];
    if (!item) {
      title.textContent = "Zona tidak ditemukan";
      desc.textContent = "Item zona ini mungkin sudah dihapus dari panel admin.";
      if (body) body.innerHTML = "";
      if (gallery) gallery.innerHTML = "";
      return;
    }
    eyebrow.textContent = item.index ? ("Zona " + item.index) : "Zona";
    title.textContent = item.title || "(tanpa judul)";
    desc.textContent = item.desc || "";
    if (body) {
      var paragraphs = String(item.body || "").split(/\n{2,}/).map(function (s) { return s.trim(); }).filter(Boolean);
      body.innerHTML = paragraphs.map(function (p) {
        return '<p style="margin-bottom:1em">' + esc(p).replace(/\n/g, "<br>") + '</p>';
      }).join("");
    }
    document.title = (item.title || "Zona") + " — RANATI Belitung";
    var descMeta = document.querySelector('meta[name="description"]');
    if (descMeta && item.desc) descMeta.setAttribute("content", item.desc);
    // Catatan: tidak pakai mediaTag() di sini — helper itu memaksa video jadi
    // position:absolute+object-fit:cover (utk kartu), sementara di sini media
    // harus tampil utuh (natural height) di body konten, tidak ke-crop.
    var mediaList = Array.isArray(item.media) ? item.media.filter(Boolean) : (item.media ? [item.media] : []);
    if (gallery) {
      gallery.innerHTML = mediaList.map(function (url) {
        var tag = isVideo(url)
          ? '<video muted autoplay loop playsinline controls src="' + esc(url) + '" style="display:block; width:100%; height:auto; filter:saturate(0.76) contrast(1.04) sepia(0.06)"></video>'
          : '<img loading="lazy" src="' + esc(url) + '" alt="' + esc(item.title || "") + '" style="display:block; width:100%; height:auto; filter:saturate(0.76) contrast(1.04) sepia(0.06)" />';
        return '<div style="border-radius:20px; overflow:hidden; background:#F1EFEA">' + tag + '</div>';
      }).join("");
    }
  }
  window.renderZonaDetail = renderZonaDetail;

  function apply() {
    document.querySelectorAll("#dc-root [data-cms]").forEach(applyEl);
    // Catatan: home-zones-grid/home-news-grid di beranda SENGAJA tetap statis (kartu kurasi
    // tetap) — koleksi Zona/Berita di panel admin dipakai untuk halaman listing lengkapnya saja.
    renderCollection("zona-slider", collections.zones, zonaSliderCard);
    renderCollection("zona-list-full", collections.zones, zonaFullRow);
    renderCollection("berita-grid-full", collections.news, beritaFullCard);
    renderGallery(collections.gallery);
    wireContact();
    var zm = (location.hash || "").match(/^#\/zona\/([a-z0-9]+)$/i);
    if (zm) renderZonaDetail(zm[1]);
  }

  function watch(root) {
    apply();
    var t;
    var mo = new MutationObserver(function () { clearTimeout(t); t = setTimeout(apply, 60); });
    mo.observe(root, { subtree: true, childList: true, attributes: true, attributeFilter: ["src"] });
  }

  function boot() {
    var tries = 0;
    (function wait() {
      var root = document.getElementById("dc-root");
      if (root && root.querySelector("[data-cms]")) return watch(root);
      if (tries++ < 300) setTimeout(wait, 50);
    })();
  }

  function fetchJson(url) {
    return fetch(url, { cache: "no-store" }).then(function (r) { return r.json(); });
  }

  Promise.all([
    fetchJson("/api/content").catch(function () { return {}; }),
    fetchJson("/api/collections/zones").catch(function () { return []; }),
    fetchJson("/api/collections/news").catch(function () { return []; }),
    fetchJson("/api/collections/gallery").catch(function () { return []; })
  ]).then(function (res) {
    content = res[0] || {};
    collections.zones = Array.isArray(res[1]) ? res[1] : [];
    collections.news = Array.isArray(res[2]) ? res[2] : [];
    collections.gallery = Array.isArray(res[3]) ? res[3] : [];
    boot();
  }).catch(function () { boot(); });

  // Catat 1 kunjungan per pemuatan halaman (analitik traffic dashboard admin).
  try { fetch("/api/track", { method: "POST", keepalive: true }).catch(function () {}); } catch (e) {}
})();
