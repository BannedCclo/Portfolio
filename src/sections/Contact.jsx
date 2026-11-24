import { useEffect, useMemo, useRef, useState } from "react";
import { useLanguage } from "../lib/i18n/LanguageContext.jsx";
import { mountEnvelope3D } from "../three/envelope3d.js";
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

/* Fases do envelope (classes no .mail, Contact.css):
   closed        fechado, esperando chegar à tela
   open          aberto, com a carta para fora
   sealing       mensagem enviada: a carta volta para dentro, a aba fecha,
                 o lacre se materializa de 0s e 1s (liso, uma gota de cera)
                 e o carimbo desce e o molda com o logo (three/sealStamp.js)
   flying        o envelope lacrado sai voando
   waiting       o envelope seguinte, já montado (e o 3D dele carregado e
                 compilado) mas invisível, esperando a vez de chegar
   arriving      o envelope novo chega voando, já lacrado, enquanto o antigo
                 ainda está saindo (e depois abre: open — o lacre estoura e a
                 carta sai) */
const PHASE_CLASS = {
  closed: "",
  open: " is-open",
  sealing: " is-sealing",
  flying: " is-sealing is-flying",
  waiting: " is-waiting",
  arriving: " is-arriving",
};
// quando cada etapa começa, em ms depois do envio. O novo chega enquanto o
// antigo ainda voa (mail-fly dura 1,15 s); em "settle" o antigo já saiu e é
// desmontado
const SENT_TIMELINE = { flying: 4400, arriving: 4750, settle: 5600, open: 6150 };

// TEMPORÁRIO, para testar a animação de envio localmente: em dev, o botão
// não chama /api/contact e roda direto a sequência de "enviado". Remover
// (ou pôr false) quando terminar os testes. Em produção é sempre false.
const FAKE_SEND_IN_DEV = import.meta.env.DEV && true;

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

const noop = () => {};

/* Um envelope (o .mail) com o seu 3D (three/envelope3d.js), que desenha por
   cima/baixo da folha; a aba e o lacre de CSS seguem animando, invisíveis, e
   ditam o movimento. Cada envelope monta o próprio 3D uma vez — no envio, o
   próximo é montado logo no início (fase waiting), então já chega pronto.
   O envelope de CSS só aparece se não houver WebGL ou o modelo falhar. */
function Envelope({ phase, next, envRef, children }) {
  const env = useRef(null);
  const glBack = useRef(null);
  const glFront = useRef(null);
  const glFx = useRef(null);
  const flap = useRef(null);
  const seal = useRef(null);
  useEffect(() => {
    const el = env.current;
    if (!el) return undefined;
    return mountEnvelope3D({
      back: glBack.current,
      front: glFront.current,
      fx: glFx.current,
      flapEl: flap.current,
      sealEl: seal.current,
      onReady: () => el.classList.add("has-3d"),
      onFail: () => el.classList.add("no-3d"),
    });
  }, []);
  const setEnv = (el) => {
    env.current = el;
    if (envRef) envRef.current = el;
  };
  return (
    <div className={`mail${PHASE_CLASS[phase]}${next ? " is-next" : ""}`}>
      <div className="mail__env" aria-hidden="true" ref={setEnv}>
        <canvas className="mail__gl mail__gl--back" ref={glBack} />
        <canvas className="mail__gl mail__gl--front" ref={glFront} />
        <canvas className="mail__gl mail__gl--fx" ref={glFx} />
        <span className="mail__back" />
        <span className="mail__flap" ref={flap} />
        <span className="mail__p mail__p--l" />
        <span className="mail__p mail__p--r" />
        <span className="mail__p mail__p--b" />
        <span className="mail__seal" ref={seal}>
          <SealMark />
        </span>
        <span className="mail__burst">
          {SEAL_BITS.map((b, i) => (
            <i key={i} style={b.style}>
              {b.d}
            </i>
          ))}
        </span>
      </div>
      {children}
    </div>
  );
}

