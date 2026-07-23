/* Manager/Admin dashboard. Admin-only sections are shown/hidden based on /auth/me role. */

const whoamiEl = document.getElementById("whoami");
const adminSection = document.getElementById("admin-section");
const globalAuditSection = document.getElementById("global-audit-section");
const listsContainer = document.getElementById("lists-container");
const usersContainer = document.getElementById("users-container");
const globalAuditContainer = document.getElementById("global-audit-container");

let currentRole = null;

async function init() {
  try {
    const me = await api.get("/auth/me");
    currentRole = me.role;
    whoamiEl.textContent = `${me.username} (${me.role})`;
  } catch (err) {
    window.location.href = "login.html";
    return;
  }

  if (currentRole === "admin") {
    adminSection.style.display = "block";
    globalAuditSection.style.display = "block";
    loadUsers();
    loadGlobalAudit();
  }

  loadLists();
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api.post("/auth/logout");
  window.location.href = "login.html";
});

// ---------- Task lists ----------

document.getElementById("create-list-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("new-list-name").value.trim();
  const date = document.getElementById("new-list-date").value;
  const tasksRaw = document.getElementById("new-list-tasks").value.trim();
  const task_texts = tasksRaw ? tasksRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];

  try {
    await api.post("/manager/lists", { name, date, task_texts });
    e.target.reset();
    loadLists();
  } catch (err) {
    alert("Couldn't create list: " + err.message);
  }
});

async function loadLists() {
  const lists = await api.get("/manager/lists");
  listsContainer.innerHTML = "";
  if (lists.length === 0) {
    listsContainer.innerHTML = `<p class="empty-state">No task lists yet.</p>`;
    return;
  }
  for (const list of lists) {
    listsContainer.appendChild(renderListCard(list));
  }
}

function renderListCard(list) {
  const wrap = document.createElement("div");
  wrap.className = "task-card";
  wrap.style.marginBottom = "1rem";

  const header = document.createElement("div");
  header.innerHTML = `<strong>${escapeHtml(list.name)}</strong>
    <span style="color:var(--muted); font-size:0.85rem;"> &mdash; ${list.date} &middot; key: ${escapeHtml(list.list_key)} &middot; created by ${escapeHtml(list.created_by)}</span>`;
  wrap.appendChild(header);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.style.margin = "0.5rem 0";

  const auditBtn = mkButton("View audit trail", () => toggleAudit(list.id, wrap));
  const deleteBtn = mkButton("Delete list", async () => {
    if (!confirm(`Delete list "${list.name}"? This cannot be undone.`)) return;
    await api.delete(`/manager/lists/${list.id}`);
    loadLists();
  }, true);
  actions.appendChild(auditBtn);
  actions.appendChild(deleteBtn);
  wrap.appendChild(actions);

  for (const task of list.tasks) {
    wrap.appendChild(renderTaskRow(task));
  }

  const addForm = document.createElement("form");
  addForm.className = "inline-form";
  addForm.innerHTML = `<input placeholder="New task text" required><button type="submit" class="primary">Add task</button>`;
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = addForm.querySelector("input");
    await api.post(`/manager/lists/${list.id}/tasks`, { text: input.value.trim() });
    loadLists();
  });
  wrap.appendChild(addForm);

  const auditDiv = document.createElement("div");
  auditDiv.className = "audit-trail";
  auditDiv.style.display = "none";
  auditDiv.dataset.listId = list.id;
  wrap.appendChild(auditDiv);

  return wrap;
}

function renderTaskRow(task) {
  const row = document.createElement("div");
  row.className = "task-row" + (task.checked ? " checked" : "");

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.checked;
  checkbox.addEventListener("change", async () => {
    await api.patch(`/manager/tasks/${task.id}`, { checked: checkbox.checked });
    row.classList.toggle("checked", checkbox.checked);
  });

  const label = document.createElement("span");
  label.className = "task-text";
  label.textContent = task.text;
  label.style.flex = "1";

  const editBtn = mkButton("Edit", async () => {
    const newText = prompt("Edit task text:", task.text);
    if (newText === null || newText.trim() === "") return;
    await api.patch(`/manager/tasks/${task.id}`, { text: newText.trim() });
    loadLists();
  });
  const deleteBtn = mkButton("Remove", async () => {
    if (!confirm("Remove this task?")) return;
    await api.delete(`/manager/tasks/${task.id}`);
    loadLists();
  }, true);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.appendChild(editBtn);
  actions.appendChild(deleteBtn);

  row.appendChild(checkbox);
  row.appendChild(label);
  row.appendChild(actions);
  return row;
}

