/* Dark mode toggle, shared by every page. The actual flash-of-wrong-theme
prevention happens via a tiny inline script in each page's <head> (runs
before first paint, applies the saved theme immediately) -- this file just
wires up the toggle button and keeps localStorage in sync afterward. */

function currentTheme() {
  return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
}

function applyTheme(theme) {
  if (theme === "dark") {
    document.documentElement.setAttribute("data-theme", "dark");
  } else {
    document.documentElement.removeAttribute("data-theme");
  }
  localStorage.setItem("theme", theme);
  updateToggleLabel();
}

function updateToggleLabel() {
  const btn = document.getElementById("theme-toggle-btn");
  if (!btn) return;
  btn.textContent = currentTheme() === "dark" ? "Light mode" : "Dark mode";
}

document.addEventListener("DOMContentLoaded", () => {
  const btn = document.getElementById("theme-toggle-btn");
  if (!btn) return;
  updateToggleLabel();
  btn.addEventListener("click", () => {
    applyTheme(currentTheme() === "dark" ? "light" : "dark");
  });
});
