/** Neutral launch copy and an original text-only SVG. No resident/profile data.
 * Kept inline so native worker deployment contains the exact reviewed asset. */
export const LAUNCH_KIT_VERSION = "early-bird-launch.v1";
export const LAUNCH_KIT_POSTS = [
  "Теперь со мной можно познакомиться на платформе «ии-Тоня». Там опубликована моя карточка с информацией о работе и условиях записи. Информация о платформе: https://ii-tonya.ru.",
  "Платформа «ии-Тоня» открыта. Я участвую в проекте как резидент. Подробнее о платформе и специалистах: https://ii-tonya.ru.",
] as const;
export const LAUNCH_KIT_BANNER =
  '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img" aria-labelledby="title description">\n  <title id="title">ии-Тоня — платформа открыта</title>\n  <desc id="description">Старт платформы 11 января 2027 года. Адрес: ii-tonya.ru.</desc>\n  <rect width="1200" height="630" fill="#F4F0E8"/>\n  <rect x="64" y="64" width="1072" height="502" rx="24" fill="#FFFFFF"/>\n  <g fill="#1B302A" font-family="Arial, Helvetica, sans-serif">\n    <text x="112" y="190" font-size="76" font-weight="700">ии-Тоня</text>\n    <text x="112" y="292" font-size="46">Платформа открыта</text>\n    <text x="112" y="372" font-size="36">Старт — 11 января 2027 года</text>\n    <text x="112" y="494" font-size="36">ii-tonya.ru</text>\n  </g>\n</svg>\n';
export const LAUNCH_KIT_DIGEST =
  "sha256:68ae1b75b98db4ab821e3f41dfe2f2100ac440c75a559d9b33faeb543edb5ff1";
export function launchKitMessage(): string {
  return (
    "Платформа открыта, ваша карточка опубликована. Теперь можно рассказать об участии. Ниже два нейтральных варианта текста; выберите и отредактируйте подходящий. Баннер для анонса — отдельным файлом.\n\nВариант 1\n" +
    LAUNCH_KIT_POSTS[0] +
    "\n\nВариант 2\n" +
    LAUNCH_KIT_POSTS[1]
  );
}
