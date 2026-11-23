import { Resend } from "resend";
import {
  getCountries,
  getCountryCallingCode,
  validatePhoneNumberLength,
} from "libphonenumber-js";

/*
 * Vercel Serverless Function — POST /api/contact
 *
 * O site é estático e não tem autorização pra mandar email EM NOME de quem
 * preenche o formulário (isso exigiria o remetente ser dono do domínio de
 * origem, o que nunca é o caso pro email de um visitante qualquer). Em vez
 * disso: o email sempre sai do endereço configurado abaixo (a conta Resend
 * do dono do site) para TO_EMAIL (a mesma pessoa) — o remetente do
 * formulário só aparece no corpo da mensagem e no cabeçalho Reply-To, então
 * responder o email já vai direto pra ele.
 */

const resend = new Resend(process.env.RESEND_API_KEY);

const TO_EMAIL = "marcelosg909@gmail.com";
// Sem domínio próprio verificado no Resend, o remetente tem que ser o
// endereço de sandbox deles — troque via env var assim que verificar um
// domínio (ver README para o passo a passo).
const FROM_EMAIL = process.env.CONTACT_FROM_EMAIL || "Portfólio <onboarding@resend.dev>";

const LIMITS = {
  firstName: 80,
  lastName: 80,
  phone: 25,
  email: 254,
  message: 5000,
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// O telefone vem no formato nacional do país escolhido no select de DDI
// (src/lib/phone.js): só dígitos, espaços, parênteses e hífens, e com um
// número de dígitos possível para aquele país — um POST direto que não
// bater com isso é rejeitado.
const PHONE_CHARS_RE = /^[\d\s()\-]+$/;
const COUNTRIES = new Set(getCountries());
const regionNames = new Intl.DisplayNames(["pt-BR"], { type: "region" });

function phoneOk(phone, country) {
  if (!COUNTRIES.has(country) || !PHONE_CHARS_RE.test(phone)) return false;
  const digits = phone.replace(/\D/g, "");
  return !!digits && validatePhoneNumberLength(digits, country) === undefined;
}

/** "+55 (31) 99999-9999 (Brasil)" — DDI, número e o país, por extenso */
function phoneLabel(phone, country) {
  const name = regionNames.of(country) ?? country;
  return `+${getCountryCallingCode(country)} ${phone} (${name})`;
}

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function validate({ firstName, lastName, phone, country, email, message }) {
  const errors = [];

  if (!firstName || firstName.length > LIMITS.firstName) {
    errors.push("Nome inválido.");
  }
  if (!lastName || lastName.length > LIMITS.lastName) {
    errors.push("Sobrenome inválido.");
  }
  if (!phone || phone.length > LIMITS.phone || !phoneOk(phone, country)) {
    errors.push("Telefone inválido.");
  }
  if (!email || email.length > LIMITS.email || !EMAIL_RE.test(email)) {
    errors.push("Email inválido.");
  }
  if (!message || message.length > LIMITS.message) {
    errors.push("Mensagem inválida.");
  }

  return errors;
}

function escapeHtml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildEmail({ firstName, lastName, phone, country, email, message }) {
  const fullName = `${firstName} ${lastName}`;
  const phoneText = phoneLabel(phone, country);
  const safe = {
    fullName: escapeHtml(fullName),
    phone: escapeHtml(phoneText),
    email: escapeHtml(email),
    message: escapeHtml(message).replace(/\n/g, "<br />"),
  };

  const text = [
    `Novo contato pelo portfólio.`,
    ``,
    `Nome: ${fullName}`,
    `Telefone: ${phoneText}`,
    `Email: ${email}`,
    ``,
    `Mensagem:`,
    message,
  ].join("\n");

  const html = `
    <div style="font-family: -apple-system, sans-serif; color: #0a0a0d; line-height: 1.6;">
      <p style="margin: 0 0 16px;"><strong>Novo contato pelo portfólio.</strong></p>
      <table style="border-collapse: collapse; margin-bottom: 16px;">
        <tr><td style="padding: 2px 12px 2px 0; color: #5d5b63;">Nome</td><td>${safe.fullName}</td></tr>
        <tr><td style="padding: 2px 12px 2px 0; color: #5d5b63;">Telefone</td><td>${safe.phone}</td></tr>
        <tr><td style="padding: 2px 12px 2px 0; color: #5d5b63;">Email</td><td>${safe.email}</td></tr>
      </table>
      <p style="margin: 0 0 8px; color: #5d5b63;">Mensagem</p>
      <p style="margin: 0; white-space: pre-wrap;">${safe.message}</p>
    </div>
  `;

  return { text, html, subject: `Novo contato pelo portfólio — ${fullName}` };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Método não permitido." });
  }

  let body;
  try {
    body = req.body ?? {};
  } catch {
    // req.body é um getter — JSON malformado lança ao ser acessado, não antes
    return res.status(400).json({ error: "Corpo da requisição inválido." });
  }

  // Honeypot: campo escondido no formulário que só um bot preenche. Finge
  // sucesso pra não entregar que foi filtrado.
  if (clean(body.website)) {
    return res.status(200).json({ ok: true });
  }

  const fields = {
    firstName: clean(body.firstName),
    lastName: clean(body.lastName),
    phone: clean(body.phone),
    // forms antigos (sem o select de DDI) mandavam só números brasileiros
    country: clean(body.country).toUpperCase() || "BR",
    email: clean(body.email),
    message: clean(body.message),
  };

  const errors = validate(fields);
  if (errors.length) {
    return res.status(400).json({ error: errors.join(" ") });
  }

  if (!process.env.RESEND_API_KEY) {
    console.error("RESEND_API_KEY não configurada.");
    return res.status(500).json({
      error: "Envio de email não configurado no servidor.",
    });
  }

  const { text, html, subject } = buildEmail(fields);

  try {
    const { error } = await resend.emails.send({
      from: FROM_EMAIL,
      to: TO_EMAIL,
      replyTo: fields.email,
      subject,
      text,
      html,
    });

    if (error) {
      console.error("Resend recusou o envio:", error);
      return res.status(502).json({
        error: "Não foi possível enviar sua mensagem agora. Tente novamente em instantes.",
      });
    }

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("Falha ao enviar email via Resend:", err);
    return res.status(502).json({
      error: "Não foi possível enviar sua mensagem agora. Tente novamente em instantes.",
    });
  }
}
