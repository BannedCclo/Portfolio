/* ---------------------------------------------------------------
   contextGuard — o que fazer quando o navegador derruba um contexto WebGL

   Sem memória sobrando (celular, sobretudo iOS), o navegador descarta
   contextos WebGL — começando pelo mais antigo. O canvas morto fica pintado
   de branco, com um ícone de erro no canto, por cima da página. Aqui ele é
   escondido enquanto estiver perdido (o fundo escuro da página aparece no
   lugar) e volta quando o navegador restaura o contexto. O próprio
   WebGLRenderer já chama preventDefault() na perda (é o que permite a
   restauração) e recria o estado na volta.
   --------------------------------------------------------------- */

/**
 * @param {HTMLCanvasElement} canvas o canvas do WebGLRenderer
 * @returns {() => void} remove os ouvintes
 */
export function guardContextLoss(canvas) {
  const onLost = () => {
    canvas.style.visibility = "hidden";
  };
  const onRestored = () => {
    canvas.style.visibility = "";
  };
  canvas.addEventListener("webglcontextlost", onLost);
  canvas.addEventListener("webglcontextrestored", onRestored);
  return () => {
    canvas.removeEventListener("webglcontextlost", onLost);
    canvas.removeEventListener("webglcontextrestored", onRestored);
  };
}
