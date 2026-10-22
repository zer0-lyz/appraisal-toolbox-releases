# Appraisal Toolbox v0.2.2 — Windows x64 Candidate Installer

## Registration verification context (Z1, 2026-10-11)

Installer build `windows-context-attested.8` refuses to install or mark registry keys
verified when token, package, LocalAppData or desktop ancestry cannot be attested.
Launch `install.cmd` from a normal desktop Command Prompt/Windows PowerShell,
not from Codex, an agent terminal or a packaged application. Even an unpackaged
child of an agent is not accepted as an independent desktop witness. This is a
conservative evidence policy, not proof that every such parent virtualizes HKCU.
Packaged Windows Terminal ancestry is conservatively rejected as well; use the
classic Windows PowerShell launched from the Start menu instead.

For a read-only check, run `verify-desktop-registration.ps1 -HostRoot <installed-root>`.
It saves four reg.exe raw outputs, PID/SID/session/parent chain/timestamps and
manifest/executable hashes. It never registers or deletes keys. The verifier
cross-checks provider/Win32/reg.exe readings in both views; the report explicitly
states that same-tree child reads are not an independent out-of-tree witness.
Unknown/restricted/mismatching contexts fail with `REGISTRATION_VERIFICATION_INVALID`.
Installation reports include the attested context and its evidence limitations.

The Windows updater persists a nonce-bound transaction journal before changing
the installed runtime, original unpacked extension directory, or Native Messaging
keys. If its installer exceeds the time limit, it first confirms the process tree
has ended, then runs the same context-gated recovery path. The recovery restores
and verifies the previous runtime, extension files, and registry values before
releasing the update lock. If any part cannot be verified, the lock remains and
the update UI reports that manual recovery is required.

This is an unsigned v0.2.2 Windows x64 candidate package. Do not treat its local
or fixture update metadata as an official published release.

System requirements: Windows 10 or Windows 11, x64.

## Installation

1. Extract the complete ZIP to a short local path such as `C:\AppraisalToolboxInstaller`.
2. Run `install.cmd` and wait for it to exit. The process exit code is preserved; the installer does not pause for a key press.
3. Confirm all seven checks complete and `%LOCALAPPDATA%\AppraisalToolbox\installation-report.txt` contains `status=success`.
4. In Chrome, open `chrome://extensions`, enable Developer mode, and load `%LOCALAPPDATA%\AppraisalToolbox\extension`.
5. Repeat in Edge at `edge://extensions` if Edge support is needed.
6. Confirm name `评估工具箱`, version `0.2.2`, and extension ID `aamfmhcbjgofhmannejoiilkkpchfkgm`.

The installer registers the Native Messaging host for the current Windows user, verifies both registry default values by reading them back, and never opens Explorer or a browser profile automatically. It does not require elevation for HKCU registration.

## Included

- The v0.2.2 candidate extension and rebuilt unsigned Native Helper/runtime payload.
- A Windows installer using the Registry provider to write and independently verify HKCU Native Messaging default values.
- A persistent, nonce-bound timeout recovery transaction for the installed runtime and original extension directory.
- A non-interactive command wrapper that returns the actual PowerShell exit code.

The installer does not read or store Cookie, Authorization, passwords, verification codes, map keys, or account credentials.
