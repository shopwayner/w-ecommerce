param(
  [string]$VpsHost = "187.77.62.188",
  [string]$VpsUser = "root",
  [string]$RemoteDir = "/opt/w-ecommerce",
  [string]$BaseUrl = "http://187.77.62.188:3010",
  [string]$LoginEmail = "crowner@admin.com",
  [string]$MasterPasswordEnvName = "W_ECOMMERCE_MASTER_PASSWORD",
  [string]$SshKeyPathEnvName = "W_ECOMMERCE_SSH_KEY_PATH",
  [string]$SshPortEnvName = "W_ECOMMERCE_SSH_PORT",
  [switch]$RunProductionSeed,
  [switch]$ResetMasterPassword
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$deployDir = "C:\deploy"
$packagePath = Join-Path $deployDir "w-ecommerce-deploy.tar.gz"
$manifestPath = Join-Path $deployDir "w-ecommerce-deploy.manifest.json"
$archivePath = Join-Path $env:TEMP ("w-ecommerce-git-archive-" + [guid]::NewGuid().ToString("N") + ".tar")
$stageRoot = Join-Path $env:TEMP ("w-ecommerce-deploy-stage-" + [guid]::NewGuid().ToString("N"))
$remotePackage = "/opt/w-ecommerce-deploy.tar.gz"
$remoteManifest = "/opt/w-ecommerce-deploy.manifest.json"
$remoteTarget = "${VpsUser}@${VpsHost}:${remotePackage}"
$remoteManifestTarget = "${VpsUser}@${VpsHost}:${remoteManifest}"
$sshOptions = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=12")
$scpOptions = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=12")
$requiredDeployPaths = @(
  "package.json",
  "package-lock.json",
  "Dockerfile",
  "docker-compose.yml",
  "app",
  "components",
  "lib",
  "prisma",
  "public",
  "scripts",
  "instrumentation.ts",
  "instrumentation.node.ts"
)
$criticalRuntimePaths = @(
  "instrumentation.ts",
  "instrumentation.node.ts",
  "lib/services/bling-product-import-service.ts",
  "lib/services/bling-product-update-service.ts",
  "app/api/products/import-from-bling/route.ts",
  "app/api/products/route.ts",
  "components/pages/products-page.tsx",
  "lib/services/bling-oauth-service.ts"
)

function Assert-Command {
  param([string]$Name)

  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Comando obrigatorio nao encontrado: $Name"
  }
}

function Invoke-Checked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$WorkingDirectory = $projectRoot
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "Comando falhou: $FilePath $($Arguments -join ' ')"
  }
}

function Invoke-GitCapture {
  param([string[]]$Arguments)

  $output = & git.exe -C $projectRoot @Arguments 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Validacao Git falhou."
  }

  return (($output | Out-String).Trim())
}

function Test-GitExitCode {
  param([string[]]$Arguments)

  & git.exe -C $projectRoot @Arguments *> $null
  return $LASTEXITCODE -eq 0
}

function Get-ValidatedGitDeployState {
  $insideWorkTree = Invoke-GitCapture @("rev-parse", "--is-inside-work-tree")
  if ($insideWorkTree -ne "true") {
    throw "Deploy bloqueado: o projeto nao esta em um repositorio Git valido."
  }

  if (-not (Test-GitExitCode @("remote", "get-url", "origin"))) {
    throw "Deploy bloqueado: o remote origin nao existe."
  }

  if (-not (Test-GitExitCode @("fetch", "origin", "--prune"))) {
    throw "Deploy bloqueado: git fetch origin --prune falhou."
  }

  if (-not (Test-GitExitCode @("rev-parse", "--verify", "refs/remotes/origin/main^{commit}"))) {
    throw "Deploy bloqueado: origin/main nao existe."
  }

  $branchOutput = & git.exe -C $projectRoot symbolic-ref --quiet --short HEAD 2>$null
  if ($LASTEXITCODE -ne 0) {
    throw "Deploy bloqueado: HEAD detached."
  }
  $branch = (($branchOutput | Out-String).Trim())

  $unmerged = Invoke-GitCapture @("ls-files", "-u")
  if ($unmerged) {
    throw "Deploy bloqueado: existem conflitos nao resolvidos."
  }

  if (-not (Test-GitExitCode @("diff", "--quiet", "--ignore-submodules", "--"))) {
    throw "Deploy bloqueado: existem alteracoes rastreadas nao commitadas."
  }

  if (-not (Test-GitExitCode @("diff", "--cached", "--quiet", "--ignore-submodules", "--"))) {
    throw "Deploy bloqueado: existem alteracoes em staging."
  }

  $untracked = Invoke-GitCapture @("ls-files", "--others", "--exclude-standard")
  if ($untracked) {
    throw "Deploy bloqueado: existem arquivos nao rastreados."
  }

  if (-not (Test-GitExitCode @("merge-base", "--is-ancestor", "origin/main", "HEAD"))) {
    throw "Deploy bloqueado: a branch local nao esta baseada no origin/main atual."
  }

  $localCommit = Invoke-GitCapture @("rev-parse", "HEAD")
  $remoteCommit = Invoke-GitCapture @("rev-parse", "origin/main")
  if ($localCommit -ne $remoteCommit) {
    throw "Deploy bloqueado: HEAD difere de origin/main."
  }

  Write-Host "GIT_BRANCH=$branch"
  Write-Host "GIT_LOCAL_COMMIT=$localCommit"
  Write-Host "GIT_REMOTE_COMMIT=$remoteCommit"
  Write-Host "GIT_STATE=clean"

  return [pscustomobject]@{
    Branch = $branch
    LocalCommit = $localCommit
    RemoteCommit = $remoteCommit
  }
}

function Assert-DeployPackageContent {
  param(
    [string]$Root,
    [string[]]$ArchiveEntries
  )

  foreach ($requiredPath in $requiredDeployPaths) {
    if (-not (Test-Path -LiteralPath (Join-Path $Root $requiredPath))) {
      throw "Pacote invalido: caminho obrigatorio ausente: $requiredPath"
    }
  }

  $forbiddenPatterns = @(
    '(^|/)\.git(/|$)',
    '(^|/)node_modules(/|$)',
    '(^|/)\.next(/|$)',
    '(^|/)\.env$',
    '(^|/)\.env\.production$',
    '(^|/)\.env\.local$',
    '(^|/)\.env\.development$',
    '(^|/)\.env\.test$',
    '(^|/)\.deploy-backups(/|$)'
  )

  foreach ($entry in $ArchiveEntries) {
    $normalizedEntry = ($entry -replace '^\./', '').TrimEnd('/')
    foreach ($pattern in $forbiddenPatterns) {
      if ($normalizedEntry -match $pattern) {
        throw "Pacote invalido: conteudo proibido encontrado: $normalizedEntry"
      }
    }
  }
}

