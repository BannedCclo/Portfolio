/* ===========================================================
   phone.js — DDI, máscara e placeholder do telefone, por país

   A lista de países, os DDIs e o formato de número de cada um vêm da
   libphonenumber-js (os mesmos metadados do Google usados no Android), então
   nada disso é mantido à mão. Os nomes dos países saem do Intl, no idioma do
   site.

   O placeholder segue o formato do exemplo de celular do país, com os
   dígitos trocados por 155 em binário (10011011), completado com zeros à
   esquerda — no Brasil fica (00) 01001-1011.
   =========================================================== */

import {
  AsYouType,
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  validatePhoneNumberLength,
} from "libphonenumber-js";
import examples from "libphonenumber-js/mobile/examples";

const BINARY_155 = (155).toString(2); // "10011011"

/** Países com DDI, ordenados pelo nome no idioma dado. */
export function countryOptions(lang) {
  const locale = lang === "en" ? "en" : "pt-BR";
  let names = null;
  try {
    names = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    // sem Intl.DisplayNames: fica o código ISO
  }
  return getCountries()
    .map((code) => ({
      code,
      ddi: getCountryCallingCode(code),
      name: names?.of(code) ?? code,
    }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

/** Formata o que foi digitado no padrão nacional do país, sem passar do
 *  tamanho máximo de número dele. */
export function formatPhone(raw, country) {
  let digits = raw.replace(/\D/g, "").slice(0, 17);
  while (digits && validatePhoneNumberLength(digits, country) === "TOO_LONG") {
    digits = digits.slice(0, -1);
  }
  if (!digits) return "";
  return new AsYouType(country).input(digits);
}

/** Placeholder no formato do país, com os dígitos de 155 em binário. */
export function phonePlaceholder(country) {
  const example = getExampleNumber(country, examples)?.formatNational();
  if (!example) return "";
  const count = example.replace(/\D/g, "").length;
  const digits = BINARY_155.padStart(count, "0").slice(-count);
  let i = 0;
  return example.replace(/\d/g, () => digits[i++]);
}
