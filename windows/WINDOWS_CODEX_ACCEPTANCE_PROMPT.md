# Appraisal Toolbox v0.2.1 Windows x64 installer-fix acceptance

Please install and test the Windows x64 installer-fix prerelease on this Windows 10/11 x64 test machine.

## Release identity

- Prerelease tag: `windows-installer-fix-20261009`
- Asset: `appraisal-toolbox-v0.2.1-windows-x64-installer-fix1.zip`
- Expected archive SHA-256: `__WINDOWS_PACKAGE_SHA256__`
- App version: `0.2.1`
- Installer build: `windows-registry-write-fix.1`
- Extension ID: `aamfmhcbjgofhmannejoiilkkpchfkgm`
- Native host: `com.appraisal.toolbox.helper`

## Safety

- Do not change Tianyuan Workbench, Connector, MCP, CLI, or existing Chrome/Edge profiles.
- Do not read, output, upload, or write cookies, Authorization, tokens, passwords, verification codes, map keys, account credentials, or `.keys` files.
- Use isolated temporary Chrome and Edge test profiles. Do not use the normal user-data directories.
- Do not log into any account or perform high-frequency requests.
- Save all evidence under `C:\AppraisalToolboxAcceptance\windows-installer-fix-20261009\evidence`.

## Install and L0

1. Verify the ZIP SHA-256 against this prompt and the `.sha256` sidecar before extraction.
2. Extract to a short path. Run `install.cmd` non-interactively and capture its actual process exit code and complete output.
3. Require exit code 0, all seven steps, and `status=success` in `%LOCALAPPDATA%\AppraisalToolbox\installation-report.txt`.
4. Require report `installerBuild=windows-registry-write-fix.1` and `browserProfileAutoOpened=false`.
5. Read both current-user Chrome and Edge Native Messaging registry default values. Each must equal the installed manifest path. Verify the manifest JSON's host name, executable path, `stdio` type, and exact extension origin.
6. Verify the installed package checksums, OS architecture, app version and extension ID. Confirm the installer did not open Explorer or a default browser profile.

## L1-L4

- **L1 static and registration:** confirm the extension manifest identity and all eight home entries (six business, two utility) in the loaded UI; report any disabled entry or mismatch.
- **L2 Native:** run `native_host.exe --self-test`; load the extension in isolated Chrome and Edge profiles; verify extension health through the supported app flow; send the unauthorized `start_connector_bridge` action and require `APPRAISAL_TOOLBOX_ACTION_NOT_ALLOWED`.
- **L3 browser and business:** in both browsers, confirm the extension loads. Check the two no-prerequisite gates, update page repository/release URL, and safe offline/test-data paths for land, table formatting, and depreciation. Use only disposable sample data. For account-dependent Alibaba and Anjuke flows, test the no-login gate only; do not sign in. Do not call a public business site unless the test case needs it and a single low-rate request is safe.
- **L4 stability:** reload each extension once, restart each browser test profile once, repeat Native health/self-test, and verify the installation remains present and the two registry values remain correct. Record exact durations for any long task you run.

## Evidence and conclusion

Save the archive digest, install output and exit code, installation report, both registry values, manifest, package checksum result, browser extension detail and eight-entry screenshots, Native self-test/health/denial output, disposable test outputs, and `验收报告.md`.

For every L0-L4 item, state `通过`, `失败`, or `未覆盖` with its evidence path. The Windows installer fix can pass only if the L0 installation/registration checks pass. Claim full Windows x64 acceptance only if every required L0-L4 item and both browsers pass. Separate account-dependent work that was intentionally not exercised; never infer a pass from a static check.
