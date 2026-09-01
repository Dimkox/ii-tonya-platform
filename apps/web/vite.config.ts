import { defineConfig, loadEnv, type Plugin } from "vite";
import { readPublicConfig } from "./src/config.js";
import { renderLanding } from "./src/landing-view.js";
import { injectLandingMarkup } from "./src/prerender.js";

function prerenderLanding(expertChatUrl?: string): Plugin {
  return {
    name: "ii-tonya-prerender-landing",
    enforce: "post",
    transformIndexHtml(document) {
      const config = readPublicConfig({
        VITE_EXPERT_CHAT_URL: expertChatUrl,
      });
      return injectLandingMarkup(document, renderLanding(config));
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "VITE_");
  return {
    plugins: [prerenderLanding(env.VITE_EXPERT_CHAT_URL)],
  };
});
