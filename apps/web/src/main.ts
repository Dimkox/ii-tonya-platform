import "./styles.css";

const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("web_root_missing");

app.innerHTML = `
  <section class="preview" aria-labelledby="preview-title">
    <p class="eyebrow">Сервис персонального сопровождения</p>
    <h1 id="preview-title">Привет, я ии-Тоня</h1>
    <p>Помогу сориентироваться в сервисе и выбрать следующий шаг.</p>
  </section>
`;
