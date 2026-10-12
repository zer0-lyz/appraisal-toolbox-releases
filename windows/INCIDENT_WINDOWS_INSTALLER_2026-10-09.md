# Windows v0.2.1 installer incident and repair

## Status

The v0.2.1 Windows x64 full package failed on a Windows 11 x64 test machine during step 6/7. Steps 1 through 5 had passed, including the Python dependency check and Native Helper self-test. The failure prevented installation and the acceptance run stopped there.

The original error was `Cannot write to the registry key.` The original installer called `.SetValue()` on the `RegistryKey` object returned by PowerShell's `Get-Item` Registry provider. That object was opened read-only. The failure was in the installer write method; it did not prove that HKCU was unwritable.

The old catch path also used `.SetValue()` during rollback, so rollback of an existing registration could fail in the same way. The test harness reported process code 0 despite the explicit installer failure, and `install.cmd` paused for a key before returning. The old successful path also opened Explorer and the default Chrome profile without an isolated test profile.

## Repair

1. Write each HKCU default value through `Set-Item` on the Registry provider, then read the value back and require an exact manifest-path match.
2. Snapshot both Chrome and Edge registrations before mutation. Roll back only touched keys and report any rollback failure without replacing the original install error.
3. Preserve the installer process result through `install.cmd`; remove the interactive pause.
4. Never launch Explorer or a browser automatically. Load the extension manually in dedicated test profiles.
5. Add an installer build identifier to `installation-report.txt` so evidence identifies the fixed installer while retaining app version 0.2.1.
6. Implement package SHA-256 verification with the .NET cryptography API so the `install.cmd` Windows PowerShell 5.1 process does not depend on PowerShell module autoloading for `Get-FileHash`.

PowerShell's registry-provider documentation describes `Set-Item` as changing a registry key's default value. The Chrome and Edge native-messaging documentation also requires the registration's default value to identify the full host-manifest path. The repaired installer follows that contract and checks the value after writing.

## Reproducible source and artifacts

- Installer source: `windows/installer/`
- Package builder: `windows/build-windows-installer-fix.ps1`
- Installer contract checks: `windows/tests/installer-contract.test.mjs`
- Manual acceptance plan: `windows/WINDOWS_CODEX_ACCEPTANCE_PROMPT.md`
- Cross-platform packaging checklist: `windows/MULTIPLATFORM_INSTALL_PACKAGING.md`
- Input payload: v0.2.1 Windows ZIP, SHA-256 `a71aabe5008d06e4ba519a0abfb7c84fcdf6e53085a8eb54100313e626366a28`

The repair rebuilds the ZIP and installer only. The first repaired build exposed two more release-pipeline defects before installation: the checksum builder emitted truncated relative paths, and the Windows PowerShell 5.1 command wrapper did not resolve `Get-FileHash` in the installer process. Both were corrected: the builder verifies paths remain under the package root, and the installer hashes files through .NET SHA-256. It does not rebuild or replace the native-helper executable, Node runtime, Python runtime, or offline dependency wheels. Their unchanged payloads come from the hash-verified v0.2.1 Windows archive. The final Windows test results and exact release asset hashes are recorded with the release evidence.

## Mac follow-up

This package does not change or claim to test the macOS installer. Before a future cross-platform release, run the Mac review described in `MAC_CODEX_HANDOFF_PROMPT.md`. Mac packaging must verify the browser-specific Native Messaging manifest paths and executable permissions on a real Apple Silicon host; it must not copy Windows registry assumptions into the Mac installer.
