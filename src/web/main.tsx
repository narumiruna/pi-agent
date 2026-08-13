import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./App.js";
import "./i18n.js";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource/ibm-plex-mono/400.css";
import "@radix-ui/colors/amber.css";
import "@radix-ui/colors/amber-dark.css";
import "@radix-ui/colors/red.css";
import "@radix-ui/colors/red-dark.css";
import "@radix-ui/colors/teal.css";
import "@radix-ui/colors/teal-dark.css";
import "@radix-ui/themes/styles.css";
import "./styles.css";

const root = document.getElementById("root");
if (!root) throw new Error("Missing #root element");
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
