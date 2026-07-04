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
$stageRoot = Join-Path $env:TEMP ("w-ecommerce-deploy-stage-" + [guid]::NewGuid().ToString("N"))
$remotePackage = "/opt/w-ecommerce-deploy.tar.gz"
$remoteTarget = "${VpsUser}@${VpsHost}:${remotePackage}"
$sshOptions = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=12")
$scpOptions = @("-o", "BatchMode=yes", "-o", "ConnectTimeout=12")

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

Set-Location -LiteralPath $projectRoot

Assert-Command "npm.cmd"
Assert-Command "npx.cmd"
Assert-Command "ssh.exe"
Assert-Command "scp.exe"
Assert-Command "curl.exe"
Assert-Command "robocopy.exe"
Assert-Command "tar.exe"
Initialize-SshOptions
Test-SshAccess

Write-Host "==> Validando projeto local"
Invoke-Checked "npx.cmd" @("prisma", "validate")
Invoke-Checked "npm.cmd" @("run", "lint")
Invoke-Checked "npm.cmd" @("run", "build")

Write-Host "==> Preparando pacote sem node_modules, .next, .git e .env"
if (-not (Test-Path -LiteralPath $deployDir)) {
  New-Item -ItemType Directory -Path $deployDir | Out-Null
}
if (Test-Path -LiteralPath $packagePath) {
  Remove-Item -LiteralPath $packagePath -Force
}
if (Test-Path -LiteralPath $stageRoot) {
  Remove-Item -LiteralPath $stageRoot -Recurse -Force
}
New-Item -ItemType Directory -Path $stageRoot | Out-Null

& robocopy.exe $projectRoot $stageRoot /E /XD node_modules .next .git /XF .env .env.local .env.production .env.development .env.test *.log | Out-Host
if ($LASTEXITCODE -gt 7) {
  throw "Falha ao copiar arquivos para staging. Codigo robocopy: $LASTEXITCODE"
}

Write-Host "==> Gerando pacote tar.gz compativel com Linux em $packagePath"
Push-Location -LiteralPath $stageRoot
try {
  Invoke-Checked "tar.exe" @("-czf", $packagePath, ".") $stageRoot
} finally {
  Pop-Location
}

Write-Host "==> Enviando pacote para a VPS"
Invoke-RemoteChecked "scp.exe" ($scpOptions + @($packagePath, $remoteTarget)) "envio do pacote de deploy"

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
APP_URL_LINE="APP_URL=$BaseUrl"
ENV_BACKUP="/tmp/w-ecommerce.env.production.$$"
COMPOSE_BACKUP="/tmp/w-ecommerce.docker-compose.$$"
PRESERVE_COMPOSE=0

