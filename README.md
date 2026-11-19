# Portfólio — Marcelo Guimarães

Projeto React + Vite.

```bash
npm install
npm run dev       # http://localhost:5173
npm run build     # gera dist/
npm run preview   # serve o build de produção localmente
```

---

## Onde editar o conteúdo

O site é bilíngue (pt/en, alternado pelo `LanguageSwitcher` e lembrado em
`localStorage`). Todo texto de interface fica no dicionário
`src/lib/i18n/strings.js`; o que é dado estruturado fica perto de quem usa:

| O que | Arquivo |
|---|---|
| Textos de todas as seções (manifesto, bio, títulos, formulário, metadados da página) | `src/lib/i18n/strings.js` |
| Projetos (ano, nome, resultado, stack, link, captura) — usados pela seção Trabalho e pelo botão de projeto aleatório do rodapé | `src/lib/projects.js` (+ imagens em `src/assets/projects/`) |
| Ferramentas | `src/sections/Stack.jsx` (array `STACK_GROUPS`; nomes dos grupos no dicionário) |
| Trajetória | `src/sections/About.jsx` (array `TIMELINE` + `INSTITUTION_LINKS`) |
| Retrato | `src/assets/eu/retrato.jpg` |
| Contato | `api/contact.js` — ver [Formulário de contato](#formulário-de-contato) abaixo |

Os comentários `CONTEÚDO PLACEHOLDER` que ainda restam em `About.jsx` e
`Stack.jsx` são da primeira versão; o conteúdo atrás deles já é real.

---

## Formulário de contato

O site é estático — não tem autorização pra mandar email em nome de quem
preenche o formulário (isso exigiria ser dono do domínio de origem do
remetente, nunca o caso pro email de um visitante qualquer). Por isso
`api/contact.js` (uma Vercel Function, não faz parte do bundle do Vite) manda
o email sempre de uma conta sua para você mesmo — o remetente do formulário só
aparece no corpo da mensagem e no `Reply-To`, então responder o email já vai
direto pra ele.

Configuração necessária (uma vez):

1. Crie uma conta em [resend.com](https://resend.com) e gere uma API key.
2. No painel da Vercel do projeto: **Settings → Environment Variables**, crie
   `RESEND_API_KEY` com essa chave (Production e Preview).
3. Sem domínio próprio verificado no Resend, o remetente cai no sandbox deles
   (`onboarding@resend.dev`) — funciona, mas normalmente só entrega pro email
   dono da conta Resend (que é o seu caso aqui, já que o destino é você
   mesmo). Se depois verificar um domínio no Resend, aponte `CONTACT_FROM_EMAIL`
   (mesma tela de env vars) pra um endereço desse domínio.

As duas variáveis (`RESEND_API_KEY` obrigatória, `CONTACT_FROM_EMAIL`
opcional) são lidas em `api/contact.js`; não há `.env.example` no repo.

**Dev local:** `npm run dev` (Vite puro) não serve `api/`, então o formulário
vai dar erro de rede ao tentar enviar. Pra testar de verdade localmente, use a
Vercel CLI: `npx vercel link` (uma vez) e depois `npx vercel dev` — isso serve
o site *e* a function juntos, lendo as env vars do projeto vinculado.

---

## Estrutura

```
index.html                    entrada do Vite — só <div id="root"> e o script
api/
  contact.js                   Vercel Function — envia o email do formulário de contato (Resend)
src/
  main.jsx                    bootstrap (StrictMode, scrollRestoration, LanguageProvider)
  App.jsx                     compõe a página inteira
  styles/
    tokens.css                cores, escala tipográfica, espaçamento, easing
    base.css                  reset, nav, rodapé, chrome de seção
    reduced-motion.css        carregado por último, vence os outros
  lib/                        utilitários agnósticos de framework
    motion.js                 a linguagem de movimento (leia isto primeiro)
    ticker.js                 um RAF para toda animação de DOM
    split.js                  quebra texto em palavras mascaradas
    artwork.js                arte procedural dos cards, semeada pelo nome
    gsap.js                   único ponto de registro dos plugins do GSAP
    projects.js               lista de projetos (fonte única p/ Work e RandomProjectButton)
    i18n/                     LanguageContext (pt/en, título/meta da página) + strings.js
    debugPanel.js             diagnóstico temporário, só com ?debug na URL
    sections/*.js             comportamento de manifesto/trabalho/stack/sobre
  three/
    stage.js                  um canvas WebGL para a página inteira + diretor de atos
    acts/hero.js               o cérebro
    acts/finale.js             o cérebro de volta, no contato
  components/                 Stage, Nav, Spine, ProjectArt
    LoadingScreen             cobre a página até o cérebro carregar (onStageReady)
    LanguageSwitcher          alternância pt/en
    RandomProjectButton       dado do rodapé que sorteia um projeto
    footer/, signature/       módulo compartilhado Assets/Footer, com a paleta daqui
    animatedLogo/             o logo da marca desenhando-se (Assets/Logo)
  assets/logo/dark/           SVGs do logo (animatedLogo lê via ?raw; versão -en)
  assets/projects/            capturas dos projetos
  assets/eu/                  retrato da seção Sobre
  sections/                   um componente + um .css por seção
tools/
  bake-brain.mjs               brain.stl → public/assets/brain.glb + brain-low.glb (rodar só se a malha mudar)
assets-source/
  brain.stl                    fonte do baker, 4,1 MB — não vai para o build
public/assets/
  brain.glb                    malha completa (1,2 MB)
  brain-low.glb                malha reduzida (270 KB), escolhida pelo tier de qualidade
                               (tipo de ponteiro) — ver three/stage.js e acts/hero.js
  favicon.svg, og.png
```

---

## Por que React aqui, especificamente

O 3D e a coreografia de scroll continuam **imperativos** — Three.js e GSAP
ScrollTrigger não ganham nada sendo reescritos em `@react-three/fiber` ou
controlados por estado do React, e fazer isso adicionaria uma camada de
reconciliação exatamente onde o código já precisa rodar a 60fps de forma
previsível. Por isso `src/three/` e `src/lib/sections/*.js` são módulos comuns,
sem JSX — cada componente de seção só faz `useEffect(() => initX(), [])` e
descarta a função de cleanup que `initX()` devolve.

Essa função de cleanup existe porque, em desenvolvimento, o `<StrictMode>`
roda todo efeito duas vezes de propósito (monta → limpa → monta de novo) para
expor efeitos que não são idempotentes. Sem uma limpeza correta, isso
duplicaria pins do ScrollTrigger, listeners de ponteiro e `IntersectionObserver`s
— cada `initX()` neste projeto foi escrito já esperando por isso.

---

## As três regras de movimento

Estão em `src/lib/motion.js` e valem para qualquer seção nova. São elas que
fazem a página inteira parecer uma peça só em vez de um herói bonito seguido
de seções genéricas:

1. **Nunca ligue uma propriedade visual direto ao scroll.** O scroll define o
   *alvo*; o valor renderizado persegue esse alvo com `damp()`. É isso que
   sobrevive a um scroll rápido sem parecer mecânico.
2. **Nunca anime um eixo sozinho.** Toda transição move duas ou três
   propriedades juntas. Movimento de eixo único lê como carrossel.
3. **Transições longas e sobrepostas**, não passos discretos — use
   `sampleCurve()` com keyframes que se sobrepõem.

Corolário de performance: escreva os valores amortecidos em CSS custom
properties uma vez por frame e deixe o CSS aplicar. Não anime centenas de
elementos direto do JS — nem via `style.setProperty`, nem via `setState`.

---

## Detalhes que não são óbvios

- **Um canvas só.** Todo o 3D da página desenha no mesmo `#stage`, montado uma
  vez por `<Stage>` e nunca desmontado. Seções registram "atos" via
  `registerAct()`/`unregisterAct()`; o diretor atualiza só os que estão perto e
  **pula o render inteiro** quando nenhum está na tela.
- **`act.wantsRender`** existe porque a seção do herói continua a menos de uma
  viewport do manifesto muito depois da sequência dele acabar — sem isso o
  cérebro reaparece atrás do texto seguinte.
- **A galeria não usa `scrub`.** O ScrollTrigger reporta progresso cru e o
  amortecimento é feito no ticker. Empilhar `scrub` sobre `damp()` dá lag duplo.
- **`scroll-behavior: smooth` está desligado de propósito** — briga com os pins
  do ScrollTrigger. Os âncoras da nav usam o `ScrollToPlugin` do GSAP.
- **`src/lib/split.js` mexe no DOM na mão dentro de um componente React** — e isso é
  intencional, não um descuido. O parágrafo alvo nunca muda depois do mount
  (sem props/estado dirigindo seu conteúdo), então o React nunca reconcilia
  aquele subtree de novo; `splitWords()` é idempotente (guardado por
  `data-split`), então mesmo a dupla chamada do `StrictMode` é inofensiva.
- **O cérebro vem pronto.** Orientação, corte do bulbo, solda, suavização de
  Taubin, centralização e escala são assados por `tools/bake-brain.mjs`
  (`npm run bake-brain`). Isso tudo rodava no navegador, na main thread, a
  cada carregamento, antes de virar um passo offline.
- **Atribuição obrigatória.** O modelo do cérebro é de Nevit Dilmen (Wikimedia
  Commons, CC BY-SA 3.0 / GFDL). O crédito abaixo do rodapé (`src/App.jsx`)
  é condição da licença — não remova.
- **O rodapé é um módulo de fora.** Ele vem de `Assets/Footer` (estrutura e
  classes intactas); esta cópia só troca cor por token de `styles/tokens.css`,
  com o valor original como fallback. Ao ressincronizar com o asset, reaplique
  essa camada em vez de sobrescrever o arquivo direto.
- **O logo do rodapé se desenha.** `components/animatedLogo` mede cada traço do
  SVG em runtime (`getTotalLength()`) e reparte a duração entre eles, então o
  ritmo do desenho não muda com o tamanho na tela. A coreografia é a mesma que
  vive em `Assets/Logo/preview/` — o que muda aqui é só de onde vem o markup.

---

## Verificação

- Redimensione abaixo de 820px: a galeria horizontal vira uma pilha vertical.
  Não é opcional — scroll horizontal em celular e trackpad é hostil.
- Ligue "reduzir movimento" no sistema: todos os pins somem, o conteúdo fica em
  fluxo normal e a galeria vira uma grade.
- Navegue só com Tab pela galeria: o foco arrasta a página junto com os cards.
- `npm run build` deve terminar sem erros; o aviso de chunk >500kB é esperado
  (Three.js + GSAP + React) e não é um bug.
