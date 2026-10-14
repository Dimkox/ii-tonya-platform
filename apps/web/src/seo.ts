import { landingContent } from "./content.js";

const canonicalUrl = "https://ii-tonya.ru/";

export function renderStructuredData(): string {
  const { operator, faq } = landingContent;
  const graph = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": `${canonicalUrl}#website`,
        url: canonicalUrl,
        name: landingContent.brand,
        inLanguage: "ru",
      },
      {
        "@type": "Organization",
        "@id": `${canonicalUrl}#organization`,
        name: operator.name,
        url: canonicalUrl,
        email: operator.email,
        telephone: operator.phone,
        address: {
          "@type": "PostalAddress",
          streetAddress: "ул. А. Бебеля, 38",
          addressLocality: "Тамбов",
          postalCode: "392000",
          addressCountry: "RU",
        },
      },
      {
        "@type": "FAQPage",
        "@id": `${canonicalUrl}#faq`,
        mainEntity: faq.map(([question, answer]) => ({
          "@type": "Question",
          name: question,
          acceptedAnswer: {
            "@type": "Answer",
            text: answer,
          },
        })),
      },
    ],
  };

  return JSON.stringify(graph).replaceAll("<", "\\u003c");
}
