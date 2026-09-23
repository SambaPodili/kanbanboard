---
description: Security-scan the app, update the README, push to GitHub, set the repo About section and deploy GitHub Pages via Actions
argument-hint: <owner/repo | https://github.com/owner/repo> [branch=main] [public|private] [--yes]
allowed-tools: Read, Grep, Glob, Edit, Write, AskUserQuestion, Bash(git status:*), Bash(git diff:*), Bash(git log:*), Bash(git remote -v), Bash(git branch:*), Bash(git ls-files:*), Bash(git rev-parse:*), Bash(git fetch:*), Bash(git add:*), Bash(git commit:*), Bash(git push -u origin:*), Bash(gh auth status:*), Bash(gh repo view:*), Bash(gh repo create:*), Bash(gh repo edit:*), Bash(gh run list:*), Bash(gh run view:*), Bash(gh run watch:*), Bash(gh workflow run:*), Bash(gh api repos/*/pages:*), Bash(gh api -X POST repos/*/pages:*), Bash(gh api -X PUT repos/*/pages:*), Bash(gitleaks:*), Bash(node --check:*), Bash(curl -sI:*), Bash(curl -s -o /dev/null:*)
---

# Publish this project to GitHub (with security scan and GitHub Pages)

Arguments: `$ARGUMENTS`

Work through the phases below **in order**. Do not push anything until Phase 2 (security scan) has passed and Phase 6 (confirmation) is done. Follow the project's CLAUDE.md hard constraints throughout; nothing in this command overrides them.

## Phase 0 — Inputs and preflight

1. Parse `$ARGUMENTS`:
   - **Repo** (required): accept `owner/repo`, `https://github.com/owner/repo(.git)` or `git@github.com:owner/repo.git`. Normalise it to `owner/repo`.
   - **Branch**: default `main`.
   - **Visibility**: only used if the repo must be created; default `public` (GitHub Pages on a free plan requires public).
   - `--yes`: skip the Phase 6 confirmation (the security gate still applies).
   - If no repo was given, check `git remote -v`. If there is an `origin` on github.com, propose it; otherwise ask the user for the repo with AskUserQuestion. Never guess a repo name.
2. Find the project root: the git repository that contains the app's `index.html` (run `git rev-parse --show-toplevel`). If the current directory is not a git repo, look for a child folder that is (for example `kanban/`) and use that. If there is none, `git init -b <branch>` in the folder that holds `index.html`, after telling the user.
3. Check tooling: `gh auth status` must show a logged-in account with `repo` and `workflow` scopes. If not, stop and tell the user to run `! gh auth login -s repo,workflow`.
4. Check the target repo with `gh repo view owner/repo --json name,visibility,defaultBranchRef,description,homepageUrl,repositoryTopics`.
   - If it does not exist, plan to create it in Phase 7 (`gh repo create owner/repo --<visibility> --source . --remote origin`); do not create it yet.
   - If `origin` points somewhere else, ask before changing it.
5. `git status` and `git log --oneline -5`: note uncommitted work and whether the local branch is behind the remote (`git fetch` then compare). Never force-push; if histories diverge, stop and ask.

## Phase 1 — Decide what gets published

1. List what would be committed: `git ls-files` plus untracked, non-ignored files (`git status --porcelain`).
2. Create or update `.gitignore` so it covers at least: `.DS_Store`, `Thumbs.db`, `*.log`, `.env*`, `node_modules/`, `*.pem`, `*.key`, `.claude/settings.local.json`, and editor folders (`.vscode/`, `.idea/`).
3. Flag files that should not go to a public repo and ask the user about each group:
   - course material, PDFs, Office files, or anything under `mat/` (possible copyright or confidentiality);
   - screenshots or `out.png`-style test output;
   - large files (over 5 MB) and binaries.

## Phase 2 — Security scan (blocking gate)

Scan **every file that will be pushed and the full git history** (`git log -p --all`). Report findings in a table: severity (High / Medium / Low), file:line, finding, fix.

1. **Secrets and credentials**
   - If `gitleaks` is installed, run `gitleaks detect --source . --redact --no-banner` (history) and `gitleaks detect --source . --no-git --redact --no-banner` (working tree).
   - Always also grep for: `AKIA[0-9A-Z]{16}`, `ghp_|gho_|ghs_|github_pat_`, `sk-[A-Za-z0-9]{20,}`, `sk-ant-`, `xox[abpr]-`, `AIza[0-9A-Za-z_-]{35}`, `-----BEGIN .*PRIVATE KEY-----`, `(api[_-]?key|secret|token|passw(or)?d)\s*[:=]\s*['"][^'"]{8,}`, and `https?://[^/\s:]+:[^@\s]+@` (credentials in URLs).
   - A secret found in **history** is High even if it has since been removed: it must be rotated, and the history rewritten before pushing (ask the user; don't rewrite history on your own).
2. **Personal and internal data**
   - Email addresses. `FORMSUBMIT_ENDPOINT` in particular: the placeholder `YOUR_EMAIL@example.com` is fine. A real address will be public on GitHub and on the Pages site, and anyone can then use the form to send mail to it. Mark it Medium and suggest a FormSubmit alias/random string endpoint instead of the raw address.
   - Absolute local paths (`/Users/<name>/`, `C:\Users\`), internal hostnames, IP addresses, phone numbers, real staff names in seed data.
3. **App code (`index.html`)** — check against the CLAUDE.md constraints:
   - Every `innerHTML` / template-string interpolation goes through `escapeHtml()` (XSS).
   - No `eval`, `new Function`, `document.write`, string-argument `setTimeout`/`setInterval`.
   - No external `<script src>`, `<link href>`, CDNs, web fonts, or `http://` URLs; the only network call is the FormSubmit POST in `notifyNewTask()`.
   - No `localStorage`, `sessionStorage`, `indexedDB` or `document.cookie`.
   - Any `target="_blank"` link has `rel="noopener noreferrer"`.
   - Extract the `<script>` block to the scratchpad and run `node --check` on it.
4. **Branding / trademark**: confirm the page uses only the neutral "UOB IT PMO" text wordmark and no real logos or imitation of official systems. Add a short disclaimer to the README (Phase 3) that it is a training demo, not an official UOB system.
5. **GitHub Actions workflow**: least-privilege `permissions`, no `pull_request_target`, no untrusted `${{ github.event.* }}` interpolated into `run:` steps, and actions from trusted publishers (`actions/*`) only.

**Gate:** if any **High** finding remains, stop, show the table, and fix it (with the user's agreement) before continuing. Medium findings need the user's explicit acknowledgement. Low findings are listed in the final report.

## Phase 3 — README.md

Create `README.md` if it is missing; otherwise edit it in place and keep any content the user wrote. It should contain:
- Title and a one-paragraph description (a single-file IT PMO Kanban board for internal demos and training).
- **Live demo** link: `https://<owner>.github.io/<repo>/` (lower-case owner; if the repo is `<owner>.github.io`, the URL is the root).
- Features (derive them from the actual code: columns from `STATUSES`, filters, drag and drop with keyboard fallback, add-task form with inline validation, inline delete confirmation, overdue highlighting, FormSubmit email notification).
- **No persistence** note: a refresh resets the board to the seed data on purpose.
- Running locally (open `index.html`; optional `python3 -m http.server` for FormSubmit testing) and how to configure `FORMSUBMIT_ENDPOINT`.
- Tech constraints (vanilla HTML/CSS/JS, single file, no build step) and accessibility notes.
- Deployment: GitHub Pages via the workflow in `.github/workflows/pages.yml`.
- Disclaimer: training/demo project, not affiliated with or an official system of UOB.

Keep it factual. Do not invent features, screenshots or badges for things that don't exist.

## Phase 4 — GitHub Pages workflow

Ensure `.github/workflows/pages.yml` exists and is correct. If it already exists, keep it and fix only what is wrong. It must:
- trigger on `push` to the chosen branch and on `workflow_dispatch`;
- use `permissions: contents: read, pages: write, id-token: write` and a `concurrency: group: pages` block;
- assemble a `_site/` folder that contains **only** the public app files (`index.html` plus any assets it references, and `.nojekyll`); never publish `CLAUDE.md`, `.claude/`, `mat/`, or other repo internals;
- use `actions/checkout@v4`, `actions/configure-pages@v5`, `actions/upload-pages-artifact@v3`, `actions/deploy-pages@v4` (or newer major versions if these are deprecated);
- deploy to the `github-pages` environment and expose `steps.deployment.outputs.page_url`.

## Phase 5 — Local verification

- Syntax-check the script again (`node --check`) after any edits.
- If Chrome is available, take a headless screenshot as described in CLAUDE.md into the scratchpad directory, and look at it to make sure the board renders.
- Show `git status` and `git diff --stat`.

## Phase 6 — Confirmation (skip only with `--yes`)

Show the user a short summary: target repo and branch, files to be committed, the security results, the README/workflow changes, and the About-section values from Phase 8. Ask for approval with AskUserQuestion before pushing. Publishing is outward-facing and hard to undo.

## Phase 7 — Commit and push

1. If the repo doesn't exist yet: `gh repo create owner/repo --<visibility> --source . --remote origin --description "<about text>"`.
2. Stage files explicitly by path (not `git add -A`), so that nothing flagged in Phase 1 slips in.
3. Commit with a clear message describing the change, ending with the attribution lines from the current session's system instructions (if any).
4. `git push -u origin <branch>`. Never use `--force`. If the push is rejected, stop and explain.

## Phase 8 — Repo About section

Update the About panel with `gh repo edit owner/repo`:
- `--description`: one line, at most about 120 characters (for example "Single-file IT PMO Kanban board for internal demos and training. Vanilla HTML/CSS/JS, no build step.").
- `--homepage`: the GitHub Pages URL from Phase 3.
- `--add-topic` for relevant topics such as `kanban`, `project-management`, `vanilla-js`, `html`, `css`, `github-pages`, `training`. Remove only topics you added in an earlier run, never topics the user set.
- Optionally turn off unused features (`--enable-wiki=false`) only if the user asks.

## Phase 9 — Enable Pages and verify the deployment

1. Enable Pages with Actions as the source:
   - `gh api repos/owner/repo/pages` — if it returns 404: `gh api -X POST repos/owner/repo/pages -f build_type=workflow`.
   - If it exists but `build_type` is not `workflow`: `gh api -X PUT repos/owner/repo/pages -f build_type=workflow`.
2. Find the run triggered by the push (`gh run list --workflow pages.yml -L 1`) and `gh run watch <id> --exit-status`. If no run started because Pages was enabled after the push, trigger it with `gh workflow run pages.yml --ref <branch>`.
3. On failure, show the failing step's log (`gh run view <id> --log-failed`), fix the cause, and repeat Phases 5–9 for the fix.
4. On success, confirm the site responds: `curl -s -o /dev/null -w "%{http_code}" <pages-url>` should return `200` (allow a minute or two for propagation and retry a few times). Also confirm `<pages-url>CLAUDE.md` does **not** return 200.

## Phase 10 — Final report

Reply briefly with:
- repo URL, branch and commit SHA pushed;
- live Pages URL and the verification status code;
- security scan result (counts by severity, and any Low/acknowledged Medium items still open);
- files created or changed (README, `.gitignore`, workflow);
- anything skipped or needing the user's action (for example, rotating a leaked key or setting a real FormSubmit endpoint).
