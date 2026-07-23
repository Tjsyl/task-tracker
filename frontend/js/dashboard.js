/* Manager/Admin dashboard. Admin-only sections are shown/hidden based on /auth/me role.

Tasks can have subtasks (single level only). A task with subtasks is a
"master": no checkbox of its own -- its checked state is derived server-side
from its subtasks, and greys out once every subtask is checked. */

const whoamiEl = document.getElementById("whoami");
const adminSection = document.getElementById("admin-section");
const globalAuditSection = document.getElementById("global-audit-section");
const listsContainer = document.getElementById("lists-container");
const templatesContainer = document.getElementById("templates-container");
const usersContainer = document.getElementById("users-container");
const globalAuditContainer = document.getElementById("global-audit-container");
const taskBuilder = document.getElementById("task-builder");

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
  loadTemplates();
}

document.getElementById("logout-btn").addEventListener("click", async () => {
  await api.post("/auth/logout");
  window.location.href = "login.html";
});

// ---------- Create-list task builder ----------

function addTaskBuilderRow() {
  const item = document.createElement("div");
  item.className = "task-builder-item";

  const itemRow = document.createElement("div");
  itemRow.className = "item-row";

  const textInput = document.createElement("input");
  textInput.type = "text";
  textInput.placeholder = "Task text (e.g. Morning routine)";

  const addSubBtn = document.createElement("button");
  addSubBtn.type = "button";
  addSubBtn.className = "small";
  addSubBtn.textContent = "+ Subtask";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "small danger";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => item.remove());

  itemRow.append(textInput, addSubBtn, removeBtn);

  const subtasksEl = document.createElement("div");
  subtasksEl.className = "task-builder-subtasks";

  addSubBtn.addEventListener("click", () => addSubtaskBuilderRow(subtasksEl));

  item.append(itemRow, subtasksEl);
  taskBuilder.appendChild(item);
}

function addSubtaskBuilderRow(subtasksEl) {
  const row = document.createElement("div");
  row.className = "item-row";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Subtask text";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "small danger";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => row.remove());

  row.append(input, removeBtn);
  subtasksEl.appendChild(row);
}

document.getElementById("add-task-row-btn").addEventListener("click", addTaskBuilderRow);

function collectTaskBuilderPayload() {
  const tasks = [];
  for (const item of taskBuilder.querySelectorAll(".task-builder-item")) {
    const text = item.querySelector(".item-row input[type=text]").value.trim();
    if (!text) continue;
    const subtasks = [...item.querySelectorAll(".task-builder-subtasks input[type=text]")]
      .map((i) => i.value.trim())
      .filter(Boolean);
    tasks.push({ text, subtasks });
  }
  return tasks;
}

document.getElementById("create-list-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = document.getElementById("new-list-name").value.trim();
  const date = document.getElementById("new-list-date").value;
  const tasks = collectTaskBuilderPayload();

  try {
    await api.post("/manager/lists", { name, date, tasks });
    e.target.reset();
    taskBuilder.innerHTML = "";
    loadLists();
  } catch (err) {
    alert("Couldn't create list: " + err.message);
  }
});

