import { useEffect, useMemo, useState } from "react";
import { initFinale } from "../three/acts/finale.js";
import { useLanguage } from "../lib/i18n/LanguageContext.jsx";
import {
  DEFAULT_COUNTRY,
  countryOptions,
  formatPhone,
  phonePlaceholder,
} from "../lib/phone.js";
import "./Contact.css";

const EMPTY_FORM = {
  firstName: "",
  lastName: "",
  country: DEFAULT_COUNTRY, // ISO do DDI escolhido no select
  phone: "",
  email: "",
  message: "",
  website: "", // honeypot — só um bot preenche isto
};

export default function Contact() {
  useEffect(() => initFinale(), []);
  const { s, lang } = useLanguage();
  const { contact } = s;

  const [form, setForm] = useState(EMPTY_FORM);
  // idle | sending | success | error
  const [status, setStatus] = useState("idle");
  const [errorMessage, setErrorMessage] = useState("");

  const handleChange = (e) => {
    const { name, value } = e.target;
    setForm((f) => ({ ...f, [name]: value }));
  };

  const countries = useMemo(() => countryOptions(lang), [lang]);
  const country = countries.find((c) => c.code === form.country) ?? countries[0];

  // a máscara segue o país escolhido (lib/phone.js)
  const handlePhoneChange = (e) => {
    const formatted = formatPhone(e.target.value, form.country);
    setForm((f) => ({ ...f, phone: formatted }));
  };
  // trocando o país, o que já foi digitado é reformatado no padrão novo
  const handleCountryChange = (e) => {
    const next = e.target.value;
    setForm((f) => ({ ...f, country: next, phone: formatPhone(f.phone, next) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status === "sending") return;

    setStatus("sending");
    setErrorMessage("");

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });

      let data;
      try {
        data = await res.json();
      } catch {
        // Resposta não é JSON — normalmente significa que a rota /api nem
        // existe onde isto está rodando (ex.: `npm run dev` sozinho, que só
        // sobe o Vite e não serve api/contact.js) em vez de um erro vindo
        // de verdade do formulário.
        throw new Error(
          import.meta.env.DEV ? contact.errorDev : contact.errorProd,
        );
      }

      if (!res.ok) {
        throw new Error(data.error || contact.errorFallback);
      }

      setStatus("success");
      setForm(EMPTY_FORM);
    } catch (err) {
      setStatus("error");
      setErrorMessage(err.message || contact.errorFallback);
    }
  };

  return (
    <section id="contato" className="contact layer">
      <p className="contact__eyebrow">{contact.eyebrow}</p>
      <h2 className="contact__title">
        {contact.titleLine1}
        <br />
        {contact.titleLine2}
      </h2>

      <form className="contact__form" onSubmit={handleSubmit}>
        <div className="contact__row">
          <div className="contact__field">
            <label htmlFor="firstName">{contact.firstName}</label>
            <input
              id="firstName"
              name="firstName"
              type="text"
              autoComplete="given-name"
              required
              maxLength={80}
              value={form.firstName}
              onChange={handleChange}
            />
          </div>
          <div className="contact__field">
            <label htmlFor="lastName">{contact.lastName}</label>
            <input
              id="lastName"
              name="lastName"
              type="text"
              autoComplete="family-name"
              required
              maxLength={80}
              value={form.lastName}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className="contact__row">
          <div className="contact__field">
            <label htmlFor="phone">{contact.phone}</label>
            <div className="contact__phone">
              {/* select nativo (acessível, e no celular abre a lista do
                  sistema) invisível por cima de um rótulo curto: fechado,
                  mostra só "BR +55" */}
              <div className="contact__ddi">
                <span className="contact__ddi-face" aria-hidden="true">
                  {country.code} +{country.ddi}
                </span>
                <select
                  name="country"
                  aria-label={contact.country}
                  autoComplete="tel-country-code"
                  value={form.country}
                  onChange={handleCountryChange}
                >
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} (+{c.ddi})
                    </option>
                  ))}
                </select>
              </div>
              <input
                id="phone"
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                required
                maxLength={25}
                placeholder={phonePlaceholder(form.country)}
                value={form.phone}
                onChange={handlePhoneChange}
              />
            </div>
          </div>
          <div className="contact__field">
            <label htmlFor="email">{contact.email}</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={form.email}
              onChange={handleChange}
            />
          </div>
        </div>

        <div className="contact__field contact__field--full">
          <label htmlFor="message">{contact.message}</label>
          <textarea
            id="message"
            name="message"
            rows={5}
            required
            maxLength={5000}
            value={form.message}
            onChange={handleChange}
          />
        </div>

        {/* honeypot — invisível e inalcançável por teclado pra quem usa o site de verdade */}
        <input
          type="text"
          name="website"
          value={form.website}
          onChange={handleChange}
          className="contact__hp"
          tabIndex={-1}
          autoComplete="off"
          aria-hidden="true"
        />

        <div className="contact__form-footer">
          <button className="contact__submit" type="submit" disabled={status === "sending"}>
            {status === "sending" ? contact.submitting : contact.submit}
          </button>

          {status === "success" && (
            <p className="contact__status contact__status--ok" role="status">
              {contact.success}
            </p>
          )}
          {status === "error" && (
            <p className="contact__status contact__status--error" role="alert">
              {errorMessage} {contact.errorSuffix}{" "}
              <a href="mailto:marcelosg909@gmail.com">marcelosg909@gmail.com</a>
            </p>
          )}
        </div>
      </form>
    </section>
  );
}
