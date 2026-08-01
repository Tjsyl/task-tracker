# Family Task Tracker

A LAN-only, Docker-deployed household task tracker. 

## Stack
- **Backend:** FastAPI + SQLAlchemy + SQLite (`backend/`)
- **Frontend:** Static HTML/CSS/vanilla JS, no build step (`frontend/`)
- **Reverse proxy / static host:** Caddy
- **Packaging:** Docker Compose (backend + Caddy, two containers)

## Project layout
```
task-tracker/
  backend/
    app/
      main.py            # FastAPI app, router registration, startup DB init
      database.py         # SQLite engine/session
      models.py            # SQLAlchemy models: User, TaskList, Task, AuditLog, TaskListTemplate, TemplateTask
      schemas.py           # Pydantic request/response models
      auth.py               # PIN hashing, JWT session cookie, lockout logic
      crud.py                # Rollover / public-visibility logic, list_key generation
      routers/
        auth_router.py       # /api/auth/* -- login, logout, me
        public.py             # /api/public/* -- anonymous kiosk endpoints
        manager.py            # /api/manager/* -- list/task CRUD, templates, per-list audit
        admin.py               # /api/admin/* -- user management, full audit trail
    seed_users.py           # one-time script to create the admin + manager accounts
    requirements.txt
    Dockerfile
  frontend/
    index.html              # public kiosk view (date dropdown -> tabs -> checkboxes)
    login.html                # admin/manager login
    dashboard.html             # shared manager/admin dashboard (admin sees extra sections)
    css/style.css
    js/ (api.js, public.js, login.js, dashboard.js)
  Caddyfile
  docker-compose.yml
  .env.example
```

## Running it

1. Copy `.env.example` to `.env` and set a real random `TASK_TRACKER_SECRET_KEY`
   (used to sign session cookies):
   ```
   cp .env.example .env
   python3 -c "import secrets; print(secrets.token_hex(32))"   # paste into .env
   ```
2. Build and start:
   ```
   docker compose up --build -d
   ```
3. Create the two real accounts (one-time):
   ```
   docker compose exec backend python seed_users.py
   ```
   It'll prompt for an admin username/PIN and a manager username/PIN.
4. Visit `http://<this-machine's-LAN-IP>/` from any device on the network.
   - Kids: use the default page directly, no login.
   - You / your wife: click **Login** (top-right) with username + 6-digit PIN.

## Updating an existing deployment (backend code changed)

Icon/frontend-only changes take effect on refresh (frontend is bind-mounted).
Backend code changes -- like the master/subtask feature -- need an image
rebuild and a container recreate:

```
docker compose up --build -d
```

The backend also runs a tiny built-in migration on startup (see
`_run_lightweight_migrations` in `backend/app/main.py`) that adds any new
columns to existing tables automatically. Brand-new tables (like the
templates feature added) don't need that step at all -- `create_all()` makes
those on its own. Either way, no manual DB steps needed; your existing
lists/accounts are preserved.

## Running it on Unraid (Docker Compose Manager plugin)

No MariaDB or other DB container needed -- SQLite is embedded in the backend
container, which is enough for two real accounts on a household LAN. You just
need the two containers this compose file already defines: the custom-built
backend and Caddy.

1. Copy the whole `task-tracker/` folder onto the array, e.g. to
   `/mnt/user/appdata/task-tracker/` (via the Unraid file browser, an SMB
   share, or `scp`).
2. In **Compose Manager** (Docker tab → Compose Manager), add a new stack and
   point it at `/mnt/user/appdata/task-tracker/docker-compose.yml`.
3. Create a `.env` next to it (copy `.env.example`) and set:
   - `TASK_TRACKER_SECRET_KEY` to a real random string.
   - `TASK_TRACKER_PORT` if 8080 is already used by something else on your Unraid box.
   - `TASK_TRACKER_APPDATA` only if you didn't use `/mnt/user/appdata/task-tracker`.

   (The compose file already defaults the port to 8080 rather than 80/443,
   since Unraid's own web GUI owns those, and bind-mounts data under
   `appdata/task-tracker/` instead of a Docker-managed volume, so the SQLite
   file shows up in your normal appdata backups.)
4. Compose up the stack from the plugin's UI.
5. Seed the two accounts -- open a console on the `task-tracker-backend`
   container (from the Docker tab, or `docker exec -it task-tracker-backend
   python seed_users.py` from the Unraid terminal).
6. Visit `http://<unraid-ip>:8080/` (or whatever port you set).

## Notes on key design decisions
(See `task_tracker_spec.md` → **Resolved** section for full rationale.)

- **PIN security:** PINs are bcrypt-hashed at rest. After 5 failed login attempts,
  the account locks for 15 minutes (see `MAX_FAILED_ATTEMPTS` / `LOCKOUT_MINUTES`
  in `backend/app/auth.py`).
- **List naming:** the internal `name-date-time` key is only ever shown to
  manager/admin (in the dashboard); the public kiosk view shows just the plain name.
- **Rollover:** computed on-the-fly at request time (no cron/scheduler). A list
  drops off the public dropdown starting two days after it becomes fully checked;
  it stays in the database indefinitely for the audit trail either way.
- **Kids/audit:** no login or "who are you" prompt for the public view -- list
  names (e.g. "Kid1") identify whose tasks they are. Every check/uncheck is still
  timestamped in the append-only `audit_log` table.
- **Master/subtask tasks:** a task can have subtasks (one level of nesting only).
  A task with subtasks is a "master" -- no checkbox anywhere in the UI, and the
  API rejects direct toggles on it (400 error). Its checked/greyed-out state is
  derived from its subtasks and recomputed automatically any time a subtask is
  checked, unchecked, added, or removed (`crud.recompute_master_state`).
  Checking the last subtask logs an audit entry for the master too.
- **Templates:** "Save as template" on any list snapshots its current
  structure (task/subtask names only, no checked state or date) into a new
  `TaskListTemplate`. "Create list from template" in the Templates section
  instantiates a brand-new, all-unchecked `TaskList` from that snapshot for
  whatever name/date you give it. Templates and the lists made from them
  aren't linked after creation -- deleting one doesn't touch the other.

## Extending later
- The DB schema uses `Base.metadata.create_all()` plus a tiny hand-rolled
  startup migration (`main.py::_run_lightweight_migrations`) rather than a full
  migration tool (Alembic) -- fine at this scale, but worth switching to Alembic
  if the schema keeps growing or if changes get more complex than "add a column."
- `backend/app/crud.py::is_visible_on_public_dropdown` is the one function to
  touch if the rollover rule ever changes.
- `backend/app/crud.py::recompute_master_state` is the one function to touch if
  the master/subtask completion rule ever changes. This app only supports a
  single level of nesting by design (masters can't themselves be subtasks) --
  extending to deeper trees would mean recursing there and in the frontend's
  rendering code (`public.js`/`dashboard.js`).
- `backend/app/crud.py::copy_list_to_template` / `copy_template_to_list` are
  the tree-copy functions behind Save-as-template / Create-list-from-template,
  if that behavior ever needs to change (e.g. templates gaining their own
  editing UI instead of only being created by snapshotting a list).
