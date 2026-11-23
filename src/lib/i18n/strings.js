/* ===========================================================
   i18n/strings.js — every UI string, in both languages.

   Content that's structurally identical across languages (project
   stack tags, tech names, phone number format) stays where it already
   lived (lib/projects.js, Stack.jsx); this file only holds free text
   that actually changes between pt and en.
   =========================================================== */

export const strings = {
  pt: {
    meta: {
      title: "Marcelo Guimarães",
      description: "Portfólio de Marcelo Guimarães, desenvolvedor de software.",
      ogLocale: "pt_BR",
    },
    loading: {
      label: "Carregando",
    },
    langSwitch: {
      groupLabel: "Idioma",
      toPt: "Português (selecionado)",
      toEn: "Mudar para inglês",
    },
    nav: {
      sobre: "Sobre",
      trabalho: "Experiência",
      stack: "Ferramentas",
      manifesto: "Metas",
      contato: "Contato",
    },
    hero: {
      eyebrow: "Portfólio",
      hint: "role para revelar",
      page0: {
        eyebrow: "Engenheiro de software — Brasil",
        titleBefore: "Produtos digitais onde ",
        em1: "engenharia",
        titleMid: " e ",
        em2: "UX",
        titleAfter: " andam de mãos dadas.",
        sub: "Construo produtos digitais onde ciência e forma andam juntas — do backend à última curva de uma animação.",
        cta: "Ver trabalho",
      },
      page1: {
        eyebrow: "Como eu penso",
        title:
          "Estar aberto ao aprendizado é a chave para elevar o nível de qualquer trabalho.",
      },
      page2: {
        eyebrow: "O que vem a seguir",
        title:
          "Nesse portfólio, você verá mais sobre a minha trajetória e o meu perfil.",
      },
    },
    about: {
      label: "Sobre",
      title: "Conheça a minha trajetória.",
      portraitAlt: "Retrato de Marcelo Guimarães",
      bio: [
        "Desde criança, sempre gostei de entender como as coisas funcionam. Por isso, acabei me interessando por programação, também incentivado por grandes referências da área que tenho na família.",
        "Hoje em dia, quanto mais eu aprendo, mais eu percebo que estou na área certa para mim, e que ainda tenho muito a aprender. Por isso, busco sempre me aprimorar, estudando, praticando e me inspirando em pessoas que admiro.",
      ],
    },
    work: {
      label: "Experiência",
      title: "Alguns projetos dos quais participei.",
      viewProject: "Ver projeto",
      githubAria: (name) => `Ver código de ${name} no GitHub`,
    },
    stack: {
      label: "Ferramentas",
      title: "Tecnologias que eu já utilizei.",
      groups: {
        languages: "Linguagens",
        frameworks: "Frameworks",
        databases: "Bancos de Dados",
        other: "Outros",
      },
    },
    manifesto: {
      label: "Metas",
      title: "O que eu busco agora?",
      tenets: [
        {
          before: "Encontrar um ambiente de trabalho onde eu possa ",
          em: "contribuir",
          after: " com as minhas ideias e habilidades.",
        },
        {
          before:
            "Aprender com pessoas mais experientes, que me desafiem a crescer e a ",
          em: "evoluir",
          after: " como profissional.",
        },
        {
          before:
            "Assumir novos desafios com garra e proatividade, buscando sempre ",
          em: "superar",
          after: " as expectativas e entregar o melhor resultado possível.",
        },
      ],
    },
    contact: {
      eyebrow: "Contato",
      titleLine1: "Vamos trabalhar",
      titleLine2: "juntos?",
      firstName: "Nome",
      lastName: "Sobrenome",
      phone: "Telefone",
      country: "País (DDI)",
      email: "Email",
      message: "Mensagem",
      submit: "Enviar mensagem",
      submitting: "Enviando…",
      success: "Mensagem enviada — retorno em breve.",
      errorDev:
        "O formulário só envia de verdade no site publicado (ou rodando `vercel dev` localmente) — `npm run dev` sozinho não serve a API.",
      errorProd: "O servidor respondeu de um jeito inesperado. Tente novamente em instantes.",
      errorFallback: "Não foi possível enviar sua mensagem agora.",
      errorSuffix: "Ou escreva direto:",
    },
    randomProject: {
      title: "Conheça outro projeto meu",
      cta: "Surpreenda-me",
      rolling: "sorteando…",
      hint: "um projeto ao acaso ↗",
      aria: "Rolar o dado e abrir um projeto aleatório em uma nova aba",
    },
    modelCredit: {
      before: "Modelo 3D do cérebro: Nevit Dilmen, ",
      source: "Wikimedia Commons",
      after: " (CC BY-SA 3.0 / GFDL)",
    },
  },

  en: {
    meta: {
      title: "Marcelo Guimarães",
      description: "Portfolio of Marcelo Guimarães, software engineer.",
      ogLocale: "en_US",
    },
    loading: {
      label: "Loading",
    },
    langSwitch: {
      groupLabel: "Language",
      toPt: "Switch to Portuguese",
      toEn: "English (selected)",
    },
    nav: {
      sobre: "About",
      trabalho: "Experience",
      stack: "Tools",
      manifesto: "Goals",
      contato: "Contact",
    },
    hero: {
      eyebrow: "Portfolio",
      hint: "scroll to reveal",
      page0: {
        eyebrow: "Software engineer — Brazil",
        titleBefore: "Digital products where ",
        em1: "engineering",
        titleMid: " and ",
        em2: "UX",
        titleAfter: " go hand in hand.",
        sub: "I build digital products where science and form move together — from the backend to the last curve of an animation.",
        cta: "View work",
      },
      page1: {
        eyebrow: "How I think",
        title:
          "Staying open to learning is the key to raising the bar on any work.",
      },
      page2: {
        eyebrow: "What's next",
        title:
          "In this portfolio, you'll see more about my journey and my profile.",
      },
    },
    about: {
      label: "About",
      title: "Get to know my journey.",
      portraitAlt: "Portrait of Marcelo Guimarães",
      bio: [
        "Ever since I was a kid, I've loved understanding how things work. That's how I ended up getting into programming, also encouraged by some great references in the field I have in my own family.",
        "Nowadays, the more I learn, the more I realize I'm in the right field for me, and that I still have a lot to learn. That's why I always strive to improve, studying, practicing, and drawing inspiration from people I admire.",
      ],
    },
    work: {
      label: "Experience",
      title: "Some of the projects I've worked on.",
      viewProject: "View project",
      githubAria: (name) => `View ${name}'s code on GitHub`,
    },
    stack: {
      label: "Tools",
      title: "Technologies I've worked with.",
      groups: {
        languages: "Languages",
        frameworks: "Frameworks",
        databases: "Databases",
        other: "Other",
      },
    },
    manifesto: {
      label: "Goals",
      title: "What am I looking for now?",
      tenets: [
        {
          before: "Finding a workplace where I can ",
          em: "contribute",
          after: " my ideas and skills.",
        },
        {
          before:
            "Learning from more experienced people who challenge me to grow and ",
          em: "evolve",
          after: " as a professional.",
        },
        {
          before:
            "Taking on new challenges with drive and initiative, always striving to ",
          em: "exceed",
          after: " expectations and deliver the best possible result.",
        },
      ],
    },
    contact: {
      eyebrow: "Contact",
      titleLine1: "Let's work",
      titleLine2: "together?",
      firstName: "First name",
      lastName: "Last name",
      phone: "Phone",
      country: "Country code",
      email: "Email",
      message: "Message",
      submit: "Send message",
      submitting: "Sending…",
      success: "Message sent — I'll get back to you soon.",
      errorDev:
        "The form only sends for real on the published site (or when running `vercel dev` locally) — `npm run dev` alone doesn't serve the API.",
      errorProd: "The server responded unexpectedly. Please try again shortly.",
      errorFallback: "Your message couldn't be sent right now.",
      errorSuffix: "Or email me directly:",
    },
    randomProject: {
      title: "Check out another project of mine",
      cta: "Surprise me",
      rolling: "rolling…",
      hint: "a random project ↗",
      aria: "Roll the dice and open a random project in a new tab",
    },
    modelCredit: {
      before: "3D brain model: Nevit Dilmen, ",
      source: "Wikimedia Commons",
      after: " (CC BY-SA 3.0 / GFDL)",
    },
  },
};
