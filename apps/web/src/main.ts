import "./styles.css";
import { readPublicConfig } from "./config.js";
import { renderLanding } from "./landing-view.js";

const app = document.querySelector<HTMLElement>("#app");
if (app === null) throw new Error("web_root_missing");

app.innerHTML = renderLanding(
  readPublicConfig({
    VITE_EXPERT_CHAT_URL: import.meta.env.VITE_EXPERT_CHAT_URL,
  }),
);
