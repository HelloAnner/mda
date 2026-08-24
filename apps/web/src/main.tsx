import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./styles/tokens.css";
import "./styles/app.css";

const storedTheme = localStorage.getItem("mda.theme");
const prefersDark = matchMedia("(prefers-color-scheme: dark)").matches;
document.documentElement.className =
  storedTheme === "dark" || (!storedTheme && prefersDark) ? "dark" : "light";

const root = document.getElementById("root");
if (!root) throw new Error("MDA root element is missing");

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
