/* UI test harness for index.html.
 *
 * run.sh appends this file as a <script> after the app's own script in a
 * temporary copy of the page.
 *
 * Headless mode (default): Chrome runs it with a virtual-time budget; results
 * are written as base64 JSON to <html data-ui-results="…"> for run.sh to read.
 *
 * Visible mode (run.sh --visible, sets window.__UI_TEST_VISUAL = true): a live
 * test panel docks on the left, a highlight box follows each element the test
 * touches, steps are slowed down so a person can watch, and a "Download JSON
 * report" button appears at the end.
 *
 * The app's top-level const/let bindings (state, ui, form, dialog, …) are
 * visible here because both are classic scripts in the same page.
 * Never ship this file with the app; the Pages workflow only publishes index.html.
 */
(() => {
  "use strict";

  const VISUAL = window.__UI_TEST_VISUAL === true;
  const STEP_MS = 650; // pause per visible step

  const results = [];
  const errors = [];
  const startedAt = new Date();
  window.addEventListener("error", e => errors.push(String(e.message || e)));
  window.addEventListener("unhandledrejection", e => errors.push("Unhandled rejection: " + String(e.reason)));

  const $ = sel => document.querySelector(sel);
  const $$ = sel => Array.from(document.querySelectorAll(sel));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const tick = () => wait(0);

  /* ------------------------------------------------------------
     Visible mode: panel + highlight (top-layer popovers, so they
     stay above modal dialogs)
     ------------------------------------------------------------ */
  let panel, list, caption, bar, hl;
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  function buildPanel() {
    panel = document.createElement("div");
    panel.setAttribute("popover", "manual");
    panel.setAttribute("role", "log");
    panel.setAttribute("aria-label", "UI test run");
    panel.style.cssText = [
      "inset:16px auto auto 16px", "margin:0", "width:360px", "height:calc(100vh - 32px)", "max-height:none", "padding:0", "border:0",
      "border-radius:14px", "background:#0f2740", "color:#fff",
      "font:13px/1.45 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif",
      "box-shadow:0 20px 60px rgba(0,0,0,.45)", "display:flex", "flex-direction:column", "overflow:hidden",
    ].join(";");
    panel.innerHTML = `
      <div style="padding:14px 16px 10px;border-bottom:1px solid rgba(255,255,255,.15)">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px">
          <strong style="font-size:15px">UI test run</strong>
          <span data-count style="color:rgba(255,255,255,.7)">0 / 0</span>
        </div>
        <div style="height:6px;border-radius:99px;background:rgba(255,255,255,.15);margin-top:8px;overflow:hidden">
          <div data-bar style="height:100%;width:0;background:#2fb57a;transition:width .3s"></div>
        </div>
        <div data-caption style="margin-top:10px;min-height:38px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.08);color:#ffd58a">Starting…</div>
      </div>
      <ol data-list style="list-style:none;margin:0;padding:8px 8px 12px;overflow-y:auto;flex:1;min-height:0"></ol>
      <div data-foot style="padding:12px 16px;border-top:1px solid rgba(255,255,255,.15);display:none"></div>`;
    document.body.appendChild(panel);
    list = panel.querySelector("[data-list]");
    caption = panel.querySelector("[data-caption]");
    bar = panel.querySelector("[data-bar]");

    hl = document.createElement("div");
    hl.setAttribute("popover", "manual");
    hl.setAttribute("aria-hidden", "true");
    hl.style.cssText = "margin:0;padding:0;border:3px solid #2f80ed;border-radius:8px;background:rgba(47,128,237,.12);" +
      "box-shadow:0 0 0 4px rgba(47,128,237,.25);pointer-events:none;position:fixed;inset:auto;transition:all .25s ease;";
    document.body.appendChild(hl);
    panel.showPopover();
  }

  function toFront() {
    // Re-showing moves a popover to the top of the top layer (above any modal)
    if (panel.matches(":popover-open")) panel.hidePopover();
    panel.showPopover();
  }

  function setCaption(text) { if (VISUAL) caption.textContent = text; }

  // Show what the test is about to do, point at the element, then pause
  async function step(text, el) {
    if (!VISUAL) return;
    setCaption(text);
    if (el && el.getBoundingClientRect) {
      el.scrollIntoView({ block: "center", inline: "nearest" });
      await wait(50);
      const r = el.getBoundingClientRect();
      Object.assign(hl.style, { left: (r.left - 6) + "px", top: (r.top - 6) + "px", width: (r.width + 12) + "px", height: (r.height + 12) + "px" });
      if (hl.matches(":popover-open")) hl.hidePopover();
      hl.showPopover();
    } else if (hl.matches(":popover-open")) {
      hl.hidePopover();
    }
    toFront();
    await wait(STEP_MS);
  }

  // Visible countdown for long waits (help popup delay)
  async function waitWithCountdown(ms, label) {
    if (!VISUAL) return wait(ms);
    const end = Date.now() + ms;
    while (Date.now() < end) {
      setCaption(`${label}… ${Math.ceil((end - Date.now()) / 1000)} s`);
      await wait(Math.min(250, end - Date.now()));
    }
  }

  function rowFor(area, name) {
    const li = document.createElement("li");
    li.style.cssText = "display:grid;grid-template-columns:22px 1fr;gap:6px;padding:6px 8px;border-radius:8px;background:rgba(255,255,255,.06);margin-bottom:4px";
    li.innerHTML = `<span data-icon>⏳</span><span><span style="color:rgba(255,255,255,.6)">${esc(area)}</span><br>${esc(name)}<span data-detail style="display:block;color:#ffb4b4"></span></span>`;
    list.appendChild(li);
    li.scrollIntoView({ block: "nearest" });
    return li;
  }

  function updateCounts() {
    const passed = results.filter(r => r.passed).length;
    panel.querySelector("[data-count]").textContent = `${passed} passed · ${results.length - passed} failed`;
    bar.style.width = Math.round((results.length / TOTAL_TESTS) * 100) + "%";
    if (results.some(r => !r.passed)) bar.style.background = "#ff6b6b";
  }

  /* ------------------------------------------------------------
     Test runner
     ------------------------------------------------------------ */
  const TOTAL_TESTS = 24;

  // area: which part of the UI; severity if it fails: critical | high | medium | low
  async function test(area, name, severity, fn) {
    const row = VISUAL ? rowFor(area, name) : null;
    const t0 = performance.now();
    let entry;
    try {
      const detail = await fn();
      entry = { area, name, severity, passed: true, detail: detail || "", ms: Math.round(performance.now() - t0) };
    } catch (err) {
      entry = { area, name, severity, passed: false, detail: String(err && err.message || err), ms: Math.round(performance.now() - t0) };
    }
    results.push(entry);
    if (VISUAL) {
      row.querySelector("[data-icon]").textContent = entry.passed ? "✅" : "❌";
      if (!entry.passed) {
        row.style.background = "rgba(255,90,90,.18)";
        row.querySelector("[data-detail]").textContent = `${severity.toUpperCase()}: ${entry.detail}`;
      }
      updateCounts();
    }
    // Leave no dialog open for the next test
    $$("dialog[open]").forEach(d => d.close());
  }
  function assert(cond, msg) { if (!cond) throw new Error(msg); }
  function eq(actual, expected, msg) {
    if (actual !== expected) throw new Error(`${msg}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
  function columnOf(id) {
    const card = $(`.card[data-id="${CSS.escape(id)}"]`);
    return card ? card.closest(".column").dataset.status : null;
  }
  function toastTexts() { return $$("#toasts .toast").map(t => t.textContent.trim()); }
  async function fillForm(values) {
    for (const [name, value] of Object.entries(values)) {
      form.elements[name].value = value;
      if (VISUAL) await step(`Filling in ${name}: ${String(value).slice(0, 40)}`, form.elements[name]);
    }
  }
  async function showBoard() {
    const btn = $('[data-view="board"]');
    if (!btn.getAttribute("aria-pressed") || btn.getAttribute("aria-pressed") === "false") await step("Switching to the Board view", btn);
    btn.click();
  }

  async function run() {
    if (VISUAL) buildPanel();
    const startedTasks = state.tasks.length;

    // ---------- Help popup (runs first: it waits while any dialog is open)
    await test("Help popup", "Not shown before the delay", "medium", async () => {
      await waitWithCountdown(Math.max(0, HELP_PROMPT_DELAY_MS - 3000), "Waiting for the help popup (should stay closed)");
      assert(!$("#help-dialog").open, "help popup opened too early");
    });
    await test("Help popup", "Shown after the delay with the hotline", "medium", async () => {
      await waitWithCountdown(3500, "Waiting for the help popup to open");
      assert($("#help-dialog").open, "help popup did not open after the delay");
      await step("Help popup is open: checking the hotline", $("#help-hotline"));
      eq($("#help-hotline").textContent, SUPPORT_HOTLINE, "hotline text");
      assert($("#help-hotline").getAttribute("href").startsWith("tel:"), "hotline is not a tel: link");
      await step("Clicking Got it", $("#dismiss-help"));
      $("#dismiss-help").click();
      assert(!$("#help-dialog").open, "Got it did not close the popup");
    });

    // ---------- Initial render
    await test("Render", "Seed tasks rendered in four columns", "critical", async () => {
      await step("Checking the seed tasks and columns", $("#board"));
      eq(startedTasks, 8, "seed task count");
      eq($$(".column").length, STATUSES.length, "column count");
      eq($$(".card").length, 8, "card count");
      STATUSES.forEach(s => assert($(`.column[data-status="${s.name}"]`), `missing column ${s.name}`));
    });
    await test("Render", "Summary counts match the data", "high", async () => {
      await step("Checking the summary counts", $(".summary"));
      eq(Number($("#sum-total").textContent), state.tasks.length, "total");
      STATUSES.forEach(s => eq(Number($("#sum-" + slug(s.name)).textContent),
        state.tasks.filter(t => t.status === s.name).length, s.name + " count"));
      const overdue = state.tasks.filter(isOverdue).length;
      assert(overdue > 0, "seed data should include overdue tasks");
      eq(Number($("#sum-overdue").textContent), overdue, "overdue count");
      assert($("#board-status").textContent.includes(`${overdue} overdue`), "status sentence missing overdue count");
    });
    await test("Render", "Demo / no-persistence note is visible", "low", async () => {
      await step("Checking the demo note", $(".demo-note"));
      assert(/refreshing the page resets the board/i.test(document.body.textContent), "demo note missing");
    });

    // ---------- Views
    await test("Views", "Timeline is the default view", "high", async () => {
      await step("Checking the timeline is shown first", $("#timeline-view"));
      assert(!$("#timeline-view").hidden, "timeline hidden");
      assert($("#board").hidden, "board visible");
      eq($$("#timeline-view .g-row").length, state.tasks.length, "gantt rows");
      eq($('[data-view="timeline"]').getAttribute("aria-pressed"), "true", "timeline aria-pressed");
    });
    await test("Views", "Toggle switches to the board and back", "high", async () => {
      await showBoard();
      assert(!$("#board").hidden && $("#timeline-view").hidden, "board not shown");
      eq($('[data-view="board"]').getAttribute("aria-pressed"), "true", "board aria-pressed");
      await step("Switching back to the Timeline", $('[data-view="timeline"]'));
      $('[data-view="timeline"]').click();
      assert(!$("#timeline-view").hidden, "timeline not shown again");
    });
    await test("Views", "Clicking a task on the timeline opens its card", "medium", async () => {
      const id = "UOB-ITPM-0003";
      const link = $(`#timeline-view [data-show="${id}"]`);
      await step(`Clicking ${id} on the timeline`, link);
      link.click();
      await tick();
      assert(!$("#board").hidden, "board not shown");
      await step("The board opens on that card", document.activeElement);
      eq(document.activeElement && document.activeElement.closest(".card")?.dataset.id, id, "focused card");
    });

    // ---------- Add task: validation
    await test("Add task", "Empty form shows inline errors and adds nothing", "critical", async () => {
      await step("Opening Add task", $("#open-add"));
      $("#open-add").click();
      assert(dialog.open, "Add task dialog did not open");
      form.reset();
      await step("Submitting the empty form", $("#submit-task"));
      form.requestSubmit();
      await tick();
      await step("Inline errors are shown", $("#err-title"));
      eq(state.tasks.length, 8, "task count after invalid submit");
      assert(dialog.open, "dialog closed on invalid submit");
      ["title", "project", "category", "assignee", "dueDate"].forEach(n => {
        assert($("#err-" + n).textContent.trim(), `no error text for ${n}`);
        eq(form.elements[n].getAttribute("aria-invalid"), "true", `aria-invalid on ${n}`);
      });
      eq(document.activeElement, form.elements.title, "focus on first invalid field");
    });
    await test("Add task", "Past due date is rejected", "high", async () => {
      $("#open-add").click();
      await fillForm({ title: "Past date", project: PROJECTS[0], category: CATEGORIES[0], assignee: "Test", priority: "Low", dueDate: addDays(-1), status: "Backlog" });
      await step("Submitting with yesterday's date", $("#submit-task"));
      form.requestSubmit();
      await tick();
      await step("Due date error is shown", $("#err-dueDate"));
      eq(state.tasks.length, 8, "task count");
      assert(/past/i.test($("#err-dueDate").textContent), "no past-date error");
    });

    // ---------- Add task: success (optimistic, FormSubmit placeholder fails safely)
    let newId = null;
    await test("Add task", "Valid task is added, dialog closes, toasts shown", "critical", async () => {
      $("#open-add").click();
      await fillForm({ title: "UI test task", description: "Created by the UI test harness", project: PROJECTS[1], category: CATEGORIES[1], assignee: "Harness Bot", priority: "High", dueDate: addDays(3), status: "In Progress" });
      await step("Submitting a valid task", $("#submit-task"));
      form.requestSubmit();
      await wait(50);
      eq(state.tasks.length, 9, "task count");
      newId = state.tasks[state.tasks.length - 1].id;
      assert(/^UOB-ITPM-\d{4}$/.test(newId), "bad id " + newId);
      assert(!dialog.open, "dialog still open");
      await showBoard();
      await step(`New card ${newId} is in In Progress`, $(`.card[data-id="${CSS.escape(newId)}"]`));
      eq(columnOf(newId), "In Progress", "column of new card");
      await step("Checking the toasts", $("#toasts"));
      const toasts = toastTexts().join(" | ");
      assert(toasts.includes(`Task ${newId} added`), "no success toast: " + toasts);
      assert(toasts.includes("Card added locally — email notification failed"), "no email-failure warning toast: " + toasts);
      assert(!$("#submit-task").disabled, "submit button still disabled after the request settled");
      eq(form.elements.title.value, "", "form not reset");
    });
    await test("Security", "HTML in a task title is shown as text (XSS)", "critical", async () => {
      window.__xss = 0;
      $("#open-add").click();
      const payload = '<img src=x onerror="window.__xss=1"><script>window.__xss=1<\/script>';
      await fillForm({ title: payload.slice(0, 80), project: PROJECTS[0], category: CATEGORIES[0], assignee: '"><b>x</b>', priority: "Low", dueDate: addDays(9), status: "Backlog" });
      await step("Submitting a title that contains HTML", $("#submit-task"));
      form.requestSubmit();
      await wait(50);
      const id = state.tasks[state.tasks.length - 1].id;
      await showBoard();
      const card = $(`.card[data-id="${CSS.escape(id)}"]`);
      assert(card, "card not rendered");
      await step("The HTML shows as plain text", card.querySelector(".card-title"));
      assert(!card.querySelector("img, script, b"), "markup from user input was rendered as HTML");
      assert(card.querySelector(".card-title").textContent.includes("<img"), "title text not shown literally");
      assert(!$$("#timeline-view img, #timeline-view b").length, "markup rendered in the timeline");
      eq(window.__xss, 0, "injected script ran");
      deleteTask(id);
    });

    // ---------- Move (keyboard fallback) and drag and drop
    await test("Move", "Move to… select moves the card and keeps focus", "critical", async () => {
      await showBoard();
      const sel = $(`.card[data-id="${CSS.escape(newId)}"] .move-select`);
      await step(`Choosing Move to… Done on ${newId}`, sel);
      sel.value = "Done";
      sel.dispatchEvent(new Event("change", { bubbles: true }));
      await tick();
      await step("Card is now in Done", $(`.card[data-id="${CSS.escape(newId)}"]`));
      eq(state.tasks.find(t => t.id === newId).status, "Done", "status");
      eq(columnOf(newId), "Done", "column");
      eq(document.activeElement && document.activeElement.closest(".card")?.dataset.id, newId, "focus kept on the moved card");
      assert(toastTexts().some(t => t.includes(`${newId} moved to Done`)), "no move toast");
    });
    await test("Move", "Drag and drop moves a card between columns", "high", async () => {
      await showBoard();
      const card = $(`.card[data-id="${CSS.escape(newId)}"]`);
      const target = $('.column[data-status="Blocked"] .card-list');
      await step(`Dragging ${newId}…`, card);
      const dt = new DataTransfer();
      card.dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent("dragover", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await step("…over the Blocked column", $('.column[data-status="Blocked"]'));
      assert($('.column[data-status="Blocked"]').classList.contains("is-drop-target"), "drop target not highlighted");
      target.dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: dt }));
      await tick();
      await step("Dropped: card is in Blocked", $(`.card[data-id="${CSS.escape(newId)}"]`));
      eq(columnOf(newId), "Blocked", "column after drop");
      assert(!$(".column.is-drop-target"), "drop highlight not cleared");
    });

    // ---------- Delete
    await test("Delete", "Delete asks Yes / No; No cancels, Yes deletes", "critical", async () => {
      await showBoard();
      const sel = `.card[data-id="${CSS.escape(newId)}"]`;
      await step("Clicking delete", $(`${sel} [data-action="delete"]`));
      $(`${sel} [data-action="delete"]`).click();
      await tick();
      assert($(`${sel} .confirm-row`), "no inline confirmation");
      eq(document.activeElement, $(`${sel} [data-action="cancel-delete"]`), "focus on No");
      await step("Choosing No", $(`${sel} [data-action="cancel-delete"]`));
      $(`${sel} [data-action="cancel-delete"]`).click();
      await tick();
      assert($(sel) && !$(`${sel} .confirm-row`), "No did not cancel");
      $(`${sel} [data-action="delete"]`).click();
      await tick();
      await step("Clicking delete again and choosing Yes", $(`${sel} [data-action="confirm-delete"]`));
      $(`${sel} [data-action="confirm-delete"]`).click();
      await tick();
      assert(!$(sel), "card still on the board");
      assert(!state.tasks.some(t => t.id === newId), "task still in state");
    });

    // ---------- Filters
    await test("Filters", "Priority filter shows only matching cards with shown / total counts", "high", async () => {
      await showBoard();
      const p = $("#filter-priority");
      await step("Filtering by priority: Critical", p);
      p.value = "Critical";
      p.dispatchEvent(new Event("change"));
      await step("Only Critical cards remain", $("#board"));
      const shown = $$(".card").map(c => state.tasks.find(t => t.id === c.dataset.id).priority);
      assert(shown.length > 0 && shown.every(x => x === "Critical"), "non-critical cards shown: " + shown.join(","));
      assert($$(".count-badge").some(b => b.textContent.includes("/")), "counts not shown as shown / total");
    });
    await test("Filters", "Assignee substring filter is case-insensitive", "medium", async () => {
      $("#clear-filters").click();
      const a = $("#filter-assignee");
      await step('Typing "tan" in Assignee contains', a);
      a.value = "tan";
      a.dispatchEvent(new Event("input"));
      await step("Matching cards only", $("#board"));
      const names = $$(".card .assignee-name").map(n => n.textContent);
      assert(names.length > 0 && names.every(n => n.toLowerCase().includes("tan")), "unexpected cards: " + names.join(","));
    });
    await test("Filters", "Clear filters restores every card", "high", async () => {
      await step("Clicking Clear filters", $("#clear-filters"));
      $("#clear-filters").click();
      eq($$(".card").length, state.tasks.length, "cards after clear");
      eq($("#filter-assignee").value, "", "assignee input not cleared");
    });

    // ---------- Overdue list
    await test("Overdue", "Button shows the live count and opens a sorted list", "high", async () => {
      const overdue = state.tasks.filter(isOverdue);
      await step("Opening the overdue list", $("#open-overdue"));
      assert($("#open-overdue").textContent.includes(String(overdue.length)), "button count");
      $("#open-overdue").click();
      assert($("#overdue-dialog").open, "dialog did not open");
      await step("Checking the list is most overdue first", $("#overdue-list"));
      const days = $$("#overdue-list .od-days strong").map(s => Number(s.textContent));
      eq(days.length, overdue.length, "rows");
      assert(days.every((d, i) => i === 0 || days[i - 1] >= d), "not sorted most overdue first: " + days.join(","));
    });
    await test("Overdue", "Show on board clears hiding filters and focuses the card", "medium", async () => {
      const p = $("#filter-priority");
      await step("Filtering by Low so the overdue card is hidden", p);
      p.value = "Low";
      p.dispatchEvent(new Event("change"));
      const target = state.tasks.filter(isOverdue).find(t => t.priority !== "Low");
      $("#open-overdue").click();
      const btn = $(`#overdue-dialog [data-show="${target.id}"]`);
      await step(`Show on board: ${target.id}`, btn);
      btn.click();
      await tick();
      await step("Filter cleared and card focused", document.activeElement);
      eq(state.filters.priority, "", "filter not cleared");
      eq(document.activeElement && document.activeElement.closest(".card")?.dataset.id, target.id, "focused card");
      assert(!$("#overdue-dialog").open, "dialog still open");
    });

    // ---------- WhatsApp widget
    await test("WhatsApp", "Button opens suggested questions with safe wa.me links", "medium", async () => {
      await step("Clicking the WhatsApp button", $("#wa-fab"));
      $("#wa-fab").click();
      assert($("#wa-dialog").open, "dialog did not open");
      await step("Checking the question links", $("#wa-queries"));
      const links = $$("#wa-queries a");
      eq(links.length, SUPPORT_QUERIES.length, "question count");
      const base = "https://wa.me/" + WHATSAPP_NUMBER.replace(/[^0-9]/g, "");
      links.forEach(a => {
        assert(a.href.startsWith(base + "?text="), "bad link " + a.href);
        eq(a.target, "_blank", "target");
        assert(/noopener/.test(a.rel) && /noreferrer/.test(a.rel), "missing rel noopener noreferrer");
      });
      assert($("#wa-blank").href.startsWith(base), "blank chat link");
    });

    // ---------- Accessibility basics and constraints
    await test("Accessibility", "Every input has a label and icon buttons have names", "high", async () => {
      await step("Checking labels and button names", null);
      $$("input, select, textarea").forEach(el => {
        const labelled = (el.id && $(`label[for="${CSS.escape(el.id)}"]`)) || el.getAttribute("aria-label");
        assert(labelled, "unlabelled control " + (el.id || el.className));
      });
      $$("button").forEach(b => {
        if (panel && panel.contains(b)) return;
        const name = (b.getAttribute("aria-label") || b.textContent).trim();
        assert(name, "button without an accessible name: " + b.outerHTML.slice(0, 80));
      });
      eq($("#toasts").getAttribute("aria-live"), "polite", "toast region aria-live");
    });
    await test("Constraints", "No browser storage and no alert/confirm used", "high", async () => {
      await step("Scanning the app script for storage and alert/confirm", null);
      const src = Array.from(document.scripts).filter(s => !s.id || !s.id.startsWith("ui-test")).map(s => s.textContent).join("\n");
      ["localStorage", "sessionStorage", "indexedDB", "document.cookie", "alert(", "confirm("].forEach(api =>
        assert(!src.includes(api), "uses " + api));
    });
    await test("Stability", "No uncaught script errors during the run", "critical", async () => {
      eq(errors.length, 0, "errors: " + errors.join(" | "));
    });

    finish();
  }

  function finish() {
    const report = {
      harness_version: "1.1",
      mode: VISUAL ? "visible" : "headless",
      started_at: startedAt.toISOString(),
      finished_at: new Date().toISOString(),
      results,
      errors,
    };
    const json = JSON.stringify(report);
    document.documentElement.setAttribute("data-ui-results", btoa(unescape(encodeURIComponent(json))));
    if (!VISUAL) return;

    const passed = results.filter(r => r.passed).length;
    const failed = results.length - passed;
    const critical = results.filter(r => !r.passed && r.severity === "critical").length;
    if (hl.matches(":popover-open")) hl.hidePopover();
    caption.style.color = failed ? "#ffb4b4" : "#8ff0c2";
    caption.textContent = failed
      ? `${critical ? "🚨 " + critical + " critical · " : ""}${failed} failed, ${passed} passed`
      : `All ${passed} tests passed`;
    const foot = panel.querySelector("[data-foot]");
    foot.style.display = "flex";
    foot.style.gap = "8px";
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
    const stamp = report.finished_at.replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
    foot.innerHTML = `<a download="ui-test-${stamp}.json" href="${URL.createObjectURL(blob)}"
        style="flex:1;text-align:center;padding:8px 12px;border-radius:8px;background:#e5a823;color:#2a1f00;font-weight:700;text-decoration:none">Download JSON report</a>
      <button type="button" data-close style="padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,.3);background:transparent;color:#fff;font:inherit;cursor:pointer">Hide panel</button>`;
    foot.querySelector("[data-close]").addEventListener("click", () => panel.hidePopover());
    toFront();
  }

  // Start after the app's init() has run
  setTimeout(() => {
    run().catch(err => {
      errors.push("Harness crashed: " + err);
      finish();
    });
  }, VISUAL ? 400 : 0);
})();
