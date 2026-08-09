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

// Accordion state for the "Task lists" section: at most one list expanded at
// a time, and at most one audit trail (nested inside the currently-expanded
// list) open at a time. Kept at module scope so it survives the full
// re-render that loadLists() does on every task edit/checkbox toggle.
let expandedListId = null;
let expandedAuditListId = null;

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
  item.draggable = true;

  const itemRow = document.createElement("div");
  itemRow.className = "item-row";

  const handle = document.createElement("span");
  handle.className = "drag-handle";
  handle.textContent = "☷";
  handle.title = "Drag to reorder";

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

  itemRow.append(handle, textInput, addSubBtn, removeBtn);

  const subtasksEl = document.createElement("div");
  subtasksEl.className = "task-builder-subtasks";
  enableDragReorder(subtasksEl, ".item-row");

  addSubBtn.addEventListener("click", () => addSubtaskBuilderRow(subtasksEl));

  item.append(itemRow, subtasksEl);
  taskBuilder.appendChild(item);
}

function addSubtaskBuilderRow(subtasksEl) {
  const row = document.createElement("div");
  row.className = "item-row";
  row.draggable = true;

  const handle = document.createElement("span");
  handle.className = "drag-handle";
  handle.textContent = "☷";
  handle.title = "Drag to reorder";

  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Subtask text";

  const removeBtn = document.createElement("button");
  removeBtn.type = "button";
  removeBtn.className = "small danger";
  removeBtn.textContent = "Remove";
  removeBtn.addEventListener("click", () => row.remove());

  row.append(handle, input, removeBtn);
  subtasksEl.appendChild(row);
}

document.getElementById("add-task-row-btn").addEventListener("click", addTaskBuilderRow);
enableDragReorder(taskBuilder, ".task-builder-item");

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
    expandedListId = null;
    expandedAuditListId = null;
    return;
  }
  // If the previously-expanded list was deleted (or this is a fresh load),
  // don't carry over stale accordion state.
  if (expandedListId !== null && !lists.some((l) => l.id === expandedListId)) {
    expandedListId = null;
    expandedAuditListId = null;
  }
  for (const list of lists) {
    listsContainer.appendChild(renderListCard(list));
  }
}

/* Each task list renders collapsed by default behind a `>` caret. Only one
   list is expanded at a time (accordion) -- expanding a list collapses
   whichever other one was open, and always closes any open Audit Trail
   rollup too (that's nested one level further in, see below). */
