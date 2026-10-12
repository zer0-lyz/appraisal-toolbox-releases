# Read-only context attestation. A child of an agent is not an independent
# desktop witness, even when its own token has no package identity.
function Get-RegistrationContextPolicyReasons($Context) {
  $reasons = @()
  if ($Context.appContainer -or $Context.tokenRestricted -or $Context.virtualizationEnabled -or
      $Context.packageFullName -or $Context.appxEnvironment) { $reasons += 'restricted-token-or-AppContainer/MSIX-or-virtualization' }
  if (-not $Context.process64Bit -or $Context.sessionId -eq 0) { $reasons += 'not-interactive-x64-session' }
  $normalize = {param($p) [IO.Path]::GetFullPath($p).TrimEnd('\')}
  if (-not $Context.processLocalAppData -or -not $Context.win32LocalAppData -or -not $Context.profileLocalAppData -or
      (& $normalize $Context.processLocalAppData) -ine (& $normalize $Context.win32LocalAppData) -or
      (& $normalize $Context.profileLocalAppData) -ine (& $normalize $Context.win32LocalAppData) -or
      $Context.win32LocalAppData -match '\\Packages\\') { $reasons += 'LocalAppData-view-mismatch' }
  foreach ($ancestor in $Context.parentChain) {
    if ($ancestor.executablePath -match '\\WindowsApps\\|\\Packages\\' -or
        $ancestor.name -match '^(codex|codex-sandbox|codex-exec|ChatGPT)\.exe$') {
      $reasons += 'packaged-or-agent-ancestor-not-independent-desktop'
    }
  }
  if (-not $Context.desktopBoundaryAttested) { $reasons += 'desktop-boundary-unattested' }
  return @($reasons | Select-Object -Unique)
}

function Get-RegistrationContext {
  if (-not ('AppraisalRegistrationContextToken' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
public static class AppraisalRegistrationContextToken {
  [DllImport("kernel32.dll")] static extern IntPtr GetCurrentProcess();
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool OpenProcessToken(IntPtr p,uint a,out IntPtr t);
  [DllImport("advapi32.dll", SetLastError=true)] static extern bool GetTokenInformation(IntPtr t,int c,out int v,int n,out int r);
  [DllImport("advapi32.dll")] static extern bool IsTokenRestricted(IntPtr t);
  [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern int GetCurrentPackageFullName(ref uint n,StringBuilder s);
  [DllImport("shell32.dll",CharSet=CharSet.Unicode)] static extern int SHGetKnownFolderPath(ref Guid g,uint f,IntPtr t,out IntPtr p);
  public static int[] Flags() {
    IntPtr t; if(!OpenProcessToken(GetCurrentProcess(),8,out t)) throw new Win32Exception(Marshal.GetLastWin32Error());
    try { int[] a=new int[4]; int r;
      int[] c={29,23,24};
      for(int i=0;i<c.Length;i++) if(!GetTokenInformation(t,c[i],out a[i],4,out r)) throw new Win32Exception(Marshal.GetLastWin32Error());
      a[3]=IsTokenRestricted(t)?1:0; return a;
    } finally { CloseHandle(t); }
  }
  public static string Package() {
    uint n=0; int r=GetCurrentPackageFullName(ref n,null); if(r==15700) return "";
    if(r!=122 && r!=0) throw new Win32Exception(r);
    var s=new StringBuilder((int)Math.Max(n,1)); r=GetCurrentPackageFullName(ref n,s);
    if(r!=0) throw new Win32Exception(r); return s.ToString();
  }
  public static string LocalAppData() {
    Guid g=new Guid("F1B32785-6FBA-4FCF-9D55-7B8E7F157091"); IntPtr p;
    int r=SHGetKnownFolderPath(ref g,0,IntPtr.Zero,out p); if(r!=0) Marshal.ThrowExceptionForHR(r);
    try{return Marshal.PtrToStringUni(p);}finally{Marshal.FreeCoTaskMem(p);}
  }
}
"@
  }
  $c = [ordered]@{
    observedAtUtc = [DateTime]::UtcNow.ToString('o')
    processId = $PID
    sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
    userSid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    process64Bit = [Environment]::Is64BitProcess
    processLocalAppData = [string]$env:LOCALAPPDATA
    win32LocalAppData = ''
    packageFullName = ''
    appxEnvironment = [string]$env:APPX_PACKAGE_FAMILY_NAME
    profileLocalAppData = ''
    desktopBoundaryAttested = $false
    appContainer = $null
    tokenRestricted = $null
    virtualizationAllowed = $null
    virtualizationEnabled = $null
    parentChain = @()
    valid = $false
    scope = 'invalid-unattested-context'
    reasons = @()
    limitation = 'Token/path/ancestry attestation plus same-tree cross-read is not an independent out-of-tree witness.'
  }
  try {
    $flags = [AppraisalRegistrationContextToken]::Flags()
    $c.appContainer = $flags[0] -ne 0
    $c.virtualizationAllowed = $flags[1] -ne 0
    $c.virtualizationEnabled = $flags[2] -ne 0
    $c.tokenRestricted = $flags[3] -ne 0
    $c.packageFullName = [AppraisalRegistrationContextToken]::Package()
    $c.win32LocalAppData = [AppraisalRegistrationContextToken]::LocalAppData()
    $c.profileLocalAppData = Join-Path ([Environment]::GetFolderPath('UserProfile')) 'AppData\Local'
    $next = $PID; $seen = @{}; $boundary = $false; $childCreated = $null
    for ($i=0; $i -lt 32 -and $next; $i++) {
      if ($seen.ContainsKey($next)) { $c.reasons += 'parent-chain-cycle'; break }
      $seen[$next] = $true
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$next" -ErrorAction Stop
      if (-not $p -or -not $p.ExecutablePath -or -not $p.CreationDate) { $c.reasons += 'parent-chain-unavailable'; break }
      if ($childCreated -and $p.CreationDate -gt $childCreated) { $c.reasons += 'parent-pid-reused'; break }
      $c.parentChain += [ordered]@{ processId=[int]$p.ProcessId; parentProcessId=[int]$p.ParentProcessId; name=$p.Name; executablePath=$p.ExecutablePath; createdAtUtc=$p.CreationDate.ToUniversalTime().ToString('o') }
      if ($p.ExecutablePath -ieq (Join-Path $env:WINDIR 'explorer.exe') -or
          $p.ExecutablePath -ieq (Join-Path $env:WINDIR 'System32\sihost.exe')) { $boundary=$true; break }
      $childCreated = $p.CreationDate; $next = [int]$p.ParentProcessId
    }
    # Conservative refusal, not a claim that virtualization was proven.
    $c.desktopBoundaryAttested = $boundary
    $c.reasons += @(Get-RegistrationContextPolicyReasons $c)
    $c.valid = $c.reasons.Count -eq 0
    if ($c.valid) { $c.scope = 'desktop-lineage-token-path-attested-same-tree-crossread' }
  } catch { $c.reasons += 'context-inspection-failed'; $c.inspectionError = $_.Exception.Message }
  return $c
}

function Assert-RegistrationContext($Context) {
  if (-not $Context.valid) {
    throw ('REGISTRATION_VERIFICATION_INVALID: ' + ($Context.reasons -join ', ') + '. Run install.cmd / verification in an ordinary desktop Windows PowerShell outside the agent or packaged sandbox.')
  }
}
