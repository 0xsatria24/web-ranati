/* contact.js — kirim form kontak ke /api/messages (masuk ke inbox admin).
   Pakai event delegation di document agar tahan render ulang React (DC runtime). */
(function () {
  "use strict";
  document.addEventListener("click", function (e) {
    var btn = e.target.closest ? e.target.closest("[data-contact-submit]") : null;
    if (!btn) return;
    e.preventDefault();
    var form = btn.closest("[data-contact-form]") || document;
    var q = function (a) { return form.querySelector("[data-contact-" + a + "]"); };
    var status = form.querySelector("[data-contact-status]");
    function setStatus(t, ok) { if (status) { status.textContent = t; status.style.color = ok ? "#7bd6a5" : "#e58a8a"; } }
    var name = (q("name") || {}).value || "";
    var email = (q("email") || {}).value || "";
    var phone = (q("phone") || {}).value || "";
    var message = (q("msg") || {}).value || "";
    var website = (q("website") || {}).value || ""; // honeypot
    if (!name.trim() || !message.trim()) { setStatus("Nama dan pesan wajib diisi.", false); return; }
    btn.disabled = true; setStatus("Mengirim…", true);
    fetch("/api/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: name, email: email, phone: phone, message: message, website: website }),
    })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (b) { return { ok: r.ok, b: b }; }); })
      .then(function (res) {
        if (!res.ok) throw new Error(res.b.error || "Gagal mengirim");
        setStatus("Terima kasih! Pesan Anda terkirim.", true);
        ["name", "email", "phone", "msg"].forEach(function (a) { var el = q(a); if (el) el.value = ""; });
      })
      .catch(function (err) { setStatus(err.message || "Gagal mengirim.", false); })
      .finally(function () { btn.disabled = false; });
  });
})();
