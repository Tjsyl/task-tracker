/* Public kiosk view: date dropdown -> tabs -> checkbox list. No auth.

A task with subtasks is a "master": it has no checkbox of its own. Its
greyed-out/struck-through state is derived server-side from whether all of
its subtasks are checked, and toggling a subtask may flip the master --
the server tells us via the `parent` field on the toggle response. */

const dateSelect = document.getElementById("date-select");
const tabsEl = document.getElementById("tabs");
const taskAreaEl = document.getElementById("task-area");
const homeBtn = document.getElementById("home-btn");

let currentLists = [];
let activeListId = null;

function resetToHome() {
  dateSelect.value = "";
  tabsEl.innerHTML = "";
  taskAreaEl.innerHTML = "";
  currentLists = [];
  activeListId = null;
}

homeBtn.addEventListener("click", resetToHome);

async function loadDates() {
  const dates = await api.get("/public/dates");
  // Absent dates just don't appear -- no placeholder text, per spec.
  for (const { date } of dates) {
    const opt = document.createElement("option");
    opt.value = date;
    opt.textContent = new Date(date + "T00:00:00").toLocaleDateString(undefined, {
      weekday: "short", month: "short", day: "numeric",
    });
    dateSelect.appendChild(opt);
  }
}

async function onDateChange() {
  const date = dateSelect.value;
  tabsEl.innerHTML = "";
  taskAreaEl.innerHTML = "";
  if (!date) return;

  currentLists = await api.get(`/public/lists?for_date=${encodeURIComponent(date)}`);
  if (currentLists.length === 0) {
    taskAreaEl.innerHTML = `<p class="empty-state">No task lists for this date.</p>`;
    return;
  }
  renderTabs();
  selectList(currentLists[0].id);
}

function renderTabs() {
  tabsEl.innerHTML = "";
  for (const list of currentLists) {
    const tab = document.createElement("div");
    tab.className = "tab" + (list.id === activeListId ? " active" : "");
    tab.textContent = list.name;
    tab.addEventListener("click", () => selectList(list.id));
    tabsEl.appendChild(tab);
  }
}

function selectList(listId) {
  activeListId = listId;
  renderTabs();
  renderTasks();
}

function renderTasks() {
  const list = currentLists.find((l) => l.id === activeListId);
  taskAreaEl.innerHTML = "";
  if (!list) return;

  const card = document.createElement("div");
  card.className = "task-card";

  if (list.tasks.length === 0) {
    card.innerHTML = `<p class="empty-state">No tasks on this list yet.</p>`;
  } else {
    for (const task of list.tasks) {
      card.appendChild(renderTaskRow(task));
      if (task.is_master) {
        for (const sub of task.subtasks) {
          card.appendChild(renderTaskRow(sub, { indented: true }));
        }
      }
    }
  }
  taskAreaEl.appendChild(card);
}

function renderTaskRow(task, { indented = false } = {}) {
  const row = document.createElement("div");
  row.className = "task-row" + (task.checked ? " checked" : "") + (indented ? " subtask-row" : "");
  row.dataset.taskId = task.id;

  if (task.is_master) {
    // Master tasks are derived-only -- no checkbox, just the label.
    const label = document.createElement("span");
    label.className = "task-text master-text";
    label.textContent = task.text;
    row.appendChild(label);
    return row;
  }

  const checkbox = document.createElement("input");
  checkbox.type = "checkbox";
  checkbox.checked = task.checked;
  checkbox.addEventListener("change", () => toggleTask(task.id));

  const label = document.createElement("span");
  label.className = "task-text";
  label.textContent = task.text;
  label.addEventListener("click", () => {
    checkbox.checked = !checkbox.checked;
    toggleTask(task.id);
  });

  row.appendChild(checkbox);
  row.appendChild(label);
  return row;
}

async function toggleTask(taskId) {
  try {
    const { task: updated, parent } = await api.post(`/public/tasks/${taskId}/toggle`);
    applyTaskUpdate(updated);
    if (parent) applyTaskUpdate(parent);
  } catch (err) {
    alert("Couldn't save that change: " + err.message);
  }
}

/* Patches in-memory state + the matching DOM row for a task (leaf or master)
   returned from the server, without re-fetching or re-rendering everything. */
function applyTaskUpdate(updated) {
  const list = currentLists.find((l) => l.id === activeListId);
  if (!list) return;

  for (const top of list.tasks) {
    if (top.id === updated.id) {
      top.checked = updated.checked;
    } else {
      const sub = top.subtasks.find((s) => s.id === updated.id);
      if (sub) sub.checked = updated.checked;
    }
  }

  const rowEl = taskAreaEl.querySelector(`[data-task-id="${updated.id}"]`);
  if (rowEl) {
    rowEl.classList.toggle("checked", updated.checked);
    const checkbox = rowEl.querySelector("input[type=checkbox]");
    if (checkbox) checkbox.checked = updated.checked;
  }
}

dateSelect.addEventListener("change", onDateChange);
loadDates();
