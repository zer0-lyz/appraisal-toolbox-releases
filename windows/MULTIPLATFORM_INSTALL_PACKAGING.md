# Cross-platform installer and release checklist

This checklist captures the Windows v0.2.1 installer incident so the same class of packaging error is caught before a future macOS build.

## Shared release requirements

- Build from a clean, identified source commit. Record the base runtime/payload release and its verified SHA-256 when reusing prebuilt binaries.
- Keep extension source, installer source, binary runtime, and package metadata provenance explicit. Do not describe a repack as a native-binary rebuild.
- Generate a per-file SHA-256 inventory after the final package contents are in place; verify it from the extracted ZIP before installation.
- Make the installer checksum implementation available in the minimum supported shell. Windows packaging uses .NET SHA-256 directly instead of assuming a PowerShell cmdlet/module is auto-loaded.
- Install into a staging directory, run portable-runtime and helper self-tests, then atomically replace the app directory.
- Snapshot platform registrations before changing them. Verify every written registration by reading it back. On any later failure, restore the previous app and only the registrations the installer touched; report rollback failures separately.
- Keep installers non-interactive and return the real installer exit code to the process that launched them. Do not use `pause` in a release wrapper.
- Never open the user's default browser profile, mail, account, Finder/Explorer, or unrelated app from the installer. Show an explicit path and let acceptance load the extension in isolated test profiles.
- Keep account state and secrets out of packages, logs, screenshots, process arguments, and acceptance evidence.
- A static check is not an acceptance run. Record actual install, runtime, browser, business-flow, and stability coverage separately; use `pass`, `fail`, and `not covered` honestly.
- Do not overwrite an existing release tag or asset. Use a new prerelease for platform-specific repair artifacts and publish a stable cross-platform version only when all required platform assets are ready.

## Windows registration checks

- Register Chrome and Edge under current-user `NativeMessagingHosts` keys.
- Write the key's default value through a writable Registry-provider operation. Do not call `.SetValue()` on a read-only `RegistryKey` returned by `Get-Item`.
- Require the value to equal the full path of the installed Native Messaging manifest; parse the manifest and verify the host name, executable path, `stdio` type, and exact extension origin.
- Preserve previous values and types during rollback. Validate the installer exit status, installation report, and both registry read-backs.
- Use dedicated Chrome and Edge profiles for acceptance. Never use a launch command that points at an existing user profile.

## macOS registration and package checks

- Use the browser-specific user-level manifest directories for Chrome and Edge. These paths are not interchangeable: Chrome uses `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/`; Edge Stable uses `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/`.
- Write the manifest as valid JSON with an absolute executable path, exact host name, `stdio` transport, and exact extension origin. Verify the installed file contents and permissions by reading them back.
- Make the helper executable (`chmod` and verify with `test -x`). Preserve the executable mode when building the ZIP; extract and test on macOS because Windows ZIP tools may discard Unix mode bits.
- Stage package files and manifests before atomically renaming them into place. Preserve user configuration, and snapshot/restore each browser's prior manifest on failure.
- Test both Chrome and Edge Stable in separate, disposable user-data profiles. Verify arm64 architecture, Gatekeeper/quarantine behavior, code-signing/notarization expectations for the actual distribution channel, and process exit status.
- Do not assume a plist or launch agent is the Native Messaging registration mechanism. Follow each browser's current Native Messaging host-manifest location and test the exact supported stable channel.

Official platform references:

- Chrome Native Messaging: <https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging>
- Microsoft Edge Native Messaging: <https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/native-messaging>
- PowerShell Registry provider: <https://learn.microsoft.com/en-us/powershell/module/microsoft.powershell.core/about/about_registry_provider>

## Required release evidence

For every platform asset, attach the source commit, builder command/version, OS and architecture, archive SHA-256, installed-file inventory/checksum result, installation output and exit code, installation report, Native Messaging manifest read-back, browser screenshots, helper self-test, business-flow outcome, stability outcome, and unresolved coverage. Sanitize evidence before attaching it; do not include credentials or account sessions.
