/* ===========================================================
   sections/work.js — the horizontal gallery

   Vertical scroll drives horizontal travel. Notably there is no GSAP `scrub`
   here: ScrollTrigger reports raw progress, and every smoothed quantity (the
   track's x, each card's tilt) is damped in the tick loop instead. One
   smoothing layer, the same one the rest of the page uses — stacking scrub on
   top of damp() would produce a soggy double lag.

   Procedural card artwork is painted by the <ProjectArt> component instead of
   from here — this module only owns the travel/tilt/keyboard behaviour.
   =========================================================== */

import { gsap, ScrollTrigger } from "../gsap.js";
import { clamp01, damp, isNear } from "../motion.js";
import { onTick } from "../ticker.js";

const reduceMotion = window.matchMedia(
  "(prefers-reduced-motion: reduce)",
).matches;

/* O pin da galeria vale em qualquer tela: a rolagem vertical anda a
   galeria na horizontal igual no celular, numa janela baixa ou no desktop.
   Em telas baixas os cards se comprimem para caber (Work.css, "cards em
   telas baixas"). "all" mantém o gsap.matchMedia abaixo — ele ainda cria e
   desfaz o trigger direitinho no resize. Só o movimento reduzido fica sem
   pin (faixa nativa, initReducedMotionTrack). */
const DESKTOP_QUERY = "all";
const isDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;

/** Movimento reduzido: sem pin, sem ScrollTrigger — a faixa é uma lista
 *  rolável nativa (ver reduced-motion.css). Só garante que ela comece do
 *  início: a ancoragem de rolagem antes do layout assentar pode deixá-la
 *  parada no fim no primeiro paint. */
function initReducedMotionTrack(track) {
  if (track) track.scrollLeft = 0;
  return () => {};
}

