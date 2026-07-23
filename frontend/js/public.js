/* Public kiosk view: date dropdown -> tabs -> checkbox list. No auth. */

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
      const row = document.createElement("div");
      row.className = "task-row" + (task.checked ? " checked" : "");

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.checked = task.checked;
      checkbox.addEventListener("change", () => toggleTask(task.id, row));

      const label = document.createElement("span");
      label.className = "task-text";
      label.textContent = task.text;
      label.addEventListener("click", () => {
        checkbox.checked = !checkbox.checked;
        toggleTask(task.id, row);
      });

      row.appendChild(checkbox);
      row.appendChild(label);
      card.appendChild(row);
    }
  }
  taskAreaEl.appendChild(card);
}

async function toggleTask(taskId, rowEl) {
  try {
    const updated = await api.post(`/public/tasks/${taskId}/toggle`);
    rowEl.classList.toggle("checked", updated.checked);
    // Keep in-memory state in sync so re-render (e.g. tab switch) stays correct.
    const list = currentLists.find((l) => l.id === activeListId);
    const task = list.tasks.find((t) => t.id === taskId);
    if (task) task.checked = updated.checked;
  } catch (err) {
    alert("Couldn't save that change: " + err.message);
  }
}

dateSelect.addEventListener("change", onDateChange);
loadDates();