function Get-CriticalRuntimeHashes {
  param([string]$Root)

  return @($criticalRuntimePaths | ForEach-Object {
    $fullPath = Join-Path $Root $_
    if (-not (Test-Path -LiteralPath $fullPath -PathType Leaf)) {
      throw "Arquivo runtime critico ausente: $_"
    }

    [pscustomobject]@{
      path = $_
      sha256 = (Get-FileHash -LiteralPath $fullPath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
  })
}

function Write-Utf8JsonWithoutBom {
  param(
    [string]$Path,
    [object]$Value
  )

  $json = $Value | ConvertTo-Json -Depth 8
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, $json, $encoding)
}

function Get-SafeCommandForError {
  param(
    [string]$FilePath,
    [string[]]$Arguments
  )

  $safeArguments = $Arguments | ForEach-Object {
    if ($_ -match "^[A-Za-z]:\\.*\\.ssh\\|^/.*\\.ssh/") {
      "[ssh-key-path]"
    } else {
      $_
    }
  }

  return "$FilePath $($safeArguments -join ' ')"
}

function Invoke-RemoteChecked {
  param(
    [string]$FilePath,
    [string[]]$Arguments,
    [string]$FriendlyAction
  )

  & $FilePath @Arguments
  if ($LASTEXITCODE -ne 0) {
    Write-Host ""
    Write-Host "ERRO: falha em $FriendlyAction."
    Write-Host "Diagnostico provavel:"
    Write-Host "- chave SSH publica ainda nao autorizada na VPS"
    Write-Host "- usuario SSH sem permissao para acessar $VpsUser@$VpsHost"
    Write-Host "- porta SSH incorreta"
    Write-Host "- BatchMode=yes bloqueou login por senha, como esperado para automacao segura"
    Write-Host ""
    Write-Host "Configure $SshKeyPathEnvName com o caminho da chave privada local autorizada."
    Write-Host "Se a porta SSH nao for 22, configure $SshPortEnvName."
    throw "Comando remoto falhou: $(Get-SafeCommandForError -FilePath $FilePath -Arguments $Arguments)"
  }
}

function ConvertTo-PlainText {
  param([Security.SecureString]$SecureString)

  $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($SecureString)
  try {
    [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
  } finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
  }
}

function Get-LocalEnvValue {
  param([string]$Name)

  $fromProcess = [Environment]::GetEnvironmentVariable($Name)
  if ($fromProcess) {
    return $fromProcess.Trim()
  }

  $localEnvPath = Join-Path $projectRoot ".env"
  if (-not (Test-Path -LiteralPath $localEnvPath)) {
    return ""
  }

  foreach ($line in Get-Content -LiteralPath $localEnvPath) {
    if ($line -match "^\s*#" -or $line -notmatch "=") {
      continue
    }

    $parts = $line -split "=", 2
    if ($parts[0].Trim() -eq $Name) {
      return $parts[1].Trim().Trim('"')
    }
  }

  return ""
}

function Initialize-SshOptions {
  $configuredKeyPath = Get-LocalEnvValue $SshKeyPathEnvName
  $configuredPort = Get-LocalEnvValue $SshPortEnvName

  if ($configuredKeyPath) {
    $expandedKeyPath = $configuredKeyPath.Replace("~", $HOME)
    if (-not (Test-Path -LiteralPath $expandedKeyPath)) {
      throw "Chave SSH configurada em $SshKeyPathEnvName nao encontrada."
    }

    $script:sshOptions += @("-i", $expandedKeyPath, "-o", "IdentitiesOnly=yes")
    $script:scpOptions += @("-i", $expandedKeyPath, "-o", "IdentitiesOnly=yes")
    Write-Host "==> Usando chave SSH configurada em $SshKeyPathEnvName"
  } else {
    Write-Host "==> Nenhuma chave especifica configurada; usando chaves padrao do agente/usuario SSH."
  }

  if ($configuredPort) {
    if ($configuredPort -notmatch "^\d+$") {
      throw "$SshPortEnvName deve ser numerico."
    }

    $script:sshOptions += @("-p", $configuredPort)
    $script:scpOptions += @("-P", $configuredPort)
    Write-Host "==> Usando porta SSH configurada em $SshPortEnvName"
  }
}

function Test-SshAccess {
  Write-Host "==> Verificando acesso SSH sem senha para $VpsUser@$VpsHost"
  Invoke-RemoteChecked "ssh.exe" ($sshOptions + @("${VpsUser}@${VpsHost}", "cd '$RemoteDir' && pwd >/dev/null")) "validacao de acesso SSH"
}

function Get-LastHttpStatus {
  param([string]$HeadersPath)

  $statusLines = Get-Content -LiteralPath $HeadersPath | Where-Object { $_ -match "^HTTP/" }
  if (-not $statusLines) {
    return ""
  }

  $lastStatus = $statusLines[-1]
  if ($lastStatus -match "\s(\d{3})\s") {
    return $Matches[1]
  }

  return ""
}

function Get-SanitizedHeaders {
  param([string]$HeadersPath)

  Get-Content -LiteralPath $HeadersPath | ForEach-Object {
    if ($_ -match "^[sS][eE][tT]-[cC][oO][oO][kK][iI][eE]:|^[cC][oO][oO][kK][iI][eE]:|^[aA][uU][tT][hH][oO][rR][iI][zZ][aA][tT][iI][oO][nN]:") {
      return ($_ -replace ":\s*.*$", ": [redacted]")
    }

    $_
  }
}

function Show-HttpDiagnostics {
  param(
    [string]$Title,
    [string]$HeadersPath,
    [string]$BodyPath
  )

  Write-Host "==> Diagnostico: $Title"
  Write-Host "Headers salvos em: $HeadersPath"
  Write-Host "Body salvo em: $BodyPath"
  Write-Host "-- Headers sanitizados --"
  Get-SanitizedHeaders $HeadersPath | ForEach-Object { Write-Host $_ }
  Write-Host "-- Body --"
  if (Test-Path -LiteralPath $BodyPath) {
    Get-Content -LiteralPath $BodyPath | ForEach-Object { Write-Host $_ }
  }
}

function Invoke-MasterPasswordReset {
  param(
    [string]$Password
  )

  $remoteNodeScript = "/tmp/w-ecommerce-reset-master-password.js"
  $containerNodeScript = "/app/w-ecommerce-reset-master-password.js"
  $localNodeScript = Join-Path $env:TEMP ("w-ecommerce-reset-master-password-" + [guid]::NewGuid().ToString("N") + ".js")
  $nodeScript = @'
const { PrismaClient } = require("@prisma/client");
const bcrypt = require("bcryptjs");

const prisma = new PrismaClient();
const email = process.env.MASTER_EMAIL || "crowner@admin.com";
const organizationSlug = "w-ecommerce-master";

async function readPassword() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

async function main() {
  const password = await readPassword();
  if (!password || password.length < 8) {
    throw new Error("Senha master invalida ou curta demais.");
  }

  const passwordHash = await bcrypt.hash(password, 12);
  const organization = await prisma.organization.upsert({
    where: { slug: organizationSlug },
    update: {
      name: "W Ecommerce Master",
      status: "ACTIVE"
    },
    create: {
      name: "W Ecommerce Master",
      slug: organizationSlug,
      status: "ACTIVE"
    }
  });

  const user = await prisma.user.upsert({
    where: { email },
    update: {
      name: "Crowner Master",
      passwordHash,
      status: "ACTIVE"
    },
    create: {
      email,
      name: "Crowner Master",
      passwordHash,
      status: "ACTIVE"
    }
  });

  await prisma.organizationUser.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: user.id
      }
    },
    update: { role: "OWNER" },
    create: {
      organizationId: organization.id,
      userId: user.id,
      role: "OWNER"
    }
  });

  console.log("OK: usuario master ACTIVE, organizacao master ativa e vinculo OWNER garantidos.");
}

