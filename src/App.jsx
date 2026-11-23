import { useEffect } from "react";
import Stage from "./components/Stage.jsx";
import LoadingScreen from "./components/LoadingScreen.jsx";
import Nav from "./components/Nav.jsx";
import ScrollProgress from "./components/ScrollProgress.jsx";
import Footer from "./components/footer/footer";
import AnimatedLogo from "./components/animatedLogo/animatedLogo";
import RandomProjectButton from "./components/RandomProjectButton.jsx";
import Hero from "./sections/Hero.jsx";
import Manifesto from "./sections/Manifesto.jsx";
import Work from "./sections/Work.jsx";
import Stack from "./sections/Stack.jsx";
import About from "./sections/About.jsx";
import Contact from "./sections/Contact.jsx";
import { useLanguage } from "./lib/i18n/LanguageContext.jsx";
import { ScrollTrigger } from "./lib/gsap.js";
import { initBinaryFlow } from "./lib/binaryFlow.js";

export default function App() {
  const { lang, s } = useLanguage();

  /* Generic scroll reveal for anything tagged .fade-in, page-wide — mirrors
     the original main.js's single page-level observer rather than one per
     section. Safe to query the whole document here: React commits the entire
     tree's DOM before any effect runs, and child effects fire before this
     parent one, so every section's .fade-in elements already exist by the
     time this runs.

     Re-runs on [lang] too: Manifesto remounts on language change (see its
     key={lang} below), which gives its .fade-in header a brand-new DOM node
     this observer never saw — re-querying the whole document picks it back
     up. Re-observing an already-revealed element elsewhere is harmless: it's
     still intersecting, so the callback re-adds a class it already has and
     unobserves it again. */
  useEffect(() => {
    const revealer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            revealer.unobserve(entry.target);
          }
        }
      },
      { threshold: 0.15 },
    );
    document.querySelectorAll(".fade-in").forEach((el) => revealer.observe(el));
    return () => revealer.disconnect();
  }, [lang]);

  /* A corrente de 0s e 1s que liga a linha do tempo (Sobre) aos cards de
     projeto (Trabalho) — precisa das duas seções montadas, por isso vive
     aqui e não no efeito de uma delas. */
  useEffect(() => initBinaryFlow(), []);

  /* Swapping languages changes text length everywhere at once, which can
     shift layout (card heights, the timeline's rail length, the work
     gallery's track width) out from under every ScrollTrigger's cached
     start/end. Two rAFs so this runs after the browser has actually painted
     the new text, not just after React has committed it. */
  useEffect(() => {
    let raf1 = requestAnimationFrame(() => {
      raf1 = requestAnimationFrame(() => ScrollTrigger.refresh());
    });
    return () => cancelAnimationFrame(raf1);
  }, [lang]);

  return (
    <>
      <LoadingScreen />
      <Stage />
      <Nav />
      <ScrollProgress />
      <Hero />
      <About />
      <Work />
      <Stack />
      {/* key={lang} forces a full remount on language change: Manifesto's
          text is split into masked word spans by lib/split.js, which mutates
          the DOM directly and guards itself with a one-shot dataset flag —
          it would never re-split (or clean up) the old-language markup on a
          plain re-render. Remounting is the cheap, correct reset. */}
      <Manifesto key={lang} />
      <Contact />
      {/* O logo do footer é a versão horizontal de traço claro (Assets/Logo →
          dark/horizontal): é a forma que cabe numa faixa larga e centrada como
          a do topo do footer, e o traço #F1F1F1 é o próprio --ink do site. Ela
          se desenha ao entrar na viewport — ver components/animatedLogo. */}
      <Footer logo={<AnimatedLogo lang={lang} />} backgroundColor="var(--bg)">
        <RandomProjectButton />
        <p className="footer-copy">© 2026 Marcelo Guimarães</p>
      </Footer>
      {/* Attribution required by the brain model's licence — do not remove */}
      <p className="model-credit">
        {s.modelCredit.before}
        <a
          href="https://commons.wikimedia.org/wiki/File:3DPX-003765_3DModel_of_Brain_Nevit_Dilmen.stl"
          target="_blank"
          rel="noopener"
        >
          {s.modelCredit.source}
        </a>
        {s.modelCredit.after}
      </p>
    </>
  );
}