async function toggleAudit(listId, cardEl) {
  const auditDiv = cardEl.querySelector(".audit-trail");
  if (auditDiv.style.display !== "none") {
    auditDiv.style.display = "none";
    return;
  }
  const entries = await api.get(`/manager/lists/${listId}/audit`);
  auditDiv.innerHTML = renderAuditTable(entries);
  auditDiv.style.display = "block";
}

function renderAuditTable(entries) {
  if (entries.length === 0) return `<p class="empty-state">No audit entries yet.</p>`;
  const rows = entries
    .map(
      (e) => `<tr><td>${escapeHtml(e.task_text)}</td><td>${e.action}</td><td>${new Date(e.timestamp + "Z").toLocaleString()}</td></tr>`
    )
    .join("");
  return `<table><thead><tr><th>Task</th><th>Action</th><th>When</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------- Admin: users ----------

async function loadUsers() {
  const users = await api.get("/admin/users");
  usersContainer.innerHTML = renderUsersTable(users);
  usersContainer.querySelectorAll("[data-reset-pin]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const pin = prompt("New 6-digit PIN:");
      if (!pin || !/^\d{6}$/.test(pin)) {
        if (pin !== null) alert("PIN must be exactly 6 digits.");
        return;
      }
      await api.patch(`/admin/users/${btn.dataset.resetPin}/pin`, { pin });
      alert("PIN updated.");
    });
  });
  usersContainer.querySelectorAll("[data-delete-user]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("Delete this user account?")) return;
      try {
        await api.delete(`/admin/users/${btn.dataset.deleteUser}`);
        loadUsers();
      } catch (err) {
        alert("Couldn't delete: " + err.message);
      }
    });
  });
}

function renderUsersTable(users) {
  const rows = users
    .map(
      (u) => `<tr>
        <td>${escapeHtml(u.username)}</td>
        <td><span class="tag ${u.role}">${u.role}</span></td>
        <td class="row-actions">
          <button data-reset-pin="${u.id}">Reset PIN</button>
          <button data-delete-user="${u.id}" class="danger">Delete</button>
        </td>
      </tr>`
    )
    .join("");
  return `<table><thead><tr><th>Username</th><th>Role</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table>`;
}

document.getElementById("create-user-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const username = document.getElementById("new-username").value.trim();
  const pin = document.getElementById("new-user-pin").value.trim();
  const role = document.getElementById("new-user-role").value;
  try {
    await api.post("/admin/users", { username, pin, role });
    e.target.reset();
    loadUsers();
  } catch (err) {
    alert("Couldn't create user: " + err.message);
  }
});

// ---------- Admin: global audit ----------

async function loadGlobalAudit() {
  const entries = await api.get("/admin/audit");
  if (entries.length === 0) {
    globalAuditContainer.innerHTML = `<p class="empty-state">No audit entries yet.</p>`;
    return;
  }
  const rows = entries
    .slice(0, 200)
    .map(
      (e) => `<tr><td>${escapeHtml(e.list_name)}</td><td>${escapeHtml(e.task_text)}</td><td>${e.action}</td><td>${new Date(e.timestamp + "Z").toLocaleString()}</td></tr>`
    )
    .join("");
  globalAuditContainer.innerHTML = `<table><thead><tr><th>List</th><th>Task</th><th>Action</th><th>When</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------- helpers ----------

function mkButton(label, onClick, danger = false) {
  const btn = document.createElement("button");
  btn.textContent = label;
  if (danger) btn.classList.add("danger");
  btn.addEventListener("click", onClick);
  return btn;
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

init();