main()
  .catch((error) => {
    console.error(`ERRO: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
'@

  Set-Content -LiteralPath $localNodeScript -Value $nodeScript -Encoding UTF8
  try {
    Write-Host "==> Enviando script temporario de reset para a VPS"
    Invoke-RemoteChecked "scp.exe" ($scpOptions + @($localNodeScript, "${VpsUser}@${VpsHost}:${remoteNodeScript}")) "envio do script temporario de reset"

    $remoteResetCommand = @"
cd "$RemoteDir" || exit 1
docker cp "$remoteNodeScript" w-ecommerce-app:"$containerNodeScript" || exit 1
docker exec -i -e MASTER_EMAIL="$LoginEmail" w-ecommerce-app node "$containerNodeScript"
RESET_EXIT="`$?"
docker exec w-ecommerce-app rm -f "$containerNodeScript" >/dev/null 2>&1 || true
rm -f "$remoteNodeScript"
if [ "`$RESET_EXIT" -ne 0 ]; then
  echo "ERRO: reset de senha master falhou dentro do container." >&2
  docker logs --tail=120 w-ecommerce-app >&2 || true
  exit "`$RESET_EXIT"
fi
"@

    Write-Host "==> Resetando senha master dentro do container w-ecommerce-app"
    $normalizedRemoteResetCommand = $remoteResetCommand -replace "`r`n?", "`n"
    ($Password + "`n") | ssh.exe @sshOptions "${VpsUser}@${VpsHost}" $normalizedRemoteResetCommand
    if ($LASTEXITCODE -ne 0) {
      throw "Falha ao resetar senha master no container w-ecommerce-app."
    }
  } finally {
    Remove-Item -LiteralPath $localNodeScript -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-ProductionStateValidation {
  $remoteNodeScript = "/tmp/w-ecommerce-validate-production.js"
  $containerNodeScript = "/app/w-ecommerce-validate-production.js"
  $localNodeScript = Join-Path $env:TEMP ("w-ecommerce-validate-production-" + [guid]::NewGuid().ToString("N") + ".js")
  $nodeScript = @'
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

async function main() {
  const email = (process.env.MASTER_EMAIL || "crowner@admin.com").toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email },
    include: {
      organizationUsers: {
        include: {
          organization: {
            include: {
              subscription: {
                include: { plan: true }
              }
            }
          }
        }
      }
    }
  });

  const membership = user?.organizationUsers.find(
    (item) => item.role === "OWNER" && item.organization.status === "ACTIVE"
  );
  const subscription = membership?.organization.subscription;

  if (!user || user.status !== "ACTIVE" || !membership || !subscription || subscription.status !== "ACTIVE") {
    throw new Error("Validacao de producao falhou: usuario, organizacao ou assinatura ativa ausente.");
  }

  const subscriptionCount = await prisma.subscription.count({
    where: { organizationId: membership.organizationId }
  });

  if (subscriptionCount !== 1) {
    throw new Error("Validacao de producao falhou: assinatura duplicada ou ausente (" + subscriptionCount + ").");
  }

  console.log(
    "OK: usuario ACTIVE OWNER, organizacao " +
      (membership.organization.slug || membership.organization.name) +
      ", plano " +
      subscription.plan.code +
      ", assinatura ACTIVE, subscriptionCount " +
      subscriptionCount +
      "."
  );
}

main()
  .catch((error) => {
    console.error("ERRO: " + error.message);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
'@

  Set-Content -LiteralPath $localNodeScript -Value $nodeScript -Encoding UTF8
  try {
    Write-Host "==> Enviando script temporario de validacao de producao para a VPS"
    Invoke-RemoteChecked "scp.exe" ($scpOptions + @($localNodeScript, "${VpsUser}@${VpsHost}:${remoteNodeScript}")) "envio do script temporario de validacao"

    $remoteValidationCommand = @"
cd "$RemoteDir" || exit 1
docker cp "$remoteNodeScript" w-ecommerce-app:"$containerNodeScript" || exit 1
docker exec -e MASTER_EMAIL="$LoginEmail" w-ecommerce-app node "$containerNodeScript"
VALIDATION_EXIT="`$?"
docker exec w-ecommerce-app rm -f "$containerNodeScript" >/dev/null 2>&1 || true
rm -f "$remoteNodeScript"
if [ "`$VALIDATION_EXIT" -ne 0 ]; then
  echo "ERRO: validacao de producao falhou dentro do container." >&2
  docker logs --tail=120 w-ecommerce-app >&2 || true
  exit "`$VALIDATION_EXIT"
fi
"@

    Write-Host "==> Validando assinatura ativa e papel OWNER da conta master"
    $normalizedRemoteValidationCommand = $remoteValidationCommand -replace "`r`n?", "`n"
    ssh.exe @sshOptions "${VpsUser}@${VpsHost}" $normalizedRemoteValidationCommand
    if ($LASTEXITCODE -ne 0) {
      throw "Falha ao validar estado de producao no container w-ecommerce-app."
    }
  } finally {
    Remove-Item -LiteralPath $localNodeScript -Force -ErrorAction SilentlyContinue
  }
}

function Invoke-AuthFlowValidation {
  param(
    [string]$Password
  )

  $remoteNodeScript = "/tmp/w-ecommerce-validate-auth-flow.js"
  $containerNodeScript = "/app/w-ecommerce-validate-auth-flow.js"
  $localNodeScript = Join-Path $env:TEMP ("w-ecommerce-validate-auth-flow-" + [guid]::NewGuid().ToString("N") + ".js")
  $nodeScript = @'
async function readPassword() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString("utf8").replace(/\r?\n$/, "");
}

function requireStatus(response, expectedStatus, label) {
  if (response.status !== expectedStatus) {
    throw new Error(label + " retornou HTTP " + response.status + ".");
  }
}

async function main() {
  const password = await readPassword();
  const email = process.env.MASTER_EMAIL || "crowner@admin.com";
  const baseUrl = process.env.PUBLIC_BASE_URL || "";
  const internalBaseUrl = "http://127.0.0.1:3000";

  if (!password) {
    throw new Error("Senha master ausente no teste de autenticacao.");
  }

  const loginResponse = await fetch(internalBaseUrl + "/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password })
  });

  requireStatus(loginResponse, 200, "Login");

  const loginSetCookie = loginResponse.headers.get("set-cookie") || "";
  if (!/^matrix_session=/.test(loginSetCookie)) {
    throw new Error("Login nao retornou Set-Cookie para matrix_session.");
  }

  const sessionCookie = loginSetCookie.split(";")[0];
  const logoutResponse = await fetch(internalBaseUrl + "/api/auth/logout", {
    method: "POST",
    headers: { cookie: sessionCookie }
  });

  requireStatus(logoutResponse, 200, "Logout");

  const logoutSetCookie = logoutResponse.headers.get("set-cookie") || "";
  if (!/^matrix_session=/.test(logoutSetCookie)) {
    throw new Error("Logout nao retornou Set-Cookie para matrix_session.");
  }

  if (baseUrl.startsWith("http://") && /;\s*Secure(?:;|$)/i.test(logoutSetCookie)) {
    throw new Error("Logout em HTTP retornou Set-Cookie com Secure.");
  }

  if (baseUrl.startsWith("https://") && !/;\s*Secure(?:;|$)/i.test(logoutSetCookie)) {
    throw new Error("Logout em HTTPS nao retornou Set-Cookie com Secure.");
  }

  console.log("OK: login/logout validados e regra Secure do cookie confirmada para " + (baseUrl.startsWith("https://") ? "HTTPS" : "HTTP") + ".");
}

main().catch((error) => {
  console.error("ERRO: " + error.message);
  process.exitCode = 1;
});
'@

  Set-Content -LiteralPath $localNodeScript -Value $nodeScript -Encoding UTF8
  try {
    Write-Host "==> Enviando script temporario de validacao de login/logout para a VPS"
    Invoke-RemoteChecked "scp.exe" ($scpOptions + @($localNodeScript, "${VpsUser}@${VpsHost}:${remoteNodeScript}")) "envio do script temporario de login/logout"

    $remoteAuthCommand = @"
cd "$RemoteDir" || exit 1
docker cp "$remoteNodeScript" w-ecommerce-app:"$containerNodeScript" || exit 1
docker exec -i -e MASTER_EMAIL="$LoginEmail" -e PUBLIC_BASE_URL="$BaseUrl" w-ecommerce-app node "$containerNodeScript"
AUTH_EXIT="`$?"
docker exec w-ecommerce-app rm -f "$containerNodeScript" >/dev/null 2>&1 || true
rm -f "$remoteNodeScript"
if [ "`$AUTH_EXIT" -ne 0 ]; then
  echo "ERRO: validacao de login/logout falhou dentro do container." >&2
  docker logs --tail=120 w-ecommerce-app >&2 || true
  exit "`$AUTH_EXIT"
fi
"@

    Write-Host "==> Validando login/logout e regra Secure do cookie"
    $normalizedRemoteAuthCommand = $remoteAuthCommand -replace "`r`n?", "`n"
    ($Password + "`n") | ssh.exe @sshOptions "${VpsUser}@${VpsHost}" $normalizedRemoteAuthCommand
    if ($LASTEXITCODE -ne 0) {
      throw "Falha ao validar login/logout no container w-ecommerce-app."
    }
  } finally {
    Remove-Item -LiteralPath $localNodeScript -Force -ErrorAction SilentlyContinue
  }
}

