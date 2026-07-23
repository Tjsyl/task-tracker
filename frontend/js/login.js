const form = document.getElementById("login-form");
const errorEl = document.getElementById("error");

form.addEventListener("submit", async (e) => {
  e.preventDefault();
  errorEl.style.display = "none";
  const username = document.getElementById("username").value.trim();
  const pin = document.getElementById("pin").value.trim();

  try {
    await api.post("/auth/login", { username, pin });
    window.location.href = "dashboard.html";
  } catch (err) {
    errorEl.textContent = err.message;
    errorEl.style.display = "block";
  }
});
