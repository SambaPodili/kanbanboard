# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Layout

- `kanban/index.html`: the whole app, a single-page IT PMO Kanban board for internal demos and training. All markup, CSS and JS are in this one file.
- `mat/`: course reference material (a PDF). It is not code.

## Running

There is no build and no package manager. The only tests are the headless-Chrome UI harness in `.claude/ui-tests/` (see below). To run the app, open `kanban/index.html` in a browser. It must keep working from `file://`. For FormSubmit delivery testing, serving the folder can help, for example `python3 -m http.server` from inside `kanban/`, because a `file://` page has a `null` origin.

Headless check from the CLI (Chrome). On macOS, `--window-size` below about 500px is clamped, so to check the mobile layout, put the page in a 390px-wide iframe:
```
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --screenshot=out.png --window-size=1440,1100 file://$PWD/kanban/index.html
```
Syntax-check the script by extracting the `<script>` block and running `node --check` on it.

For a security and health check, use the `application-health` subagent (`.claude/agents/application-health.md`). It is read-only on the app, classifies findings as critical/high/medium/low/info, and writes a timestamped JSON report to `health-reports/`, which is git-ignored so reports never reach the public repo.

To test the UI, use the `ui-test-runner` subagent (`.claude/agents/ui-test-runner.md`). It runs `.claude/ui-tests/run.sh`, which injects `harness.js` into a temporary copy of the page and exercises every flow in headless Chrome (exit code 0 means all passed). It also takes desktop, tablet and phone screenshots and writes a JSON report to `ui-test-reports/`, which is git-ignored. You can run `run.sh` on its own for a quick check, or `run.sh --visible` to watch the tests run in a real Chrome window, with a live results panel and a highlight on each element. When you add a feature, add a test for it to `harness.js`.

## Hard constraints (from the original spec; do not break)

- Vanilla HTML/CSS/JS only, in a single file. No frameworks, CDNs, web fonts, image files or build step. Icons are Unicode or inline SVG and fonts use the system font stack.
- **No persistence.** Do not use localStorage, sessionStorage, IndexedDB or cookies. A refresh resets the board to the seed data on purpose, and the header tells users so.
- The only network call is the FormSubmit AJAX POST in `notifyNewTask()` to `FORMSUBMIT_ENDPOINT`, the config constant at the top of the `<script>`. The page must never navigate away, and a FormSubmit failure must never break the board. The failure warning toast is: "Card added locally — email notification failed".
- No `alert()` or `confirm()`. Form errors show inline, and deleting a card uses an inline "Delete? Yes / No" toggle.
- Neutral "UOB IT PMO" text wordmark with a corporate blue palette. Do not use real UOB logos or trademarks, and do not imitate official UOB systems.
- No `!important`. Colours and spacing come from CSS custom properties on `:root`.
- Accessibility: every input has a `<label for>`, icon-only buttons have an `aria-label`, the toast region is `aria-live="polite"`, and priority is shown as text as well as colour.

## Architecture (inside the `<script>`)

- **Single source of truth:** `state = { tasks, filters }`, plus `nextId` for the `UOB-ITPM-####` IDs. UI-only render state (`view`, `highlight`, `pendingDelete`, `focusAfterRender`, `inFlight`) lives in `ui`.
- **Re-render, don't mutate:** actions (`addTask`, `moveTask`, `deleteTask`) change `state` and then call `renderBoard()`. `renderBoard()` rebuilds all four columns from `STATUSES` using `renderCard()` HTML strings, then `renderSummary()`, which also rebuilds the Gantt timeline view (`renderTimeline()`). `applyView()` shows either the timeline or the board, based on `ui.view`. Don't change card contents directly in the DOM. The only direct DOM changes are the column drop-target and dragging classes, toasts, and form error text.
- **Escaping:** every interpolated value in the HTML strings must go through `escapeHtml()`.
- **Event delegation:** all card interactions (drag and drop, `data-action` buttons, the `.move-select` keyboard fallback) are delegated on `#board`, because cards are recreated on every render. To keep keyboard focus across re-renders, set `ui.focusAfterRender` to a selector before calling `renderBoard()`.
- **Dates:** use `toLocalISO()`, `todayISO()` and `addDays()`, which build `YYYY-MM-DD` from local date parts. Don't use `toISOString()`, because it is UTC and shifts dates by a day. Overdue means `dueDate < today && status !== "Done"`. Seed due dates are relative to today, so the demo always shows overdue cards.
- **Add flow is optimistic:** validate, `addTask()`, reset the form, close the dialog and show a toast, then `await notifyNewTask()` inside try/catch. `setSending()` keeps the submit button disabled and showing "Sending…" while a request is in flight. `notifyNewTask()` throws without making a request while the endpoint still holds the `YOUR_EMAIL@example.com` placeholder.
- **Overdue list:** `renderSummary()` keeps the `#open-overdue` button's count current. `renderOverdueList()` fills `#overdue-dialog` when it opens. `showOnBoard(id)` (shared with the timeline) switches to the board, clears any filters that hide the card, then highlights and focuses it.
- **Help popup:** `wireHelpPrompt()` opens `#help-dialog` once per page load after `HELP_PROMPT_DELAY_MS` of visible time, deferring while any other dialog is open. The delay and `SUPPORT_HOTLINE` are config constants next to `FORMSUBMIT_ENDPOINT`.
- **WhatsApp support:** `wireWhatsApp()` renders `SUPPORT_QUERIES` into `#wa-dialog` as `https://wa.me/<WHATSAPP_NUMBER>?text=…` links that open in a new tab with `rel="noopener noreferrer"`. They are user-clicked links, not requests made by the page, so the FormSubmit POST is still the only network call. The help popup waits while any dialog is open.
- The dropdown options come from the `PROJECTS`, `CATEGORIES`, `PRIORITIES` and `STATUSES` constants, which fill both the filter bar and the form. To add an option, edit the constant, not the markup.
