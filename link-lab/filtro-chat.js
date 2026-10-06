(() => {
  "use strict";

  /* Filtro de palabras del chat del lobby.

     Tapa con asteriscos las palabras de una lista fija (español e inglés).
     Se aplica tres veces: al enviar, cuando el anfitrión reparte el mensaje
     y al mostrarlo. Así un navegador modificado que se salte la primera no
     evita las otras dos.

     Es una barrera, no una garantía: se esquiva con espacios, con otra
     ortografía o con palabras que no están en la lista. Para lo que el
     filtro no pare están SILENCIAR, DENUNCIAR y la opción de sala de
     desactivar el chat. */

  const PALABRAS = [
    /* español */
    "puta", "puto", "putas", "putos", "putita", "hijoputa", "hijueputa", "gilipollas", "gilipolla", "cabron", "cabrona", "cabrones",
    "mierda", "mierdas", "joder", "jodete", "jodido", "coño", "polla", "pollas", "zorra", "zorras", "maricon", "maricona", "maricones",
    "marica", "subnormal", "subnormales", "retrasado", "retrasada", "imbecil", "imbeciles", "idiota", "idiotas", "capullo", "capulla",
    "pendejo", "pendeja", "pendejos", "culero", "culera", "chingar", "chingada", "chingate", "verga", "pinche", "mamon", "mamona",
    "malparido", "malparida", "gonorrea", "boludo", "pelotudo", "pelotuda", "conchatumadre", "follar", "follate", "violar",
    "violacion", "matate", "suicidate", "nazi", "nazis", "sudaca", "sudacas", "negrata",
    /* inglés */
    "fuck", "fucks", "fucker", "fucking", "fucked", "motherfucker", "shit", "shits", "shitty", "bitch", "bitches", "asshole", "assholes",
    "bastard", "cunt", "cunts", "dick", "dicks", "cock", "cocks", "pussy", "slut", "sluts", "whore", "whores", "faggot", "fag", "fags",
    "retard", "retarded", "nigger", "niggers", "nigga", "rape", "rapist", "kys", "wanker", "twat"
  ];

  /* Cada carácter del texto se lleva a su letra base, uno a uno, para que las
     posiciones no se muevan: á -> a, 0 -> o, @ -> a, $ -> s... */
  const BASE = { á: "a", à: "a", ä: "a", â: "a", é: "e", è: "e", ë: "e", ê: "e", í: "i", ì: "i", ï: "i", î: "i", ó: "o", ò: "o", ö: "o", ô: "o",
    ú: "u", ù: "u", ü: "u", û: "u", "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "@": "a", $: "s" };
  const base = (c) => { const m = c.toLowerCase(); return BASE[m] || m; };
  const esLetra = (c) => /[a-zñç]/.test(c);

  /* Una palabra de la lista casa aunque se alarguen sus letras ("puuuta"),
     pero solo como palabra entera: "computadora" no lleva nada tapado. */
  const patrones = PALABRAS.map((palabra) => new RegExp([...palabra].map((c) => base(c).replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "+").join(""), "g"));

  function limpia(texto) {
    const original = String(texto ?? "");
    const normal = [...original].map(base).join("");
    if (normal.length !== original.length) return original;   /* caracteres fuera del plano básico: no se toca */
    const tapar = new Array(original.length).fill(false);
    for (const patron of patrones) {
      patron.lastIndex = 0;
      let m;
      while ((m = patron.exec(normal))) {
        const ini = m.index, fin = ini + m[0].length;
        const antes = ini > 0 ? normal[ini - 1] : " ", despues = fin < normal.length ? normal[fin] : " ";
        if (!esLetra(antes) && !esLetra(despues)) for (let i = ini; i < fin; i++) tapar[i] = true;
        if (m[0].length === 0) patron.lastIndex++;
      }
    }
    return [...original].map((c, i) => (tapar[i] ? "*" : c)).join("");
  }

  window.ML3DFiltroChat = { limpia };
})();