function renderListCard(list) {
  const wrap = document.createElement("div");
  wrap.className = "task-card";
  wrap.style.marginBottom = "1rem";

  const isExpanded = list.id === expandedListId;

  const headerRow = document.createElement("div");
  headerRow.className = "list-card-header";

  const caretBtn = document.createElement("button");
  caretBtn.type = "button";
  caretBtn.className = "caret-btn" + (isExpanded ? " expanded" : "");
  caretBtn.textContent = ">";
  caretBtn.setAttribute("aria-label", isExpanded ? "Collapse task list" : "Expand task list");
  caretBtn.addEventListener("click", () => {
    expandedListId = expandedListId === list.id ? null : list.id;
    expandedAuditListId = null; // accordion selection changed -- any open audit trail closes with it
    loadLists();
  });

  const summary = document.createElement("span");
  summary.innerHTML = `<strong>${escapeHtml(list.name)}</strong>
    <span style="color:var(--muted); font-size:0.85rem;"> &mdash; ${list.date} &middot; key: ${escapeHtml(list.list_key)} &middot; created by ${escapeHtml(list.created_by)}</span>`;

  headerRow.append(caretBtn, summary);
  wrap.appendChild(headerRow);

  const body = document.createElement("div");
  body.className = "list-card-body";
  body.style.display = isExpanded ? "block" : "none";
  wrap.appendChild(body);

  // ---- rename (name/date), lives in the expanded body ----
  const renameArea = document.createElement("div");
  body.appendChild(renameArea);

  function renderRenameView() {
    renameArea.innerHTML = "";
    const editBtn = mkButton("Edit name/date", renderRenameEdit);
    editBtn.classList.add("small");
    renameArea.appendChild(editBtn);
  }

  function renderRenameEdit() {
    renameArea.innerHTML = "";
    const form = document.createElement("form");
    form.className = "inline-form";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.required = true;
    nameInput.value = list.name;

    const dateInput = document.createElement("input");
    dateInput.type = "date";
    dateInput.required = true;
    dateInput.value = list.date;

    const saveBtn = document.createElement("button");
    saveBtn.type = "submit";
    saveBtn.className = "primary";
    saveBtn.textContent = "Save";

    const cancelBtn = mkButton("Cancel", renderRenameView);
    cancelBtn.type = "button";

    form.append(nameInput, dateInput, saveBtn, cancelBtn);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      try {
        const updated = await api.patch(`/manager/lists/${list.id}`, {
          name: nameInput.value.trim(),
          date: dateInput.value,
        });
        list.name = updated.name;
        list.date = updated.date;
        summary.innerHTML = `<strong>${escapeHtml(list.name)}</strong>
          <span style="color:var(--muted); font-size:0.85rem;"> &mdash; ${list.date} &middot; key: ${escapeHtml(list.list_key)} &middot; created by ${escapeHtml(list.created_by)}</span>`;
        renderRenameView();
      } catch (err) {
        alert("Couldn't save: " + err.message);
      }
    });
    renameArea.appendChild(form);
  }

  renderRenameView();

  const actions = document.createElement("div");
  actions.className = "row-actions";
  actions.style.margin = "0.5rem 0";

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
  actions.appendChild(saveTemplateBtn);
  actions.appendChild(deleteBtn);
  body.appendChild(actions);

  const tasksEl = document.createElement("div");
  tasksEl.className = "tasks-area";
  for (const task of list.tasks) {
    tasksEl.appendChild(buildTaskGroup(task));
  }
  enableDragReorder(tasksEl, ".task-group", async (ids) => {
    await api.patch(`/manager/lists/${list.id}/tasks/reorder`, { task_ids: ids });
  });
  body.appendChild(tasksEl);

  const addForm = document.createElement("form");
  addForm.className = "inline-form";
  addForm.innerHTML = `<input placeholder="New task text" required><button type="submit" class="primary">Add task</button>`;
  addForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = addForm.querySelector("input");
    await api.post(`/manager/lists/${list.id}/tasks`, { text: input.value.trim() });
    loadLists();
  });
  body.appendChild(addForm);

  // ---- nested "Audit Trail" rollup, inside this list's expanded body ----
  const isAuditExpanded = expandedAuditListId === list.id;

  const auditToggleRow = document.createElement("div");
  auditToggleRow.className = "audit-toggle-row";

  const auditCaretBtn = document.createElement("button");
  auditCaretBtn.type = "button";
  auditCaretBtn.className = "caret-btn" + (isAuditExpanded ? " expanded" : "");
  auditCaretBtn.textContent = ">";
  auditCaretBtn.tabIndex = -1; // the row itself is the click/focus target

  const auditLabel = document.createElement("span");
  auditLabel.className = "audit-toggle-label";
  auditLabel.textContent = "Audit Trail";

  const auditDiv = document.createElement("div");
  auditDiv.className = "audit-trail";
  auditDiv.style.display = isAuditExpanded ? "block" : "none";

  async function refreshAudit() {
    auditDiv.innerHTML = "Loading&hellip;";
    const entries = await api.get(`/manager/lists/${list.id}/audit`);
    auditDiv.innerHTML = renderAuditTable(entries);
  }

  auditToggleRow.addEventListener("click", async () => {
    if (expandedAuditListId === list.id) {
      expandedAuditListId = null;
      auditCaretBtn.classList.remove("expanded");
      auditDiv.style.display = "none";
      return;
    }
    expandedAuditListId = list.id;
    auditCaretBtn.classList.add("expanded");
    auditDiv.style.display = "block";
    await refreshAudit();
  });

  auditToggleRow.append(auditCaretBtn, auditLabel);
  body.append(auditToggleRow, auditDiv);

  if (isAuditExpanded) refreshAudit();

  return wrap;
}

/* One top-level task + its subtasks (if any), grouped in a single draggable
   wrapper so reordering top-level tasks moves a master and its subtasks
   together as one unit. Subtasks get their own nested drag-reorder scope. */
function buildTaskGroup(task) {
  const group = document.createElement("div");
  group.className = "task-group";
  group.draggable = true;
  group.dataset.taskId = task.id;

  group.appendChild(buildTaskRow(task));

  if (task.is_master) {
    const subtasksEl = document.createElement("div");
    subtasksEl.className = "subtasks-group";
    for (const sub of task.subtasks) {
      const subRow = buildTaskRow(sub, { isSubtask: true });
      subRow.draggable = true;
      subRow.dataset.taskId = sub.id;
      subtasksEl.appendChild(subRow);
    }
    enableDragReorder(subtasksEl, ".task-row", async (ids) => {
      await api.patch(`/manager/tasks/${task.id}/subtasks/reorder`, { task_ids: ids });
    });
    group.appendChild(subtasksEl);
  }

  return group;
}

/* Builds one task row (checkbox/label + actions). Doesn't touch subtasks --
   see buildTaskGroup for how a master + its subtasks are assembled. */
