/* mail.js — pengirim email verifikasi RANATI.
   Pakai Resend API bila RESEND_API_KEY diset (env EMAIL_FROM utk pengirim).
   Bila tidak diset (dev lokal), link verifikasi dicetak ke console saja. */
"use strict";

async function sendVerificationEmail(to, link) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM || "RANATI <onboarding@resend.dev>";
  const subject = "Verifikasi akun admin RANATI";
  const html =
    `<p>Halo,</p>` +
    `<p>Klik tautan berikut untuk memverifikasi akun admin RANATI kamu (berlaku 24 jam):</p>` +
    `<p><a href="${link}">${link}</a></p>` +
    `<p>Jika kamu tidak meminta ini, abaikan email ini.</p>`;

  if (!apiKey) {
    console.log("[mail] RESEND_API_KEY belum diset. Link verifikasi untuk " + to + ":\n  " + link);
    return { skipped: true };
  }

  const resp = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error("Gagal mengirim email verifikasi: " + resp.status + " " + text);
  }
  return { skipped: false };
}

module.exports = { sendVerificationEmail };
