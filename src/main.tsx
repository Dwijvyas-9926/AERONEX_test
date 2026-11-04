import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/manrope";
import "@fontsource/saira-semi-condensed/400.css";
import "@fontsource/saira-semi-condensed/500.css";
import "@fontsource/saira-semi-condensed/600.css";
import "@fontsource/saira-semi-condensed/700.css";
import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/shell.css";
import "./styles/pages.css";
import App from "./app/App";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