try {
Set-Location -LiteralPath $projectRoot

Assert-Command "npm.cmd"
Assert-Command "npx.cmd"
Assert-Command "ssh.exe"
Assert-Command "scp.exe"
Assert-Command "curl.exe"
Assert-Command "tar.exe"
Assert-Command "git.exe"

$gitDeployState = Get-ValidatedGitDeployState
$deployCommit = $gitDeployState.LocalCommit
$deployBranch = $gitDeployState.Branch

Initialize-SshOptions
Test-SshAccess

Write-Host "==> Validando projeto local"
Invoke-Checked "npx.cmd" @("prisma", "validate")
Invoke-Checked "npm.cmd" @("run", "lint")
Invoke-Checked "npm.cmd" @("run", "build")

Write-Host "==> Preparando pacote exclusivamente a partir do commit $deployCommit"
if (-not (Test-Path -LiteralPath $deployDir)) {
  New-Item -ItemType Directory -Path $deployDir | Out-Null
}
Remove-Item -LiteralPath $packagePath, $manifestPath, $archivePath -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Path $stageRoot | Out-Null

foreach ($requiredPath in $requiredDeployPaths) {
  if (-not (Test-GitExitCode @("cat-file", "-e", "${deployCommit}:$requiredPath"))) {
    throw "Deploy bloqueado: caminho obrigatorio nao rastreado no commit: $requiredPath"
  }
}

Invoke-Checked "git.exe" @(
  "-C",
  $projectRoot,
  "archive",
  "--format=tar",
  "--output=$archivePath",
  $deployCommit
)
Invoke-Checked "tar.exe" @("-xf", $archivePath, "-C", $stageRoot)

Write-Host "==> Gerando pacote tar.gz compativel com Linux em $packagePath"
Invoke-Checked "tar.exe" @("-czf", $packagePath, "-C", $stageRoot, ".")

$archiveEntries = @(& tar.exe -tzf $packagePath)
if ($LASTEXITCODE -ne 0) {
  throw "Pacote invalido: tar nao conseguiu listar o arquivo compactado."
}
if ($archiveEntries.Count -eq 0) {
  throw "Pacote invalido: arquivo compactado vazio."
}
Assert-DeployPackageContent -Root $stageRoot -ArchiveEntries $archiveEntries

$criticalRuntimeHashes = Get-CriticalRuntimeHashes -Root $stageRoot
$packageSha256 = (Get-FileHash -LiteralPath $packagePath -Algorithm SHA256).Hash.ToLowerInvariant()
$deployManifest = [ordered]@{
  formatVersion = 1
  commitSha = $deployCommit
  branch = $deployBranch
  packagedAtUtc = [DateTime]::UtcNow.ToString("o")
  packageSha256 = $packageSha256
  criticalFiles = $criticalRuntimeHashes
}
Write-Utf8JsonWithoutBom -Path $manifestPath -Value $deployManifest

$parsedManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
if (
  $parsedManifest.commitSha -ne $deployCommit -or
  $parsedManifest.packageSha256 -ne $packageSha256 -or
  $parsedManifest.formatVersion -ne 1
) {
  throw "Manifesto local invalido ou divergente do commit validado."
}
$manifestSha256 = (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLowerInvariant()

$requiredPathShellEntries = ($requiredDeployPaths | ForEach-Object { "  `"$_`"" }) -join "`n"
$criticalHashShellEntries = ($criticalRuntimeHashes | ForEach-Object {
  "  `"$($_.path)|$($_.sha256)`""
}) -join "`n"

Write-Host "PACKAGE_SHA256=$packageSha256"
Write-Host "MANIFEST_SHA256=$manifestSha256"
Write-Host "==> Enviando pacote e manifesto para a VPS"
Invoke-RemoteChecked "scp.exe" ($scpOptions + @($packagePath, $remoteTarget)) "envio do pacote de deploy"
Invoke-RemoteChecked "scp.exe" ($scpOptions + @($manifestPath, $remoteManifestTarget)) "envio do manifesto de deploy"

$remoteSeedCommands = if ($RunProductionSeed) {
@'
echo "==> Seed de producao: executando por solicitacao explicita"
echo "==> Rodando seed de producao seguro - primeira execucao"
docker exec w-ecommerce-app npm run seed:production || fail_remote "Seed de producao falhou na primeira execucao."

echo "==> Rodando seed de producao seguro - segunda execucao"
docker exec w-ecommerce-app npm run seed:production || fail_remote "Seed de producao falhou na segunda execucao."
'@
} else {
@'
echo "==> Seed de producao: ignorado"
'@
}

$remoteScript = @"
set -euo pipefail

REMOTE_DIR="$RemoteDir"
REMOTE_PACKAGE="$remotePackage"
REMOTE_MANIFEST="$remoteManifest"
EXPECTED_COMMIT="$deployCommit"
EXPECTED_PACKAGE_SHA="$packageSha256"
EXPECTED_MANIFEST_SHA="$manifestSha256"
APP_URL_LINE="APP_URL=$BaseUrl"
ENV_BACKUP=""
RELEASE_DIR=""
PERSIST_BACKUP=""
BACKUP_PATH=""
BACKUP_SHA=""
CODE_REPLACED=0
ROLLBACK_IN_PROGRESS=0

REQUIRED_PATHS=(
$requiredPathShellEntries
)

CRITICAL_HASHES=(
$criticalHashShellEntries
)

cleanup_remote_temporary() {
  if [ -n "`$RELEASE_DIR" ] && [ -d "`$RELEASE_DIR" ]; then
    rm -rf -- "`$RELEASE_DIR"
  fi
  if [ -n "`$PERSIST_BACKUP" ] && [ -d "`$PERSIST_BACKUP" ]; then
    rm -rf -- "`$PERSIST_BACKUP"
  fi
  if [ -n "`$ENV_BACKUP" ] && [ -f "`$ENV_BACKUP" ]; then
    rm -f -- "`$ENV_BACKUP"
  fi
  rm -f -- "`$REMOTE_PACKAGE" "`$REMOTE_MANIFEST"
}

trap cleanup_remote_temporary EXIT

clean_code_root() {
  local current_dir
  current_dir="`$(pwd -P)"

  if [ "`$current_dir" != "/opt/w-ecommerce" ]; then
    echo "ERRO: substituicao de codigo recusada fora de /opt/w-ecommerce: `$current_dir" >&2
    return 1
  fi

  find . -mindepth 1 -maxdepth 1 \
    ! -name '.env.production' \
    ! -name '.deploy-backups' \
    ! -name 'uploads' \
    ! -name 'images' \
    ! -name 'backups' \
    -exec rm -rf -- {} +
}

preserve_nested_persistent_paths() {
  local source_root="`$1"
  local destination_root="`$2"
  local persistent_path

  mkdir -p "`$destination_root"
  for persistent_path in public/uploads public/images; do
    if [ -d "`$source_root/`$persistent_path" ]; then
      mkdir -p "`$destination_root/`$(dirname "`$persistent_path")"
      cp -a "`$source_root/`$persistent_path" "`$destination_root/`$persistent_path"
    fi
  done
}

restore_nested_persistent_paths() {
  local source_root="`$1"
  local destination_root="`$2"
  local persistent_path

  for persistent_path in public/uploads public/images; do
    if [ -d "`$source_root/`$persistent_path" ]; then
      mkdir -p "`$destination_root/`$(dirname "`$persistent_path")"
      rm -rf -- "`$destination_root/`$persistent_path"
      cp -a "`$source_root/`$persistent_path" "`$destination_root/`$persistent_path"
    fi
  done
}

validate_critical_hashes() {
  local root="`$1"
  local label="`$2"
  local entry path expected actual

  for entry in "`$`{CRITICAL_HASHES[@]`}`"; do
    path="`$`{entry%%|*`}"
    expected="`$`{entry#*|`}"
    if [ ! -f "`$root/`$path" ]; then
      echo "ERRO: arquivo critico ausente em `$label: `$path" >&2
      return 1
    fi
    actual="`$(sha256sum "`$root/`$path" | awk '{print `$1}')"
    if [ "`$actual" != "`$expected" ]; then
      echo "ERRO: hash divergente em `$label: `$path" >&2
      return 1
    fi
  done

  echo "OK: hashes criticos conferidos em `$label."
}

validate_container_critical_hashes() {
  local entry path expected actual

  for entry in "`$`{CRITICAL_HASHES[@]`}`"; do
    path="`$`{entry%%|*`}"
    expected="`$`{entry#*|`}"
    actual="`$(docker exec w-ecommerce-app sha256sum "/app/`$path" 2>/dev/null | awk '{print `$1}')"
    if [ -z "`$actual" ] || [ "`$actual" != "`$expected" ]; then
      echo "ERRO: hash divergente no container: `$path" >&2
      return 1
    fi
  done

  echo "OK: hashes criticos conferidos em /app."
}

rollback_code() {
  if [ "`$CODE_REPLACED" != "1" ] || [ "`$ROLLBACK_IN_PROGRESS" = "1" ]; then
    return 0
  fi

  ROLLBACK_IN_PROGRESS=1
  echo "==> Rollback restrito ao codigo usando `$BACKUP_PATH" >&2

  if [ -z "`$BACKUP_PATH" ] || [ ! -s "`$BACKUP_PATH" ] || ! tar -tzf "`$BACKUP_PATH" >/dev/null; then
    echo "ERRO: backup de codigo indisponivel ou invalido; rollback nao executado." >&2
    return 1
  fi

  local rollback_env rollback_persistent
  rollback_env="`$(mktemp /tmp/w-ecommerce.rollback-env.XXXXXX)"
  rollback_persistent="`$(mktemp -d /tmp/w-ecommerce.rollback-persistent.XXXXXX)"
  cp "$RemoteDir/.env.production" "`$rollback_env" || return 1
  preserve_nested_persistent_paths "$RemoteDir" "`$rollback_persistent" || return 1

  cd "$RemoteDir" || return 1
  clean_code_root || return 1
  tar -xzf "`$BACKUP_PATH" -C "$RemoteDir" || return 1
  mv "`$rollback_env" "$RemoteDir/.env.production" || return 1
  restore_nested_persistent_paths "`$rollback_persistent" "$RemoteDir" || return 1
  rm -rf -- "`$rollback_persistent"

  if [ ! -f docker-compose.yml ]; then
    echo "ERRO: backup nao contem docker-compose.yml; app anterior nao foi recriado." >&2
    return 1
  fi

  docker compose --env-file .env.production -f docker-compose.yml build app || return 1
  docker compose --env-file .env.production -f docker-compose.yml up -d --no-deps --force-recreate app || return 1
  CODE_REPLACED=0
  echo "ROLLBACK_SOURCE=`$BACKUP_PATH" >&2
  echo "OK: rollback restaurou somente o codigo e recriou somente o app." >&2
}

fail_remote() {
  local message="`$1"
  echo "ERRO: `$message" >&2
  rollback_code || echo "ERRO: rollback restrito ao codigo nao foi concluido." >&2
  if [ -d "$RemoteDir" ]; then
    cd "$RemoteDir" || true
    echo "==> docker compose ps" >&2
    docker compose --env-file .env.production -f docker-compose.yml ps >&2 || true
  fi
  echo "==> docker logs --tail=120 w-ecommerce-app" >&2
  docker logs --tail=120 w-ecommerce-app >&2 || true
  exit 1
}

Wait-RemoteHttpReady() {
  local url="http://127.0.0.1:3010/login"
  local max_attempts=30
  local attempt=1
  local http_code=""
  local curl_output=""

  while [ "`$attempt" -le "`$max_attempts" ]; do
    echo "Aguardando app responder... tentativa `$attempt/`$max_attempts"

    set +e
    curl_output="`$(curl -sS -o /dev/null -w "%{http_code}" --max-time 5 "`$url" 2>&1)"
    local curl_exit="`$?"
    set -e

    if [ "`$curl_exit" -eq 0 ]; then
      http_code="`$curl_output"
      if [ "`$http_code" = "200" ] || [ "`$http_code" = "307" ] || [ "`$http_code" = "308" ]; then
        echo "OK: app respondeu em `$url com HTTP `$http_code"
        return 0
      fi
    fi

    sleep 2
    attempt="`$((attempt + 1))"
  done

  echo "ERRO: app nao respondeu em ate 60 segundos em `$url." >&2
  echo "==> docker compose ps apos timeout" >&2
  docker compose --env-file .env.production -f docker-compose.yml ps >&2 || true
  echo "==> logs recentes do w-ecommerce-app apos timeout" >&2
  docker logs --tail=120 w-ecommerce-app >&2 || true
  return 1
}

container_running() {
  local container="`$1"
  [ "`$(docker inspect -f '{{.State.Running}}' "`$container" 2>/dev/null || true)" = "true" ]
}

container_healthy_or_no_healthcheck() {
  local container="`$1"
  local health="`$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "`$container" 2>/dev/null || true)"
  [ "`$health" = "healthy" ] || [ "`$health" = "none" ]
}

ensure_dependency_service() {
  local service="`$1"
  local container="`$2"

  if container_running "`$container" && container_healthy_or_no_healthcheck "`$container"; then
    echo "OK: `$container ja esta rodando e saudavel; nao sera recriado."
    return 0
  fi

  echo "==> `$container nao esta rodando/saudavel; iniciando somente o servico dedicado `$service"
  docker compose --env-file .env.production -f docker-compose.yml up -d --no-recreate "`$service" || fail_remote "Falha ao iniciar `$container."
}

mkdir -p "`$REMOTE_DIR"
cd "`$REMOTE_DIR"

if [ "`$(pwd -P)" != "/opt/w-ecommerce" ]; then
  echo "ERRO: diretorio remoto inesperado para deploy: `$(pwd -P)" >&2
  exit 1
fi

if [ ! -f .env.production ]; then
  echo "ERRO: .env.production nao existe em `$REMOTE_DIR. Crie o arquivo antes do deploy." >&2
  exit 1
fi

echo "==> Validando pacote e manifesto recebidos"
if [ ! -s "`$REMOTE_PACKAGE" ] || [ ! -s "`$REMOTE_MANIFEST" ]; then
  fail_remote "Pacote ou manifesto remoto ausente/vazio."
fi

ACTUAL_PACKAGE_SHA="`$(sha256sum "`$REMOTE_PACKAGE" | awk '{print `$1}')"
ACTUAL_MANIFEST_SHA="`$(sha256sum "`$REMOTE_MANIFEST" | awk '{print `$1}')"
if [ "`$ACTUAL_PACKAGE_SHA" != "`$EXPECTED_PACKAGE_SHA" ]; then
  fail_remote "SHA-256 do pacote remoto diverge do manifesto local."
fi
if [ "`$ACTUAL_MANIFEST_SHA" != "`$EXPECTED_MANIFEST_SHA" ]; then
  fail_remote "SHA-256 do manifesto remoto diverge do manifesto local."
fi
grep -Fq "\"commitSha\": \"`$EXPECTED_COMMIT\"" "`$REMOTE_MANIFEST" || fail_remote "Manifesto remoto nao identifica o commit esperado."
grep -Fq "\"packageSha256\": \"`$EXPECTED_PACKAGE_SHA\"" "`$REMOTE_MANIFEST" || fail_remote "Manifesto remoto nao identifica o pacote esperado."

PACKAGE_LIST="`$(mktemp /tmp/w-ecommerce.package-list.XXXXXX)"
tar -tzf "`$REMOTE_PACKAGE" > "`$PACKAGE_LIST" || fail_remote "Pacote tar.gz corrompido ou ilegivel."

RELEASE_DIR="`$(mktemp -d "/opt/w-ecommerce-release-`$EXPECTED_COMMIT.XXXXXX")"
tar -xzf "`$REMOTE_PACKAGE" -C "`$RELEASE_DIR" || fail_remote "Extracao do pacote falhou."
rm -f -- "`$PACKAGE_LIST"

for required_path in "`$`{REQUIRED_PATHS[@]`}`"; do
  if [ ! -e "`$RELEASE_DIR/`$required_path" ]; then
    fail_remote "Extracao incompleta: caminho obrigatorio ausente: `$required_path"
  fi
done

if find "`$RELEASE_DIR" -mindepth 1 \( \
  -name '.git' -o \
  -name 'node_modules' -o \
  -name '.next' -o \
  -name '.env' -o \
  -name '.env.production' \
\) -print -quit | grep -q .; then
  fail_remote "Pacote contem caminho proibido."
fi

validate_critical_hashes "`$RELEASE_DIR" "pacote extraido" || fail_remote "Hashes do pacote extraido divergentes."
cp "`$REMOTE_MANIFEST" "`$RELEASE_DIR/.deploy-manifest.json" || fail_remote "Falha ao anexar manifesto ao contexto limpo."

echo "==> Criando e validando backup do codigo atual"
mkdir -p .deploy-backups
BACKUP_PATH="$RemoteDir/.deploy-backups/source-before-`$(date -u +%Y%m%dT%H%M%SZ).tar.gz"
tar \
  --exclude='./.env.production' \
  --exclude='./.deploy-backups' \
  --exclude='./uploads' \
  --exclude='./images' \
  --exclude='./backups' \
  --exclude='./public/uploads' \
  --exclude='./public/images' \
  -czf "`$BACKUP_PATH" . || fail_remote "Falha ao criar backup do codigo atual."
if [ ! -s "`$BACKUP_PATH" ]; then
  fail_remote "Backup do codigo atual esta vazio."
fi
BACKUP_LIST="`$(tar -tzf "`$BACKUP_PATH")" || fail_remote "Listagem do backup falhou."
if [ -z "`$(printf '%s\n' "`$BACKUP_LIST" | grep -vE '^\./?$' || true)" ]; then
  fail_remote "Backup nao contem arquivos de codigo."
fi
BACKUP_SHA="`$(sha256sum "`$BACKUP_PATH" | awk '{print `$1}')"
echo "BACKUP_SOURCE_BEFORE_SWAP=`$BACKUP_PATH"
echo "BACKUP_SHA256=`$BACKUP_SHA"

ENV_BACKUP="`$(mktemp /tmp/w-ecommerce.env-production.XXXXXX)"
PERSIST_BACKUP="`$(mktemp -d /tmp/w-ecommerce.persistent.XXXXXX)"
cp .env.production "`$ENV_BACKUP" || fail_remote "Falha ao preservar .env.production."
preserve_nested_persistent_paths "$RemoteDir" "`$PERSIST_BACKUP" || fail_remote "Falha ao preservar imagens/uploads publicos."

echo "==> Substituindo deterministicamente somente o conjunto de codigo"
CODE_REPLACED=1
clean_code_root || fail_remote "Limpeza deterministica do codigo anterior falhou."
cp -a "`$RELEASE_DIR"/. "$RemoteDir"/ || fail_remote "Copia do release validado falhou."
mv "`$ENV_BACKUP" "$RemoteDir/.env.production" || fail_remote "Restauracao de .env.production falhou."
ENV_BACKUP=""
restore_nested_persistent_paths "`$PERSIST_BACKUP" "$RemoteDir" || fail_remote "Restauracao de imagens/uploads publicos falhou."

cd "$RemoteDir"
if [ -e .next ]; then
  fail_remote "Artefato .next antigo permaneceu no contexto de build."
fi
validate_critical_hashes "$RemoteDir" "/opt/w-ecommerce" || fail_remote "Hashes remotos divergentes."
INSTALLED_MANIFEST_SHA="`$(sha256sum "$RemoteDir/.deploy-manifest.json" | awk '{print `$1}')"
if [ "`$INSTALLED_MANIFEST_SHA" != "`$EXPECTED_MANIFEST_SHA" ]; then
  fail_remote "Manifesto instalado diverge do manifesto validado."
fi

if grep -q "^APP_URL=" .env.production; then
  sed -i "s#^APP_URL=.*#`$APP_URL_LINE#" .env.production
else
  printf "\n%s\n" "`$APP_URL_LINE" >> .env.production
fi

if grep -q "migrate deploy" Dockerfile; then
  echo "ERRO: Dockerfile ainda contem prisma migrate deploy no start." >&2
  exit 1
fi

if [ -f docker-compose.yml ] && grep -q "migrate deploy" docker-compose.yml; then
  fail_remote "docker-compose.yml contem prisma migrate deploy."
fi

POSTGRES_BEFORE="`$(docker inspect -f '{{.Id}}' w-ecommerce-postgres 2>/dev/null || true)"
REDIS_BEFORE="`$(docker inspect -f '{{.Id}}' w-ecommerce-redis 2>/dev/null || true)"
if [ -z "`$POSTGRES_BEFORE" ] || [ -z "`$REDIS_BEFORE" ]; then
  fail_remote "PostgreSQL ou Redis existente nao foi localizado antes do deploy."
fi

echo "==> Build do app W Ecommerce"
(
  cd "`$RELEASE_DIR"
  W_ECOMMERCE_ENV_FILE="$RemoteDir/.env.production" \
    docker compose --env-file "$RemoteDir/.env.production" -f docker-compose.yml build app
) || fail_remote "Build do app falhou."
APP_IMAGE_ID="`$(
  cd "`$RELEASE_DIR"
  W_ECOMMERCE_ENV_FILE="$RemoteDir/.env.production" \
    docker compose --env-file "$RemoteDir/.env.production" -f docker-compose.yml images -q app | head -n 1
)"
if [ -z "`$APP_IMAGE_ID" ]; then
  fail_remote "ID da nova imagem do app nao foi identificado."
fi
echo "APP_IMAGE_ID=`$APP_IMAGE_ID"

echo "==> Verificando dependencias dedicadas do W Ecommerce"
ensure_dependency_service "postgres" "w-ecommerce-postgres"
ensure_dependency_service "redis" "w-ecommerce-redis"

echo "==> Subindo somente o app W Ecommerce sem recriar dependencias saudaveis"
docker compose --env-file .env.production -f docker-compose.yml up -d --no-deps --force-recreate app || fail_remote "Falha ao subir o w-ecommerce-app."

POSTGRES_AFTER="`$(docker inspect -f '{{.Id}}' w-ecommerce-postgres 2>/dev/null || true)"
REDIS_AFTER="`$(docker inspect -f '{{.Id}}' w-ecommerce-redis 2>/dev/null || true)"
if [ "`$POSTGRES_BEFORE" != "`$POSTGRES_AFTER" ]; then
  fail_remote "O container PostgreSQL foi recriado ou substituido."
fi
if [ "`$REDIS_BEFORE" != "`$REDIS_AFTER" ]; then
  fail_remote "O container Redis foi recriado ou substituido."
fi
echo "OK: PostgreSQL e Redis preservaram os mesmos IDs de container."

validate_container_critical_hashes || fail_remote "Hashes do container divergentes."
CONTAINER_MANIFEST_SHA="`$(docker exec w-ecommerce-app sha256sum /app/.deploy-manifest.json 2>/dev/null | awk '{print `$1}')"
if [ "`$CONTAINER_MANIFEST_SHA" != "`$EXPECTED_MANIFEST_SHA" ]; then
  fail_remote "Manifesto dentro do container diverge do manifesto validado."
fi

echo "==> Status dos containers W Ecommerce"
docker compose --env-file .env.production -f docker-compose.yml ps

echo "==> Logs recentes do w-ecommerce-app"
docker logs --tail=80 w-ecommerce-app || true

echo "==> Aguardando /login ficar pronto na VPS"
Wait-RemoteHttpReady || fail_remote "App nao respondeu em /login dentro do tempo limite."

$remoteSeedCommands

echo "DEPLOY_COMMIT=`$EXPECTED_COMMIT"
echo "DEPLOY_PACKAGE_SHA256=`$EXPECTED_PACKAGE_SHA"
echo "DEPLOY_MANIFEST=$RemoteDir/.deploy-manifest.json"
CODE_REPLACED=0
"@

Write-Host "==> Executando deploy remoto somente em $RemoteDir"
($remoteScript -replace "`r`n?", "`n") | ssh.exe @sshOptions "${VpsUser}@${VpsHost}" "bash -se"
if ($LASTEXITCODE -ne 0) {
  Write-Host "ERRO: deploy remoto falhou."
  Write-Host "Verifique chave autorizada, usuario, porta SSH e permissoes em $RemoteDir."
  throw "Deploy remoto falhou."
}

Invoke-ProductionStateValidation

Write-Host "==> Confirmando /login"
& curl.exe -fsSI "$BaseUrl/login" | Out-Null
if ($LASTEXITCODE -ne 0) {
  throw "Falha ao acessar /login."
}

$cookieFile = Join-Path $env:TEMP ("w-ecommerce-cookie-" + [guid]::NewGuid().ToString("N") + ".txt")
$loginHeaders = Join-Path $env:TEMP ("w-ecommerce-login-headers-" + [guid]::NewGuid().ToString("N") + ".txt")
$loginBody = Join-Path $env:TEMP ("w-ecommerce-login-body-" + [guid]::NewGuid().ToString("N") + ".json")
$payloadFile = Join-Path $env:TEMP ("w-ecommerce-login-payload-" + [guid]::NewGuid().ToString("N") + ".json")
$keepDiagnostics = $false

try {
  if ($ResetMasterPassword) {
    Write-Host "==> Reset de senha master solicitado explicitamente; preparando teste de login/logout"
    $plainPassword = Get-LocalEnvValue $MasterPasswordEnvName
    if (-not $plainPassword) {
      $plainPassword = Get-LocalEnvValue "MASTER_ADMIN_PASSWORD"
    }
    if (-not $plainPassword) {
      throw "Senha master nao encontrada. Configure $MasterPasswordEnvName no ambiente ou MASTER_ADMIN_PASSWORD no .env local."
    }

    Invoke-MasterPasswordReset -Password $plainPassword
    Invoke-AuthFlowValidation -Password $plainPassword
  } else {
    Write-Host "==> Reset de senha master ignorado. Use -ResetMasterPassword apenas quando quiser redefinir a senha."
  }
} finally {
  if (Get-Variable -Name plainPassword -Scope Local -ErrorAction SilentlyContinue) {
    $plainPassword = $null
  }
  Remove-Item -LiteralPath $payloadFile -Force -ErrorAction SilentlyContinue
  if (-not $keepDiagnostics) {
    Remove-Item -LiteralPath $cookieFile, $loginHeaders, $loginBody -Force -ErrorAction SilentlyContinue
  } else {
    Remove-Item -LiteralPath $cookieFile -Force -ErrorAction SilentlyContinue
    Write-Host "Diagnosticos de login preservados para revisao:"
    Write-Host "- Headers: $loginHeaders"
    Write-Host "- Body: $loginBody"
  }
}

if ($ResetMasterPassword) {
  Write-Host "Deploy concluido com validacao de login/logout."
} else {
  Write-Host "Deploy concluido sem reset de senha master."
}
} finally {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $archivePath -Force -ErrorAction SilentlyContinue
}
