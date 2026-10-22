import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const installer = readFileSync(join(here, "..", "installer", "install.ps1"), "utf8");
const wrapper = readFileSync(join(here, "..", "installer", "install.cmd"), "utf8");
const uninstaller = readFileSync(join(here, "..", "installer", "uninstall.ps1"), "utf8");

assert.match(installer, /Set-Item\s+-LiteralPath\s+\$RegistryPath\s+-Value\s+\$ManifestPath/);
assert.match(installer, /function Get-PackageSha256/);
assert.match(installer, /\$Hasher\.ComputeHash\(\$Stream\)/);
assert.doesNotMatch(installer, /Get-FileHash/);
assert.match(installer, /function Verify-ExternalRegistration/);
assert.match(installer, /-File \$ProbeScript -RegistryPath \$RegistryPath -ProbeId \$ProbeId -ExpectedManifestPath \$ManifestPath/);
assert.match(installer, /Assert-IndependentProcessContext \$Result/);
assert.match(installer, /\$KeyResult\.status = "failed"/);
assert.match(installer, /registryKeysNotAttempted/);
assert.match(installer, /rollbackVerified/);
assert.match(installer, /\$RegistryTouched\[\$RegistryPath\]\s*=\s*\$true/);
assert.match(installer, /Restore-RegistrySnapshot/);
assert.match(installer, /browserProfileAutoOpened=false/);
assert.doesNotMatch(installer, /\.SetValue\s*\(/);
assert.doesNotMatch(installer, /Start-Process|chrome\.exe|explorer\.exe/i);
assert.match(wrapper, /set "EXIT_CODE=%ERRORLEVEL%"/i);
assert.match(wrapper, /exit \/b %EXIT_CODE%/i);
assert.doesNotMatch(wrapper, /^\s*pause\s*$/im);
assert.doesNotMatch(uninstaller, /\.SetValue\s*\(/);

console.log("Windows installer contract checks passed.");