/** Called once from <Work>'s mount effect. Returns a cleanup. */
export function initWork() {
  const section = document.getElementById("trabalho");
  if (!section) return () => {};

  const pin = section.querySelector(".work__pin");
  const track = section.querySelector(".work__track");
  const cards = [...section.querySelectorAll(".proj")];

  if (reduceMotion) return initReducedMotionTrack(track);

  /* ---- pointer tilt, damped per card ---- */
  const tilt = new Map(cards.map((c) => [c, { x: 0, y: 0, tx: 0, ty: 0 }]));
  const pointerHandlers = [];
  for (const card of cards) {
    const onMove = (e) => {
      if (!isDesktop()) return;
      const r = card.getBoundingClientRect();
      const t = tilt.get(card);
      t.ty = ((e.clientX - r.left) / r.width - 0.5) * 7;
      t.tx = -((e.clientY - r.top) / r.height - 0.5) * 7;
    };
    const onLeave = () => {
      const t = tilt.get(card);
      t.tx = 0;
      t.ty = 0;
    };
    card.addEventListener("pointermove", onMove);
    card.addEventListener("pointerleave", onLeave);
    pointerHandlers.push({ card, onMove, onLeave });
  }

  /* ---- horizontal travel ---- */
  let targetX = 0;
  let x = 0;

  const maxScroll = () =>
    Math.max(0, track.scrollWidth - window.innerWidth);

  /* gsap.matchMedia creates and reverts the trigger for us, including on
     resize (see DESKTOP_QUERY: today it matches every screen). */
  const mm = gsap.matchMedia();
  mm.add(DESKTOP_QUERY, () => {
    let pinActive = false;

    const trigger = ScrollTrigger.create({
      trigger: section,
      start: "top top",
      // the full track width, plus a little breathing room so the last card
      // can settle before the pin releases
      end: () => "+=" + (maxScroll() + window.innerHeight * 0.6),
      pin: pin,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        targetX = -self.progress * maxScroll();
      },
      onToggle: (self) => {
        pinActive = self.isActive;
      },
    });

    /* Keyboard access. Tabbing to a card off to the right would normally do
       nothing useful: the track is moved with a transform, not scrolled, so
       the browser's own scroll-into-view has nothing to act on and the card
       stays out of frame. Translate the card's position along the track into
       a page scroll position instead, which is what actually drives it. */
    const onFocus = (e) => {
      const card = e.target.closest(".proj");
      if (!card) return;
      const m = maxScroll();
      if (!m) return;
      // where this card would need the track to sit to be comfortably in view
      const want = clamp01(
        (card.offsetLeft - window.innerWidth * 0.25) / m,
      );
      const start = trigger.start;
      const span = trigger.end - trigger.start;
      // Applied on the next frame so it lands after the browser's own
      // scroll-into-view for the newly focused element, which would otherwise
      // undo it. That default also tries to scroll .work__pin (overflow is
      // hidden, but it is still programmatically scrollable), which would
      // shift the content out from under the transform — so put it back.
      requestAnimationFrame(() => {
        pin.scrollLeft = 0;
        window.scrollTo({ top: start + want * span, behavior: "auto" });
      });
    };
    track.addEventListener("focusin", onFocus);

    /* Horizontal wheel/trackpad input while pinned. The pin already turns
       vertical scroll into horizontal travel; this is the same conversion
       run in reverse, so a two-finger horizontal swipe (or shift+wheel,
       which browsers already report as deltaX on their own) can drive the
       gallery directly instead of only ever riding along with the page's
       vertical scroll. Deltas dominated by deltaY are left alone so normal
       vertical scrolling isn't hijacked.

       Once the track is already sitting at the edge the gesture is pushing
       towards, the horizontal delta has nowhere left to go — but a pure
       horizontal swipe reports almost no deltaY for the handler to fall back
       on, and trackpads/mice tend to keep a gesture's axis locked to
       horizontal for the rest of that same fling. Leaving the event alone
       here used to mean the browser had nothing scrollable to apply deltaX
       to (the page has no horizontal overflow) and nothing usable in deltaY
       either, so the gesture just went dead right at the gallery's edge until
       the user released and started a fresh, vertical-only gesture. Instead,
       once maxed out, redirect the horizontal delta into a normal vertical
       scroll so the same gesture carries straight on past the section. */
    const onWheel = (e) => {
      if (!pinActive) return;
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      const m = maxScroll();
      if (!m) return;
      const atStart = targetX > -0.5 && e.deltaX < 0;
      const atEnd = targetX < -m + 0.5 && e.deltaX > 0;
      if (atStart || atEnd) {
        e.preventDefault();
        window.scrollBy(0, e.deltaX);
        return;
      }
      e.preventDefault();
      const span = trigger.end - trigger.start;
      window.scrollBy(0, e.deltaX * (span / m));
    };
    pin.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      track.removeEventListener("focusin", onFocus);
      pin.removeEventListener("wheel", onWheel);
      trigger.kill();
      targetX = 0;
      x = 0;
      track.style.transform = "";
    };
  });

  const unsubscribeTick = onTick((dt) => {
    if (!isNear(section, 0.5)) return;

    if (isDesktop()) {
      // Enquanto os cards ainda se formam a partir dos dígitos que descem da
      // linha do tempo (lib/binaryFlow.js marca data-cards-ready="0"), a
      // galeria fica parada no começo; prontos, ela desliza até onde a
      // rolagem já está, pelo mesmo damp(). Sem a marca (movimento reduzido,
      // ou o efeito não montou), anda normalmente.
      const cardsReady = section.dataset.cardsReady !== "0";
      x = damp(x, cardsReady ? targetX : 0, dt, 3.4);
      track.style.transform = `translate3d(${x.toFixed(2)}px,0,0)`;
    }

    // depth falloff: cards nearest the centre of the screen sit forward and
    // at full opacity, the rest recede — motion on three properties at once
    // rather than a flat slide
    const mid = window.innerWidth / 2;
    for (const card of cards) {
      const r = card.getBoundingClientRect();
      const d = Math.abs(r.left + r.width / 2 - mid) / mid;
      card.style.setProperty("--focus", clamp01(1 - d * 0.55).toFixed(3));

      const t = tilt.get(card);
      t.x = damp(t.x, t.tx, dt, 6);
      t.y = damp(t.y, t.ty, dt, 6);
      card.style.setProperty("--tilt-x", t.x.toFixed(2));
      card.style.setProperty("--tilt-y", t.y.toFixed(2));
    }
  });

  return () => {
    unsubscribeTick();
    mm.revert();
    for (const { card, onMove, onLeave } of pointerHandlers) {
      card.removeEventListener("pointermove", onMove);
      card.removeEventListener("pointerleave", onLeave);
    }
  };
}
