/// <reference types="vite/client" />

import ofertaSource from "./legal/oferta.txt?raw";
import policySource from "./legal/policy.txt?raw";

export type LegalDocumentCode = "oferta" | "privacy";

export function normalizeLegalDocument(source: string): string {
  return source
    .replace(/^\ufeff/u, "")
    .replaceAll("\r\n", "\n")
    .replaceAll("[reference:0]", "")
    .trim();
}

const normalizedOferta = normalizeLegalDocument(ofertaSource);
const ofertaStart = normalizedOferta.indexOf("ДОГОВОР-ОФЕРТА");

export const legalDocuments = {
  oferta: {
    title: "Договор-оферта",
    text:
      ofertaStart >= 0 ? normalizedOferta.slice(ofertaStart) : normalizedOferta,
  },
  privacy: {
    title: "Политика конфиденциальности",
    text: normalizeLegalDocument(policySource),
  },
} as const;
