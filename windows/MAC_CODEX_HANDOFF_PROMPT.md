# Mac Codex handoff prompt — Native Messaging installer review

Please review the public `zer0-lyz/appraisal-toolbox-releases` repository and the Windows installer incident/packaging checklist linked below. This is a Mac-side audit and handoff for preventing a repeat of the Windows v0.2.1 packaging failure during future macOS development and release work.

## Required reading

- `windows/INCIDENT_WINDOWS_INSTALLER_2026-10-09.md`
- `windows/MULTIPLATFORM_INSTALL_PACKAGING.md`
- `windows/ALIBABA_MODULES_LOGIN_GATE_FIX_2026-10-09.md`
- The v0.2.1 macOS Apple Silicon release asset, its checksum, and the actual Mac installer/build scripts at the current release commit.
- Current official Chrome and Microsoft Edge Native Messaging host-manifest documentation.

## Tasks

1. Inspect the v0.2.1 macOS arm64 archive and source packaging flow. Do not assume its claims are current; identify the exact source commit, build steps, included runtime versions, manifest install destinations for Chrome and Edge Stable, permission/mode handling, replacement/rollback behavior, and code-signing/notarization state.
2. Compare the implementation with the shared checklist. Report concrete failures and gaps with file paths and reproducible evidence. In particular, check for read-only-object writes, non-atomic updates, lost executable bits, unverified manifest installs, profile auto-launch, swallowed exit codes, and destructive rollback.
3. On the Mac test host, build and test only in a disposable account/profile or clearly isolated temporary directories. Do not read, print, upload, or modify credentials, cookies, tokens, browser profiles, or unrelated Tianyuan files. Do not publish a new stable release.
4. Run package checksum verification, clean install, upgrade/reinstall, deliberate-failure rollback if safely reproducible, native-helper self-test, extension load in separate temporary Chrome and Edge profiles, Native Messaging health, and uninstall/cleanup. Save sanitized evidence paths and exact outcomes. Clearly mark tests that could not be run.
5. If a fix is needed, implement and validate it locally on a dedicated Git branch. The current project rule forbids pushing to GitHub; prepare a reviewable patch and handoff, but do not push a branch, open a PR, or publish a stable release. Include a Mac-specific incident/fix note, the commands to build the arm64 installer, a repeatable test, and source/runtime provenance. Do not modify the Windows fix.
6. Return a concise handoff containing: source commit, local branch/patch path, exact build/test commands, macOS version and architecture, asset SHA-256 if built, test evidence paths, pass/fail/not-covered matrix, and any decision needed before a cross-platform v0.2.2 release. A later user instruction is required before GitHub publication.

## Required cross-platform module carry-over

- Both 阿里司法拍卖 and 阿里资产租赁 use the shared `src/core/alibaba-page-state.js` classifier. Carry it with both modules and preserve the login-versus-verification priority.
- Treat `login.taobao.com`, `passport.taobao.com`, explicit login routes, and `login_jump` as login. Do not classify generic `slider` or `verify` CSS classes as a security challenge; use explicit captcha/NC/JDJRV/GeeTest/slider-verify markers and page text.
- Add fixture regressions for login hosts/routes, challenge URLs, an ordinary list URL, and normal carousel/verified UI classes. The UI must tell the user to complete login or security verification manually in the current browser tab and hide internal error codes.
- Do not infer a login gate from generic text anywhere in the page body (for example, a list page containing “请登录” or “会员登录” in navigation). For content-based login detection, require an explicit login-page title or a visible password field with a visible login submit control; preserve URL-based login/login_jump priority.
- When a scrape reaches a login page or an explicit login form, keep the scrape alive for up to five minutes and show a clear manual-login progress state. Do not automate authentication or read form values. Resume only after the user finishes login and the requested list page is ready; stop with a distinct actionable timeout if login does not complete. Add a synthetic transition regression for both modules plus a real manual-browser test marked separately.
- Never automate or bypass Alibaba security verification. Real authenticated network acceptance remains a separate manual-browser test.
- Carry the 2026-10-10 rental fixes in `src/modules/alibaba-lease/module.js`: list pages do not offer a reliable server-side end-date filter, so parse only explicitly labeled end dates, prefilter out-of-range cards before navigating to details, and require a detail end date whenever a range is selected. A missing list date must continue to detail verification and must never be treated as in-range by itself.
- Rental detail pages label the first-year rent as `成交价` (for example `成交价 43,000 元/年`); parse that as explicit sold amount and allow it to satisfy detail readiness. Keep the ended/non-failed/bid-or-explicit-price checks so an ended unsold/failed case is not called a transaction. Include regressions for both a 2023 card excluded from a 2026 range and an in-range sold lease amount flowing into output.

This request is for review, repair, test, and a reviewable GitHub handoff only. Never include credential values or browser-profile data in the report.
