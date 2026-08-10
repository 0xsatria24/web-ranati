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

  function apply() {
    document.querySelectorAll("#dc-root [data-cms]").forEach(applyEl);
    wireContact();
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

  fetch("/api/content", { cache: "no-store" })
    .then(function (r) { return r.json(); })
    .then(function (c) { content = c || {}; boot(); })
    .catch(function () { boot(); });

  // Catat 1 kunjungan per pemuatan halaman (analitik traffic dashboard admin).
  try { fetch("/api/track", { method: "POST", keepalive: true }).catch(function () {}); } catch (e) {}
})();
