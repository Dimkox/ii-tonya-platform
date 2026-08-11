[CmdletBinding()]
param(
  [switch]$RequireDocker
)

$ErrorActionPreference = "Stop"
$failures = [System.Collections.Generic.List[string]]::new()
$warnings = [System.Collections.Generic.List[string]]::new()

function Resolve-Tool {
  param([Parameter(Mandatory)][string]$Name)

  return Get-Command $Name -ErrorAction SilentlyContinue
}

function Read-FirstLine {
  param(
    [Parameter(Mandatory)][string]$Tool,
    [Parameter(Mandatory)][string[]]$Arguments
  )

  $output = & $Tool @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "$Tool exited with code $LASTEXITCODE"
  }
  return [string]($output | Select-Object -First 1)
}

$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$packageJson = Get-Content (Join-Path $repoRoot "package.json") -Raw | ConvertFrom-Json

$git = Resolve-Tool "git"
if (-not $git) {
  $failures.Add("Git is not available on PATH.")
} else {
  $actualRoot = (& $git.Source -C $repoRoot rev-parse --show-toplevel 2>$null).Trim()
  if ($LASTEXITCODE -ne 0 -or -not $actualRoot) {
    $failures.Add("The script directory is not inside a Git worktree.")
  }
}

$node = Resolve-Tool "node"
$nodeVersion = $null
if (-not $node) {
  $failures.Add("Node.js is not available on PATH; major 24 is required.")
} else {
  $nodeVersion = (Read-FirstLine -Tool $node.Source -Arguments @("--version")).TrimStart("v")
  $nodeMajor = [int]($nodeVersion.Split(".")[0])
  if ($nodeMajor -ne 24) {
    $failures.Add("Node.js $nodeVersion is active; major 24 is required.")
  }
}

$pnpm = Resolve-Tool "pnpm"
$pnpmVersion = $null
$requiredPnpm = ([string]$packageJson.packageManager).Split("@")[1]
if (-not $pnpm) {
  $failures.Add("pnpm is not available on PATH; version $requiredPnpm is required.")
} else {
  $pnpmVersion = Read-FirstLine -Tool $pnpm.Source -Arguments @("--version")
  if ($pnpmVersion -ne $requiredPnpm) {
    $failures.Add("pnpm $pnpmVersion is active; version $requiredPnpm is required.")
  }
}

$bash = Resolve-Tool "bash"
if (-not $bash) {
  $failures.Add("Bash is not available on PATH; deployment policy checks require it.")
}

$docker = Resolve-Tool "docker"
$dockerVersion = $null
$composeVersion = $null
if (-not $docker) {
  $message = "Docker is not available on PATH; container and PostgreSQL evidence cannot run."
  if ($RequireDocker) { $failures.Add($message) } else { $warnings.Add($message) }
} else {
  try {
    $dockerVersion = Read-FirstLine -Tool $docker.Source -Arguments @("--version")
    $composeVersion = Read-FirstLine -Tool $docker.Source -Arguments @("compose", "version")
  } catch {
    $message = "Docker or Compose is installed but not usable: $($_.Exception.Message)"
    if ($RequireDocker) { $failures.Add($message) } else { $warnings.Add($message) }
  }
}

if (-not (Test-Path (Join-Path $repoRoot "pnpm-lock.yaml"))) {
  $failures.Add("pnpm-lock.yaml is missing.")
}
if (-not (Test-Path (Join-Path $repoRoot ".env.example"))) {
  $failures.Add(".env.example is missing.")
}
if (-not (Test-Path (Join-Path $repoRoot ".env"))) {
  $warnings.Add(".env is absent; copy .env.example only when a local runtime needs it.")
}

$result = [ordered]@{
  repository = $repoRoot
  os = [System.Runtime.InteropServices.RuntimeInformation]::OSDescription
  powershell = $PSVersionTable.PSVersion.ToString()
  node = $nodeVersion
  requiredNode = [string]$packageJson.engines.node
  pnpm = $pnpmVersion
  requiredPnpm = $requiredPnpm
  docker = $dockerVersion
  compose = $composeVersion
  warnings = @($warnings)
  failures = @($failures)
}

$result | ConvertTo-Json -Depth 4

if ($failures.Count -gt 0) {
  exit 1
}
