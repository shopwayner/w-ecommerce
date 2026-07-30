import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const deployScript = readFileSync(
  join(projectRoot, "scripts", "deploy-w-ecommerce-vps.ps1"),
  "utf8",
);
const composeFile = readFileSync(
  join(projectRoot, "docker-compose.yml"),
  "utf8",
);

function assertContains(pattern: RegExp, message: string) {
  assert.match(deployScript, pattern, message);
}

test("1. bloqueia arvore Git com alteracoes rastreadas", () => {
  assertContains(
    /Test-GitExitCode @\("diff", "--quiet", "--ignore-submodules", "--"\)/,
    "o deploy deve usar o exit code de git diff --quiet",
  );
  assertContains(
    /Deploy bloqueado: existem alteracoes rastreadas nao commitadas/,
    "o bloqueio deve ser explicito",
  );
});

test("2. bloqueia arquivos nao rastreados", () => {
  assertContains(
    /ls-files", "--others", "--exclude-standard"/,
    "o deploy deve consultar arquivos nao rastreados pelo Git",
  );
  assertContains(
    /Deploy bloqueado: existem arquivos nao rastreados/,
    "arquivos nao rastreados devem bloquear o deploy",
  );
});

test("3. bloqueia HEAD diferente de origin/main", () => {
  assertContains(
    /Invoke-GitCapture @\("rev-parse", "HEAD"\)/,
    "o hash local deve ser obtido pelo Git",
  );
  assertContains(
    /Invoke-GitCapture @\("rev-parse", "origin\/main"\)/,
    "o hash remoto deve ser obtido pelo Git",
  );
  assertContains(
    /Deploy bloqueado: HEAD difere de origin\/main/,
    "hashes diferentes devem bloquear",
  );
});

test("4. pacote e gerado pelo commit e nao pela arvore de trabalho", () => {
  assertContains(
    /"archive",[\s\S]*"--format=tar",[\s\S]*"--output=\$archivePath",[\s\S]*\$deployCommit/,
    "o pacote deve nascer de git archive no commit validado",
  );
  assert.doesNotMatch(
    deployScript,
    /robocopy/i,
    "robocopy poderia incluir arquivos nao rastreados",
  );
  assertContains(
    /cd "`\$RELEASE_DIR"[\s\S]*docker compose --env-file "\$RemoteDir\/\.env\.production" -f docker-compose\.yml build app/,
    "o build deve usar o release extraido, nao o diretorio remoto com arquivos persistentes",
  );
});

test("5. pacote bloqueia .env.production", () => {
  assert.ok(
    deployScript.includes("'(^|/)\\.env\\.production$'"),
    "a validacao local deve rejeitar .env.production",
  );
  assertContains(
    /-name '\.env\.production'/,
    "a validacao remota deve rejeitar .env.production",
  );
});

test("6. pacote exige instrumentation.ts", () => {
  assertContains(
    /"instrumentation\.ts"/,
    "instrumentation.ts deve ser caminho obrigatorio e critico",
  );
});

test("7. pacote exige instrumentation.node.ts", () => {
  assertContains(
    /"instrumentation\.node\.ts"/,
    "instrumentation.node.ts deve ser caminho obrigatorio e critico",
  );
});

test("8. manifesto registra o commit e o SHA do pacote", () => {
  assertContains(
    /commitSha = \$deployCommit/,
    "o manifesto deve registrar o commit validado",
  );
  assertContains(
    /packageSha256 = \$packageSha256/,
    "o manifesto deve registrar o SHA-256 do pacote",
  );
  assertContains(
    /DEPLOY_COMMIT=`\$EXPECTED_COMMIT/,
    "o deploy remoto deve reportar o commit do manifesto",
  );
});

test("9. pacote corrompido bloqueia antes da extracao", () => {
  assertContains(
    /tar -tzf "`\$REMOTE_PACKAGE" > "`\$PACKAGE_LIST" \|\| fail_remote "Pacote tar\.gz corrompido ou ilegivel\."/,
    "tar deve ser listado com sucesso antes da extracao",
  );
  assert.doesNotMatch(
    deployScript,
    /TAR_EXIT|tar retornou codigo.*seguindo deploy/,
    "erros do tar nao podem ser aceitos",
  );
});

test("10. extracao incompleta bloqueia", () => {
  assertContains(
    /for required_path in "`\$`\{REQUIRED_PATHS\[@\]`\}`"; do/,
    "todos os caminhos obrigatorios devem ser verificados remotamente",
  );
  assertContains(
    /Extracao incompleta: caminho obrigatorio ausente/,
    "caminho ausente deve bloquear",
  );
});

test("11. divergencia de hash bloqueia na VPS e no container", () => {
  assertContains(
    /validate_critical_hashes "\$RemoteDir" "\/opt\/w-ecommerce"/,
    "os hashes devem ser verificados na VPS",
  );
  assertContains(
    /validate_container_critical_hashes \|\| fail_remote/,
    "os hashes devem ser verificados dentro do container",
  );
  assertContains(
    /hash divergente/,
    "divergencias devem falhar fechadas",
  );
});

test("12. PostgreSQL e Redis nao fazem parte da recriacao", () => {
  assertContains(
    /POSTGRES_BEFORE=.*docker inspect[\s\S]*POSTGRES_AFTER=.*docker inspect/,
    "o ID do PostgreSQL deve ser comparado antes e depois",
  );
  assertContains(
    /REDIS_BEFORE=.*docker inspect[\s\S]*REDIS_AFTER=.*docker inspect/,
    "o ID do Redis deve ser comparado antes e depois",
  );
  assert.match(composeFile, /container_name: w-ecommerce-postgres/);
  assert.match(composeFile, /container_name: w-ecommerce-redis/);
});

test("13. recriacao usa --no-deps e --force-recreate somente no app", () => {
  assertContains(
    /up -d --no-deps --force-recreate app/,
    "somente app deve ser recriado sem dependencias",
  );
  assert.doesNotMatch(
    deployScript,
    /--force-recreate (postgres|redis)/,
    "dependencias nao podem ser recriadas",
  );
});

test("14. script nao usa docker compose down", () => {
  assert.doesNotMatch(
    deployScript,
    /docker compose(?:[^\r\n]*) down/,
    "docker compose down e proibido",
  );
});

test("15. rollback preserva ambiente e conteudo persistente", () => {
  assertContains(
    /cp "\$RemoteDir\/\.env\.production" "`\$rollback_env"/,
    "o rollback deve preservar .env.production",
  );
  assertContains(
    /preserve_nested_persistent_paths "\$RemoteDir"/,
    "o rollback deve preservar uploads e imagens publicas",
  );
  assertContains(
    /ROLLBACK_SOURCE=`\$BACKUP_PATH/,
    "o rollback deve informar o backup utilizado",
  );
  assertContains(
    /up -d --no-deps --force-recreate app/,
    "o rollback deve recriar somente o app",
  );
});