fail_remote() {
  local message="`$1"
  echo "ERRO: `$message" >&2
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

clean_managed_source_paths() {
  local current_dir
  current_dir="`$(pwd -P)"

  if [ "`$current_dir" != "/opt/w-ecommerce" ]; then
    echo "ERRO: limpeza segura recusada fora de /opt/w-ecommerce. Diretorio atual: `$current_dir" >&2
    exit 1
  fi

  local backup_dir=".deploy-backups"
  local backup_path="`$backup_dir/source-before-clean-`$(date +%Y%m%d-%H%M%S).tar.gz"
  mkdir -p "`$backup_dir"

  local managed_paths=(
    app
    components
    lib
    hooks
    types
    prisma
    scripts
    Dockerfile
    package.json
    package-lock.json
    next.config.js
    next.config.mjs
    tsconfig.json
    tailwind.config.js
    tailwind.config.ts
    postcss.config.js
    postcss.config.mjs
    middleware.ts
    next-env.d.ts
    .eslintrc.json
  )

  local existing_paths=()
  local path
  for path in "`$`{managed_paths[@]`}`"; do
    if [ -e "`$path" ]; then
      existing_paths+=("`$path")
    fi
  done

  shopt -s nullglob
  local managed_glob_paths=(tmp-*.ts tmp-*.tsx tmp-*.js tmp-*.mjs)
  shopt -u nullglob
  for path in "`$`{managed_glob_paths[@]`}`"; do
    if [ -e "`$path" ]; then
      existing_paths+=("`$path")
    fi
  done

  if [ "`$`{#existing_paths[@]`}" -gt 0 ]; then
    echo "==> Criando backup dos caminhos de codigo atuais em `$REMOTE_DIR/`$backup_path"
    tar -czf "`$backup_path" "`$`{existing_paths[@]`}" || fail_remote "Falha ao criar backup antes da limpeza segura."
  else
    echo "==> Nenhum caminho de codigo existente para backup antes da limpeza segura."
  fi

  for path in "`$`{managed_paths[@]`}`"; do
    case "`$path" in
      ""|"."|".."|/*|*"/../"*|*"../"*)
        echo "ERRO: caminho inseguro recusado na limpeza: `$path" >&2
        exit 1
        ;;
    esac

    if [ -e "`$path" ]; then
      rm -rf -- "`$path"
    fi
  done

  for path in "`$`{managed_glob_paths[@]`}`"; do
    case "`$path" in
      ""|"."|".."|/*|*"/../"*|*"../"*)
        echo "ERRO: caminho inseguro recusado na limpeza: `$path" >&2
        exit 1
        ;;
    esac

    if [ -e "`$path" ]; then
      rm -f -- "`$path"
    fi
  done

  echo "OK: limpeza segura removeu apenas caminhos de codigo gerenciados em `$REMOTE_DIR."
  echo "BACKUP_SOURCE_BEFORE_CLEAN=`$REMOTE_DIR/`$backup_path"
}

mkdir -p "`$REMOTE_DIR"
cd "`$REMOTE_DIR"

if [ "`$(pwd -P)" != "/opt/w-ecommerce" ]; then
  echo "ERRO: diretorio remoto inesperado para deploy: `$(pwd -P)" >&2
  exit 1
fi

if [ -f .env.production ]; then
  cp .env.production "`$ENV_BACKUP"
else
  echo "ERRO: .env.production nao existe em `$REMOTE_DIR. Crie o arquivo antes do deploy." >&2
  exit 1
fi

if [ -f docker-compose.yml ] && grep -q "command:" docker-compose.yml && ! grep -q "migrate deploy" docker-compose.yml; then
  cp docker-compose.yml "`$COMPOSE_BACKUP"
  PRESERVE_COMPOSE=1
fi

clean_managed_source_paths

echo "==> Extraindo pacote tar.gz em `$REMOTE_DIR"
set +e
tar -xzf "`$REMOTE_PACKAGE" -C "`$REMOTE_DIR"
TAR_EXIT="`$?"
set -e

for required_path in package.json Dockerfile app lib prisma; do
  if [ ! -e "`$REMOTE_DIR/`$required_path" ]; then
    echo "ERRO: arquivo/pasta obrigatorio ausente apos extracao: `$required_path" >&2
    exit 1
  fi
done

if [ "`$TAR_EXIT" -ne 0 ]; then
  echo "AVISO: tar retornou codigo `$TAR_EXIT, mas arquivos principais existem; seguindo deploy." >&2
fi

mv "`$ENV_BACKUP" "`$REMOTE_DIR/.env.production"
if [ "`$PRESERVE_COMPOSE" = "1" ]; then
  mv "`$COMPOSE_BACKUP" "`$REMOTE_DIR/docker-compose.yml"
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
  echo "ERRO: docker-compose.yml ainda contem prisma migrate deploy no start." >&2
  exit 1
fi

echo "==> Build do app W Ecommerce"
docker compose --env-file .env.production -f docker-compose.yml build app || fail_remote "Build do app falhou."

echo "==> Verificando dependencias dedicadas do W Ecommerce"
ensure_dependency_service "postgres" "w-ecommerce-postgres"
ensure_dependency_service "redis" "w-ecommerce-redis"

POSTGRES_BEFORE="`$(docker inspect -f '{{.Id}}' w-ecommerce-postgres 2>/dev/null || true)"
REDIS_BEFORE="`$(docker inspect -f '{{.Id}}' w-ecommerce-redis 2>/dev/null || true)"

echo "==> Subindo somente o app W Ecommerce sem recriar dependencias saudaveis"
docker compose --env-file .env.production -f docker-compose.yml up -d --no-deps app || fail_remote "Falha ao subir o w-ecommerce-app."

POSTGRES_AFTER="`$(docker inspect -f '{{.Id}}' w-ecommerce-postgres 2>/dev/null || true)"
REDIS_AFTER="`$(docker inspect -f '{{.Id}}' w-ecommerce-redis 2>/dev/null || true)"
if [ -n "`$POSTGRES_BEFORE" ] && [ "`$POSTGRES_BEFORE" = "`$POSTGRES_AFTER" ]; then
  echo "OK: w-ecommerce-postgres nao foi recriado."
fi
if [ -n "`$REDIS_BEFORE" ] && [ "`$REDIS_BEFORE" = "`$REDIS_AFTER" ]; then
  echo "OK: w-ecommerce-redis nao foi recriado."
fi

echo "==> Status dos containers W Ecommerce"
docker compose --env-file .env.production -f docker-compose.yml ps

echo "==> Logs recentes do w-ecommerce-app"
docker logs --tail=80 w-ecommerce-app || true

echo "==> Aguardando /login ficar pronto na VPS"
Wait-RemoteHttpReady || fail_remote "App nao respondeu em /login dentro do tempo limite."

$remoteSeedCommands
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
  Remove-Item -LiteralPath $stageRoot -Recurse -Force -ErrorAction SilentlyContinue
}

if ($ResetMasterPassword) {
  Write-Host "Deploy concluido com validacao de login/logout."
} else {
  Write-Host "Deploy concluido sem reset de senha master."
}
