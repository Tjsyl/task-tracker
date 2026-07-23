/* Small fetch wrapper shared by all pages. Cookies (session) go along automatically. */
const API_BASE = "/api";

async function apiFetch(path, options = {}) {
  const res = await fetch(API_BASE + path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || detail;
    } catch (_) { /* no json body */ }
    const err = new Error(detail);
    err.status = res.status;
    throw err;
  }
  if (res.status === 204) return null;
  return res.json();
}

const api = {
  get: (path) => apiFetch(path),
  post: (path, data) => apiFetch(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  patch: (path, data) => apiFetch(path, { method: "PATCH", body: JSON.stringify(data) }),
  delete: (path) => apiFetch(path, { method: "DELETE" }),
};
