/* ===========================================================
   split.js — wraps every word so text can rise from behind a mask

   Each word becomes <span class="w"><span class="w__in">word</span></span>:
   .w clips, .w__in translates. Masking per word rather than per line is a
   deliberate choice — grouping words into line wrappers would mean cutting
   the DOM at line boundaries, which breaks any inline markup (<em>, <a>)
   that happens to straddle a line break. Words carry a --line index instead,
   so a per-line stagger still reads exactly like a line-by-line reveal while
   the original markup survives intact.

   This mutates DOM nodes directly rather than going through React state,
   which is normally a red flag inside a React tree. It's safe here because
   the target paragraph's content never changes after mount (no props/state
   drive it), so React never re-renders that subtree and never reconciles
   against it again — this runs once, from a useEffect, on a ref. splitWords
   is idempotent (guarded by data-split) so StrictMode's double-invoke in dev
   is harmless too.
   =========================================================== */

/** Replaces each text node's words with wrapped spans, in place. */
function wrapWords(node, out) {
  for (const child of [...node.childNodes]) {
    if (child.nodeType === Node.TEXT_NODE) {
      const text = child.textContent;
      if (!text.trim()) continue;
      const frag = document.createDocumentFragment();
      const parts = text.split(/(\s+)/);
      for (const part of parts) {
        if (!part) continue;
        if (/^\s+$/.test(part)) {
          frag.appendChild(document.createTextNode(" "));
          continue;
        }
        const outer = document.createElement("span");
        outer.className = "w";
        const inner = document.createElement("span");
        inner.className = "w__in";
        inner.textContent = part;
        outer.appendChild(inner);
        frag.appendChild(outer);
        out.push(outer);
      }
      child.replaceWith(frag);
    } else if (child.nodeType === Node.ELEMENT_NODE) {
      wrapWords(child, out);
    }
  }
}

/**
 * Splits an element's text into masked words and tags each with the visual
 * line it landed on (`--line`), so CSS can stagger by line.
 * Returns the number of lines found.
 */
export function splitWords(el) {
  if (el.dataset.split === "true") return Number(el.dataset.lines || 0);
  const words = [];
  wrapWords(el, words);

  // group by vertical position — offsetTop is stable once fonts are loaded,
  // which is why callers should await document.fonts.ready first
  let line = -1;
  let lastTop = null;
  for (const w of words) {
    const top = w.offsetTop;
    if (lastTop === null || Math.abs(top - lastTop) > 2) {
      line++;
      lastTop = top;
    }
    w.style.setProperty("--line", line);
  }
  setCols(words);

  el.dataset.split = "true";
  el.dataset.lines = String(line + 1);
  return line + 1;
}

/** Re-runs line grouping after a resize, where words may have reflowed. */
/** --col: posição da palavra dentro da própria linha (0, 1, 2…) */
function setCols(words) {
  let line = null;
  let col = 0;
  for (const w of words) {
    const l = w.style.getPropertyValue("--line");
    col = l === line ? col + 1 : 0;
    line = l;
    w.style.setProperty("--col", col);
  }
}

export function relineWords(el) {
  const words = el.querySelectorAll(":scope .w");
  let line = -1;
  let lastTop = null;
  for (const w of words) {
    const top = w.offsetTop;
    if (lastTop === null || Math.abs(top - lastTop) > 2) {
      line++;
      lastTop = top;
    }
    w.style.setProperty("--line", line);
  }
  setCols(words);
  el.dataset.lines = String(line + 1);
}