// ---------- Task lists ----------

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
  const saveTemplateBtn = mkButton("Save as template", async () => {
    const name = prompt("Template name:", list.name);
    if (!name || !name.trim()) return;
    try {
      await api.post(`/manager/lists/${list.id}/save-as-template`, { name: name.trim() });
      loadTemplates();
      alert(`Saved "${name.trim()}" as a template.`);
    } catch (err) {
      alert("Couldn't save template: " + err.message);
    }
  });
  const deleteBtn = mkButton("Delete list", async () => {
    if (!confirm(`Delete list "${list.name}"? This cannot be undone.`)) return;
    await api.delete(`/manager/lists/${list.id}`);
    loadLists();
  }, true);
  actions.appendChild(auditBtn);
  actions.appendChild(saveTemplateBtn);
  actions.appendChild(deleteBtn);
  wrap.appendChild(actions);

  for (const task of list.tasks) {
    appendTaskBlock(wrap, task);
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

/* Appends one task row to `container` -- and, if it's a master, its subtask
   rows right after it (indented, one level only). */
function appendTaskBlock(container, task, { isSubtask = false } = {}) {
  const row = document.createElement("div");
  row.className = "task-row" + (task.checked ? " checked" : "") + (isSubtask ? " subtask-row" : "");

  if (!task.is_master) {
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = task.checked;
    checkbox.addEventListener("change", async () => {
      try {
        await api.patch(`/manager/tasks/${task.id}`, { checked: checkbox.checked });
        loadLists(); // reload so a parent master row (if any) picks up its derived state
      } catch (err) {
        alert("Couldn't save: " + err.message);
        checkbox.checked = !checkbox.checked;
      }
    });
    row.appendChild(checkbox);
  }

  const label = document.createElement("span");
  label.className = "task-text" + (task.is_master ? " master-text" : "");
  label.textContent = task.text;
  label.style.flex = "1";
  row.appendChild(label);

  const rowActions = document.createElement("div");
  rowActions.className = "row-actions";

  const editBtn = mkButton("Edit", async () => {
    const newText = prompt("Edit task text:", task.text);
    if (newText === null || newText.trim() === "") return;
    await api.patch(`/manager/tasks/${task.id}`, { text: newText.trim() });
    loadLists();
  });
  rowActions.appendChild(editBtn);

  if (!isSubtask) {
    const addSubBtn = mkButton("+ Subtask", async () => {
      const text = prompt("Subtask text:");
      if (!text || !text.trim()) return;
      try {
        await api.post(`/manager/tasks/${task.id}/subtasks`, { text: text.trim() });
        loadLists();
      } catch (err) {
        alert("Couldn't add subtask: " + err.message);
      }
    });
    addSubBtn.classList.add("small");
    rowActions.appendChild(addSubBtn);
  }

  const deleteBtn = mkButton(
    "Remove",
    async () => {
      const msg = task.is_master ? "Remove this task and all its subtasks?" : "Remove this task?";
      if (!confirm(msg)) return;
      await api.delete(`/manager/tasks/${task.id}`);
      loadLists();
    },
    true
  );
  rowActions.appendChild(deleteBtn);

  row.appendChild(rowActions);
  container.appendChild(row);

  if (task.is_master) {
    for (const sub of task.subtasks) {
      appendTaskBlock(container, sub, { isSubtask: true });
    }
  }
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
      (e) => `<tr><td>${escapeHtml(e.task_text)}${e.is_master ? ' <span class="tag">master</span>' : ""}</td><td>${e.action}</td><td>${new Date(e.timestamp + "Z").toLocaleString()}</td></tr>`
    )
    .join("");
  return `<table><thead><tr><th>Task</th><th>Action</th><th>When</th></tr></thead><tbody>${rows}</tbody></table>`;
}

// ---------- Templates ----------

async function loadTemplates() {
  const templates = await api.get("/manager/templates");
  templatesContainer.innerHTML = "";
  if (templates.length === 0) {
    templatesContainer.innerHTML = `<p class="empty-state">No templates saved yet. Use "Save as template" on any task list above.</p>`;
    return;
  }
  for (const template of templates) {
    templatesContainer.appendChild(renderTemplateCard(template));
  }
}

function renderTemplateCard(template) {
  const wrap = document.createElement("div");
  wrap.className = "task-card";
  wrap.style.marginBottom = "1rem";

  const taskSummary = template.tasks
    .map((t) => (t.subtasks.length ? `${t.text} (${t.subtasks.length} subtask${t.subtasks.length === 1 ? "" : "s"})` : t.text))
    .join(", ") || "(no tasks)";

  const header = document.createElement("div");
  header.innerHTML = `<strong>${escapeHtml(template.name)}</strong>
    <span style="color:var(--muted); font-size:0.85rem;"> &mdash; ${escapeHtml(taskSummary)}</span>`;
  wrap.appendChild(header);

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.style.margin = "0.5rem 0";

  const deleteBtn = mkButton("Delete template", async () => {
    if (!confirm(`Delete template "${template.name}"? This doesn't affect any lists already created from it.`)) return;
    await api.delete(`/manager/templates/${template.id}`);
    loadTemplates();
  }, true);
  actions.appendChild(deleteBtn);
  wrap.appendChild(actions);

  const createForm = document.createElement("form");
  createForm.className = "inline-form";
  createForm.innerHTML = `
    <input type="text" placeholder="List name" value="${escapeHtml(template.name)}" required>
    <input type="date" required>
    <button type="submit" class="primary">Create list from template</button>
  `;
  createForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const [nameInput, dateInput] = createForm.querySelectorAll("input");
    try {
      await api.post(`/manager/templates/${template.id}/create-list`, {
        name: nameInput.value.trim(),
        date: dateInput.value,
      });
      loadLists();
      alert(`Created list "${nameInput.value.trim()}".`);
    } catch (err) {
      alert("Couldn't create list from template: " + err.message);
    }
  });
  wrap.appendChild(createForm);

  return wrap;
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
      (e) => `<tr><td>${escapeHtml(e.list_name)}</td><td>${escapeHtml(e.task_text)}${e.is_master ? ' <span class="tag">master</span>' : ""}</td><td>${e.action}</td><td>${new Date(e.timestamp + "Z").toLocaleString()}</td></tr>`
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