export default function Contact() {
  // os envelopes na tela: normalmente um só; no envio, o que sai (com a
  // carta congelada como foi escrita) e o que chega. O último é o "vivo".
  const [mails, setMails] = useState(() => [
    { id: 0, phase: reduceMotion ? "open" : "closed" },
  ]);
  const phase = mails[mails.length - 1].phase;
  const setPhase = (ph) =>
    setMails((ms) =>
      ms.map((m, i) =>
        i === ms.length - 1 ? { ...m, phase: typeof ph === "function" ? ph(m.phase) : ph } : m,
      ),
    );

  // o envelope abre (a primeira vez) quando passa pelo meio da tela
  const envRef = useRef(null);
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

  // o envelope inclina um pouco na direção do ponteiro (só com mouse, e
  // volta a ficar reto enquanto alguém digita na carta). O ponteiro define o
  // alvo; o ângulo desenhado persegue o alvo (regra 1 de lib/motion.js)
  const tiltRef = useRef(null);
  useEffect(() => {
    const el = tiltRef.current;
    if (!el || reduceMotion || !window.matchMedia("(hover: hover) and (pointer: fine)").matches) {
      return undefined;
    }
    const MAX_Y = 7; // graus, girando em torno do eixo vertical
    const MAX_X = 5;
    const target = { x: 0, y: 0 };
    const cur = { x: 0, y: 0 };
    let raf = 0;
    let lastT = 0;
    const step = (t) => {
      const dt = lastT ? Math.min(0.05, (t - lastT) / 1000) : 1 / 60;
      lastT = t;
      const typing = el.contains(document.activeElement) && document.activeElement !== document.body;
      const tx = typing ? 0 : target.x;
      const ty = typing ? 0 : target.y;
      const a = 1 - Math.exp(-dt * 6);
      cur.x += (tx - cur.x) * a;
      cur.y += (ty - cur.y) * a;
      el.style.setProperty("--tilt-y", `${(cur.x * MAX_Y).toFixed(3)}deg`);
      el.style.setProperty("--tilt-x", `${(-cur.y * MAX_X).toFixed(3)}deg`);
      if (Math.abs(tx - cur.x) + Math.abs(ty - cur.y) > 0.0005) {
        raf = requestAnimationFrame(step);
      } else {
        raf = 0;
        lastT = 0;
      }
    };
    const kick = () => {
      if (!raf) raf = requestAnimationFrame(step);
    };
    const onMove = (e) => {
      const r = el.getBoundingClientRect();
      // normalizado pelo tamanho do envelope, com folga: o efeito já começa
      // com o ponteiro perto, e satura um pouco fora dele
      const nx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2 + 160);
      const ny = (e.clientY - (r.top + r.height / 2)) / (r.height / 2 + 160);
      target.x = Math.max(-1, Math.min(1, nx));
      target.y = Math.max(-1, Math.min(1, ny));
      kick();
    };
    const onLeave = () => {
      target.x = 0;
      target.y = 0;
      kick();
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    document.documentElement.addEventListener("pointerleave", onLeave);
    el.addEventListener("focusin", kick);
    return () => {
      window.removeEventListener("pointermove", onMove);
      document.documentElement.removeEventListener("pointerleave", onLeave);
      el.removeEventListener("focusin", kick);
      if (raf) cancelAnimationFrame(raf);
    };
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

  // a carta (ainda escrita) volta ao envelope, que é lacrado, carimbado e
  // sai voando; enquanto isso um novo, já montado, chega voando e abre, com
  // a carta em branco
  const playSent = () => {
    setStatus("success");
    if (reduceMotion) {
      setForm(EMPTY_FORM);
      return;
    }
    const sent = form;
    setMails((ms) => {
      const cur = ms[ms.length - 1];
      return [
        { ...cur, phase: "sealing", frozen: sent },
        { id: cur.id + 1, phase: "waiting" },
      ];
    });
    setForm(EMPTY_FORM);
    const setOld = (ph) =>
      setMails((ms) => (ms.length > 1 ? [{ ...ms[0], phase: ph }, ...ms.slice(1)] : ms));
    const at = (ms, fn) => timers.current.push(setTimeout(fn, ms));
    at(SENT_TIMELINE.flying, () => setOld("flying"));
    at(SENT_TIMELINE.arriving, () => setPhase("arriving"));
    at(SENT_TIMELINE.settle, () => setMails((ms) => ms.slice(-1)));
    at(SENT_TIMELINE.open, () => setPhase("open"));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (status === "sending" || phase !== "open" || mails.length > 1) return;

    setStatus("sending");
    setErrorMessage("");

    if (FAKE_SEND_IN_DEV) {
      playSent();
      return;
    }

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

      playSent();
    } catch (err) {
      setStatus("error");
      setErrorMessage(err.message || contact.errorFallback);
    }
  };

  /* A folha (o formulário). A do envelope que está indo embora é uma cópia
     congelada do que foi escrito: sem ids (os do formulário vivo não podem
     repetir) e inerte. */
  const renderLetter = (values, frozen) => {
    const country = countries.find((c) => c.code === values.country) ?? countries[0];
    const idOf = (name) => (frozen ? undefined : name);
    const on = (fn) => (frozen ? noop : fn);
    const st = frozen ? "success" : status;
    return (
      <form
        className="contact__form mail__letter"
        onSubmit={frozen ? (e) => e.preventDefault() : handleSubmit}
        inert={frozen || undefined}
        aria-hidden={frozen || undefined}
      >
        <div className="contact__row">
          <div className="contact__field">
            <label htmlFor={idOf("firstName")}>{contact.firstName}</label>
            <input
              id={idOf("firstName")}
              name="firstName"
              type="text"
              autoComplete="given-name"
              required
              maxLength={80}
              value={values.firstName}
              onChange={on(handleChange)}
            />
          </div>
          <div className="contact__field">
            <label htmlFor={idOf("lastName")}>{contact.lastName}</label>
            <input
              id={idOf("lastName")}
              name="lastName"
              type="text"
              autoComplete="family-name"
              required
              maxLength={80}
              value={values.lastName}
              onChange={on(handleChange)}
            />
          </div>
        </div>

        <div className="contact__row">
          <div className="contact__field">
            <label htmlFor={idOf("phone")}>{contact.phone}</label>
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
                  value={values.country}
                  onChange={on(handleCountryChange)}
                >
                  {countries.map((c) => (
                    <option key={c.code} value={c.code}>
                      {c.name} (+{c.ddi})
                    </option>
                  ))}
                </select>
              </div>
              <input
                id={idOf("phone")}
                name="phone"
                type="tel"
                inputMode="numeric"
                autoComplete="tel-national"
                required
                maxLength={25}
                placeholder={phonePlaceholder(values.country)}
                value={values.phone}
                onChange={on(handlePhoneChange)}
              />
            </div>
          </div>
          <div className="contact__field">
            <label htmlFor={idOf("email")}>{contact.email}</label>
            <input
              id={idOf("email")}
              name="email"
              type="email"
              autoComplete="email"
              required
              maxLength={254}
              value={values.email}
              onChange={on(handleChange)}
            />
          </div>
        </div>

        <div className="contact__field contact__field--full">
          <label htmlFor={idOf("message")}>{contact.message}</label>
          <textarea
            id={idOf("message")}
            name="message"
            rows={5}
            required
            maxLength={5000}
            value={values.message}
            onChange={on(handleChange)}
          />
        </div>

        {/* honeypot — invisível e inalcançável por teclado pra quem usa o site de verdade */}
        {!frozen && (
          <input
            type="text"
            name="website"
            value={values.website}
            onChange={handleChange}
            className="contact__hp"
            tabIndex={-1}
            autoComplete="off"
            aria-hidden="true"
          />
        )}

        <div className="contact__form-footer">
          <button className="contact__submit" type="submit" disabled={st === "sending"}>
            {st === "sending" ? contact.submitting : contact.submit}
          </button>

          {st === "success" && (
            <p className="contact__status contact__status--ok" role={frozen ? undefined : "status"}>
              {contact.success}
            </p>
          )}
          {st === "error" && (
            <p className="contact__status contact__status--error" role="alert">
              {errorMessage} {contact.errorSuffix}{" "}
              <a href="mailto:marcelosg909@gmail.com">marcelosg909@gmail.com</a>
            </p>
          )}
        </div>
      </form>
    );
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
          (Contact.css, .mail). O envelope é só decoração. O que sai passa
          por cima e o que chega vem por trás, no mesmo lugar, até o antigo
          ir embora. */}
      <div className="mail-tilt" ref={tiltRef}>
        {mails.map((m, i) => (
          <Envelope
            key={m.id}
            phase={m.phase}
            next={i > 0}
            envRef={m.frozen ? undefined : envRef}
          >
            {renderLetter(m.frozen ?? form, !!m.frozen)}
          </Envelope>
        ))}
      </div>
    </section>
  );
}