function buildTaskRow(task, { isSubtask = false } = {}) {
  const row = document.createElement("div");
  row.className = "task-row" + (task.checked ? " checked" : "") + (isSubtask ? " subtask-row" : "");

  const handle = document.createElement("span");
  handle.className = "drag-handle";
  handle.textContent = "☷";
  handle.title = "Drag to reorder";
  row.appendChild(handle);

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
  return row;
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
  templatesContainer.appendChild(renderTemplatePicker(templates));
}

/* Single dropdown listing every saved template by name. Selecting one
   reveals a name (for the new list, not a template rename)/date/Deploy
   form. Template save/delete stays available here too -- "Save as
   template" is still on each task list card (unchanged), and "Delete
   template" now lives next to Deploy since the old per-template card it
   used to live on no longer exists. */
function renderTemplatePicker(templates) {
  const wrap = document.createElement("div");

  const select = document.createElement("select");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select a template…";
  select.appendChild(placeholder);
  for (const t of templates) {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = t.name;
    select.appendChild(opt);
  }
  wrap.appendChild(select);

  const deployArea = document.createElement("div");
  deployArea.style.marginTop = "0.8rem";
  wrap.appendChild(deployArea);

  select.addEventListener("change", () => {
    deployArea.innerHTML = "";
    if (!select.value) return;
    const template = templates.find((t) => String(t.id) === select.value);
    deployArea.appendChild(renderDeployForm(template));
  });

  return wrap;
}

function renderDeployForm(template) {
  const form = document.createElement("form");
  form.className = "inline-form";

  const nameInput = document.createElement("input");
  nameInput.type = "text";
  nameInput.placeholder = "New list's name";
  nameInput.value = template.name;
  nameInput.required = true;

  const dateInput = document.createElement("input");
  dateInput.type = "date";
  dateInput.required = true;

  const deployBtn = document.createElement("button");
  deployBtn.type = "submit";
  deployBtn.className = "primary";
  deployBtn.textContent = "Deploy";

  const deleteBtn = mkButton("Delete template", async () => {
    if (!confirm(`Delete template "${template.name}"? This doesn't affect any lists already created from it.`)) return;
    await api.delete(`/manager/templates/${template.id}`);
    loadTemplates();
  }, true);
  deleteBtn.type = "button";
  deleteBtn.classList.add("small");

  form.append(nameInput, dateInput, deployBtn, deleteBtn);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
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

  return form;
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

// ---------- drag-to-reorder ----------

/* Generic HTML5 drag-and-drop reordering within `container`, moving whichever
   direct-child element (matching `itemSelector`) is dragged to wherever it's
   dropped, live, as it's dragged over other items.

   `onReorder(ids)` (optional) is called after a drop with the resulting
   ordered array of each item's `data-task-id`, in DOM order -- used to
   persist the new order via the reorder API endpoints. If omitted, this is
   purely a visual/DOM reorder (used by the pre-submit task builder, which
   just reads DOM order at submit time -- nothing to persist until then). */
function enableDragReorder(container, itemSelector, onReorder = null) {
  let dragEl = null;

  container.addEventListener("dragstart", (e) => {
    const item = e.target.closest(itemSelector);
    if (!item || item.parentElement !== container) {
      e.preventDefault();
      return;
    }
    // Stop here so a nested drag scope (e.g. reordering a master's subtasks)
    // doesn't also bubble up and get claimed by an ancestor scope (e.g. the
    // list's top-level task reorder) at the same time.
    e.stopPropagation();
    dragEl = item;
    item.classList.add("dragging");
    e.dataTransfer.effectAllowed = "move";
    try { e.dataTransfer.setData("text/plain", ""); } catch (_) { /* Firefox needs a no-op call */ }
  });

  container.addEventListener("dragend", () => {
    if (dragEl) dragEl.classList.remove("dragging");
    dragEl = null;
  });

  container.addEventListener("dragover", (e) => {
    if (!dragEl) return;
    e.preventDefault();
    const target = e.target.closest(itemSelector);
    if (!target || target === dragEl || target.parentElement !== container) return;
    const rect = target.getBoundingClientRect();
    const before = e.clientY - rect.top < rect.height / 2;
    const ref = before ? target : target.nextSibling;
    if (ref !== dragEl) container.insertBefore(dragEl, ref);
  });

  container.addEventListener("drop", (e) => {
    if (!dragEl) return; // this scope didn't own the drag (see dragstart's stopPropagation)
    e.preventDefault();
    e.stopPropagation();
    if (!onReorder) return;
    const ids = [...container.querySelectorAll(itemSelector)]
      .filter((el) => el.parentElement === container)
      .map((el) => Number(el.dataset.taskId));
    onReorder(ids).catch((err) => {
      alert("Couldn't save new order: " + err.message);
      loadLists();
    });
  });
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
