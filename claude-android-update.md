# Task Tracker — Dashboard UI Update Request
*Filed via Claude (mobile/Android) — 2026-08-09. Picked up by Claude for Windows via synced Drive folder.*

## Scope
Manager/admin dashboard only. The public kiosk page (date dropdown → tabs → checkboxes) is unaffected by everything below.

## 1. Saved Templates — consolidate into a dropdown
Current: "Saved templates" section lists each template separately (per `task_tracker_spec.md`'s "Reusable templates" entry — each with its own "Create list from template" action).

Change to:
- Single dropdown listing all saved templates by name.
- Selecting a template reveals: a **name** field (for the new list being created — this is the *list's* name, not a rename of the template itself), a **date** field, and a **Deploy** button.
- Deploy instantiates a new, all-unchecked task list from the template's shape (names + subtasks only, per existing spec behavior — no change to that underlying logic).
- Templates themselves are not renamed through this flow — template management (save/delete templates) stays wherever it currently lives, untouched.

## 2. Task list rollups — collapsible with rotating caret
- Each existing task list in the dashboard is collapsed by default behind a `>` caret.
- Clicking the caret rotates it to `^` (no built-in "downward" caret glyph available — use a CSS rotation transform on `>`, not a different character) and expands the list to show its full editing UI (task/subtask edit, add/remove, etc. — whatever the dashboard's current inline editing options are).
- **Accordion behavior:** expanding one task list collapses any other currently-open task list.

## 3. Audit Trail — nested rollup per task list
- Inside each task list's expanded view, add a second `>`/`^` caret labeled **"Audit Trail"**.
- Expanding it shows that list's audit log entries (check/uncheck actions + timestamps, per the existing append-only audit log).
- Nested under the task list accordion, not a separate top-level section.
- **Collapse behavior:** if a task list's Audit Trail is open and the manager expands a *different* task list (closing the first one via the accordion), the open Audit Trail collapses automatically along with its parent — it does not persist independently.

## Open items for Windows-Claude to flag if unclear
- Exact current markup/component structure of the dashboard's task list section (mobile Claude doesn't have full code access — working from `task_tracker_spec.md` only).
- Whether template save/delete UI needs any adjustment as a side effect of the dropdown consolidation (spec above assumes no).

Ask for clarification on anything above before implementing.
