import { useEffect, useMemo, useRef, useState } from "react";
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

/* A logo (Assets/Logo, ícone bold) gravada no lacre em relevo negativo:
   o mesmo traço duas vezes — um claro deslocado para baixo/direita (a borda
   do sulco que pega luz) e um escuro por cima (o fundo do sulco na sombra). */
const LOGO_PATHS = [
  ["M184 100C184 119.14 177.463 137.706 165.473 152.624C153.482 167.543 136.756 177.919 118.063 182.035C99.3713 186.151 79.8339 183.76 62.686 175.257C45.5381 166.755 31.808 152.652 23.7688 135.282C15.7296 117.912 13.8634 98.3175 18.4793 79.7424C23.0951 61.1674 33.9161 44.7256 49.1508 33.1393C64.3855 21.5529 83.1202 15.5168 102.253 16.0302C121.386 16.5437 139.77 23.5759 154.362 35.9626", 9],
  ["M185 100H135", 9],
  ["M66 143V59L100 100L134 59V143", 9],
  ["M100 100L153.5 35.5", 9],
  ["M147 127V74", 13],
  ["M143 75H151", 9],
  ["M143 126H151", 9],
];
function SealMark() {
  const strokes = (cls, dx, dy) => (
    <g className={cls} transform={`translate(${dx} ${dy})`} fill="none">
      {LOGO_PATHS.map(([d, w]) => (
        <path key={d} d={d} strokeWidth={w} strokeLinecap="butt" />
      ))}
    </g>
  );
  return (
    <svg className="mail__seal-mark" viewBox="0 0 200 200" aria-hidden="true">
      {strokes("mail__seal-hi", 4, 5)}
      {strokes("mail__seal-lo", 0, 0)}
    </svg>
  );
}

/* Ao abrir, o lacre se desfaz em 0s e 1s brilhantes que se espalham e
   somem (Contact.css, .mail__burst). Posições fixas (pseudo-aleatório com
   semente), para o React renderizar sempre o mesmo. */
const SEAL_BITS = (() => {
  let seed = 7;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return Array.from({ length: 30 }, () => {
    const a0 = rnd() * Math.PI * 2;
    const r0 = Math.sqrt(rnd()) * 22; // nasce dentro do lacre
    const a = a0 + (rnd() - 0.5) * 0.8;
    const dist = 45 + rnd() * 75; // e se afasta do centro
    const x0 = Math.cos(a0) * r0;
    const y0 = Math.sin(a0) * r0;
    return {
      d: rnd() < 0.5 ? "0" : "1",
      style: {
        "--x0": `${x0.toFixed(1)}px`,
        "--y0": `${y0.toFixed(1)}px`,
        "--x1": `${(x0 + Math.cos(a) * dist).toFixed(1)}px`,
        // um pouco de subida, como faísca
        "--y1": `${(y0 + Math.sin(a) * dist - 18 * rnd()).toFixed(1)}px`,
        "--rot": `${((rnd() - 0.5) * 120).toFixed(0)}deg`,
        "--dl": `${(rnd() * 0.18).toFixed(3)}s`,
        "--sz": `${(9 + rnd() * 6).toFixed(1)}px`,
      },
    };
  });
})();

/* Um envelope novo se materializa de 0s e 1s: dígitos espalhados sobre a
   área do envelope, cada um vindo de um pouco longe até o seu ponto, antes
   de o papel aparecer (Contact.css, .mail__assemble). */
const ENV_BITS = (() => {
  let seed = 31;
  const rnd = () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
  return Array.from({ length: 70 }, () => {
    const a = rnd() * Math.PI * 2;
    const r = 30 + rnd() * 70;
    return {
      d: rnd() < 0.5 ? "0" : "1",
      style: {
        left: `${(2 + rnd() * 96).toFixed(1)}%`,
        top: `${(4 + rnd() * 92).toFixed(1)}%`,
        "--ox": `${(Math.cos(a) * r).toFixed(1)}px`,
        "--oy": `${(Math.sin(a) * r).toFixed(1)}px`,
        "--dl": `${(rnd() * 0.35).toFixed(3)}s`,
        "--sz": `${(9 + rnd() * 6).toFixed(1)}px`,
      },
    };
  });
})();

/* Fases do envelope (classes no .mail, Contact.css):
   closed        fechado, esperando chegar à tela
   open          aberto, com a carta para fora
   sealing       mensagem enviada: a carta volta para dentro, a aba fecha e
                 o lacre se materializa de 0s e 1s
   flying        o envelope fechado sai voando
   materializing um envelope novo surge de 0s e 1s (e depois abre: open) */
const PHASE_CLASS = {
  closed: "",
  open: " is-open",
  sealing: " is-sealing",
  flying: " is-sealing is-flying",
  materializing: " is-materializing",
};
// quando cada etapa começa, em ms depois do envio
const SENT_TIMELINE = { flying: 3300, materializing: 4500, open: 6100 };

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

export default function Contact() {

  // o envelope abre (a primeira vez) quando passa pelo meio da tela
  const envRef = useRef(null);
  const [phase, setPhase] = useState(reduceMotion ? "open" : "closed");
  // troca a cada envio: remonta o envelope, para as animações recomeçarem
  const [cycle, setCycle] = useState(0);
  const timers = useRef([]);
  useEffect(() => () => timers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const env = envRef.current;
    if (!env || reduceMotion) return undefined;

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setPhase((ph) => (ph === "closed" ? "open" : ph));
        io.disconnect();
      },
      { rootMargin: "-40% 0px -40% 0px" },
    );
    io.observe(env);
    return () => io.disconnect();
  }, []);
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
      if (reduceMotion) {
        setForm(EMPTY_FORM);
      } else {
        // a carta (ainda escrita) volta ao envelope, que é lacrado e sai
        // voando; um novo se materializa e abre, com a carta em branco
        setPhase("sealing");
        const at = (ms, fn) => timers.current.push(setTimeout(fn, ms));
        at(SENT_TIMELINE.flying, () => setPhase("flying"));
        at(SENT_TIMELINE.materializing, () => {
          setForm(EMPTY_FORM);
          setCycle((c) => c + 1);
          setPhase("materializing");
        });
        at(SENT_TIMELINE.open, () => setPhase("open"));
      }
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

      {/* O envelope se abre e o formulário sai dele como uma carta
          (Contact.css, .mail). O envelope é só decoração. */}
      <div key={cycle} className={`mail${PHASE_CLASS[phase]}`}>
        <div className="mail__env" aria-hidden="true" ref={envRef}>
          <span className="mail__back" />
          <span className="mail__flap" />
          <span className="mail__p mail__p--l" />
          <span className="mail__p mail__p--r" />
          <span className="mail__p mail__p--b" />
          <span className="mail__seal">
            <SealMark />
          </span>
          <span className="mail__assemble">
            {ENV_BITS.map((b, i) => (
              <i key={i} style={b.style}>
                {b.d}
              </i>
            ))}
          </span>
          <span className="mail__burst">
            {SEAL_BITS.map((b, i) => (
              <i key={i} style={b.style}>
                {b.d}
              </i>
            ))}
          </span>
        </div>

      <form className="contact__form mail__letter" onSubmit={handleSubmit}>
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
      </div>
    </section>
  );
}
