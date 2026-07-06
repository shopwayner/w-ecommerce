import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

type RouteFinding = {
  method: string;
  route: string;
  file: string;
  type: string;
  usesAuth: boolean;
  usesOrganizationId: boolean;
  mutatesData: boolean;
  callsExternalApi: boolean;
  requiresConfirmation: boolean;
  usesAuditLog: boolean;
  isDangerousRoute: boolean;
  risk: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  recommendation: string;
};

const root = process.cwd();
const apiRoot = path.join(root, "app", "api");
const docsRoot = path.join(root, "docs");

function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return entry.isFile() && entry.name === "route.ts" ? [fullPath] : [];
  });
}

function routeFromFile(file: string) {
  const relative = path.relative(path.join(root, "app", "api"), file).replace(/\\/g, "/");
  return `/api/${relative.replace(/\/route\.ts$/, "").replace(/\/route$/, "")}`;
}

function exportedMethods(content: string) {
  const methods = [...content.matchAll(/export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)/g)].map((match) => match[1]);
  return methods.length ? methods : ["UNKNOWN"];
}

function hasAny(value: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(value));
}

function classify(input: Omit<RouteFinding, "type" | "risk" | "recommendation">): Pick<RouteFinding, "type" | "risk" | "recommendation"> {
  const route = input.route.toLowerCase();
  const writeMethod = ["POST", "PUT", "PATCH", "DELETE"].includes(input.method);
  const simulationOrReadOnlyPost = hasAny(route, [/preview/, /dry-run/, /probe/, /validate/, /calculate/, /status/, /search/]);
  const isPublicExpected =
    route === "/api/auth/login" ||
    route === "/api/auth/logout" ||
    route === "/api/marketplaces/mercado-livre/client/notifications" ||
    route.includes("/callback");
  const dangerous = hasAny(route, [
    /reset/,
    /cleanup/,
    /backfill/,
    /import/,
    /apply/,
    /approve/,
    /sync/,
    /publish/,
    /push/,
    /send-to/,
    /delete/,
    /quick-create/,
    /billing/,
    /payment/
  ]);
  const externalWriteLike = hasAny(route, [/push-to/, /send-to/, /sync-to/, /publication/, /publish/]);

  if (!input.usesAuth && !isPublicExpected) {
    return {
      type: "PUBLIC_SAFE",
      risk: writeMethod ? "CRITICAL" : "HIGH",
      recommendation: "Revisar imediatamente: rota fora da lista publica esperada nao usa requireApiAuth."
    };
  }

  if (isPublicExpected) {
    return {
      type: "PUBLIC_SAFE",
      risk: "LOW",
      recommendation: route.includes("/callback") ? "Manter callback protegido por state e sem retorno de segredo." : "Rota publica esperada."
    };
  }

  if (simulationOrReadOnlyPost && !input.mutatesData) {
    return {
      type: input.callsExternalApi ? "EXTERNAL_READ_ONLY" : "AUTH_REQUIRED_READ",
      risk: input.callsExternalApi ? "MEDIUM" : "LOW",
      recommendation: input.callsExternalApi
        ? "Manter como consulta/simulacao read-only, sem persistir payload externo bruto."
        : "Manter como consulta/simulacao sem alterar dados."
    };
  }

  if (externalWriteLike) {
    return {
      type: "EXTERNAL_WRITE_BLOCKED",
      risk: input.requiresConfirmation ? "MEDIUM" : "HIGH",
      recommendation: "Manter bloqueado por feature flag, confirmacao textual e auditoria antes de qualquer escrita externa real."
    };
  }

  if (dangerous && writeMethod) {
    return {
      type: input.requiresConfirmation ? "DANGEROUS_REQUIRES_CONFIRMATION" : "AUTH_REQUIRED_WRITE",
      risk: input.requiresConfirmation ? "MEDIUM" : "HIGH",
      recommendation: input.requiresConfirmation
        ? "Manter confirmacao textual exata, role adequada e audit log."
        : "Adicionar confirmacao textual exata antes de executar operacao sensivel."
    };
  }

  if (input.callsExternalApi && !writeMethod) {
    return {
      type: "EXTERNAL_READ_ONLY",
      risk: "MEDIUM",
      recommendation: "Garantir que chamada externa continue read-only e que logs sejam sanitizados."
    };
  }

  if (writeMethod) {
    return {
      type: "AUTH_REQUIRED_WRITE",
      risk: "MEDIUM",
      recommendation: "Garantir organizationId da sessao, validacao de entrada e audit log quando houver impacto."
    };
  }

  return {
    type: "AUTH_REQUIRED_READ",
    risk: "LOW",
    recommendation: "Manter leitura filtrada por organizationId e sem segredos no JSON."
  };
}

function auditRoute(file: string): RouteFinding[] {
  const content = readFileSync(file, "utf8");
  const route = routeFromFile(file);
  const methods = exportedMethods(content);
  const isProtectedAlias = /export\s+\{\s*(GET|POST|PUT|PATCH|DELETE)\s*\}\s+from\s+["']\.\.\//.test(content);
  const usesAuth = isProtectedAlias || /requireApiAuth|getTenantContext|requireAuth|requirePermission/.test(content);
  const usesOrganizationId = isProtectedAlias || /organizationId|auth\.context\.organizationId|getTenantContext|requireOrganization/.test(content);
  const mutatesData = hasAny(content, [
    /prisma\.\w+\.(create|update|upsert|delete|deleteMany|createMany|updateMany)/,
    /prisma\.\$transaction/,
    /\b(apply|reset|cleanup|backfill|approve|import|sync|create|update|disconnect)\w*\(/
  ]);
  const callsExternalApi = /fetch\(|BlingApiClient|blingApiClient|OpenAI|MercadoLivre|marketplace/i.test(content);
  const requiresConfirmation = /requireConfirmation|\bconfirm\b|confirmation/i.test(content);
  const usesAuditLog = /auditLog|logDangerousAction|createAuditLog/i.test(content);
  const writeMethod = methods.some((method) => ["POST", "PUT", "PATCH", "DELETE"].includes(method));
  const isDangerousRoute =
    writeMethod &&
    hasAny(route.toLowerCase(), [
      /reset/,
      /cleanup/,
      /backfill/,
      /import/,
      /apply/,
      /approve/,
      /sync/,
      /publish/,
      /push/,
      /send-to/,
      /delete/,
      /quick-create/,
      /billing/,
      /payment/
    ]);

  return methods.map((method) => {
    const base = {
      method,
      route,
      file: path.relative(root, file).replace(/\\/g, "/"),
      usesAuth,
      usesOrganizationId,
      mutatesData,
      callsExternalApi,
      requiresConfirmation,
      usesAuditLog,
      isDangerousRoute
    };
    const classified = classify(base);
    return { ...base, ...classified };
  });
}

function bool(value: boolean) {
  return value ? "sim" : "nao";
}

function markdown(findings: RouteFinding[]) {
  const countsByType = new Map<string, number>();
  const countsByRisk = new Map<string, number>();
  for (const finding of findings) {
    countsByType.set(finding.type, (countsByType.get(finding.type) ?? 0) + 1);
    countsByRisk.set(finding.risk, (countsByRisk.get(finding.risk) ?? 0) + 1);
  }

  const summaryRows = [...countsByType.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([type, count]) => `| ${type} | ${count} |`)
    .join("\n");

  const riskRows = ["CRITICAL", "HIGH", "MEDIUM", "LOW"]
    .map((risk) => `| ${risk} | ${countsByRisk.get(risk) ?? 0} |`)
    .join("\n");

  const tableRows = findings
    .sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method))
    .map(
      (finding) =>
        `| ${finding.method} | \`${finding.route}\` | \`${finding.file}\` | ${finding.type} | ${bool(finding.usesAuth)} | ${bool(finding.usesOrganizationId)} | ${bool(finding.mutatesData)} | ${bool(finding.callsExternalApi)} | ${bool(finding.requiresConfirmation)} | ${finding.risk} | ${finding.recommendation} |`
    )
    .join("\n");

  const dangerousWithConfirmation = findings.filter((finding) => finding.isDangerousRoute && finding.requiresConfirmation);
  const dangerousWithAuditLog = findings.filter((finding) => finding.isDangerousRoute && finding.usesAuditLog);
  const dangerousMissingAuditLog = findings.filter((finding) => finding.isDangerousRoute && !finding.usesAuditLog);
  const routeList = (items: RouteFinding[]) =>
    items.length
      ? items
          .sort((a, b) => a.route.localeCompare(b.route) || a.method.localeCompare(b.method))
          .map((finding) => `- ${finding.method} \`${finding.route}\` - \`${finding.file}\``)
          .join("\n")
      : "- Nenhuma rota encontrada.";

  return `# Auditoria estatica de seguranca das APIs

Gerado em: ${new Date().toISOString()}

Este relatorio e uma analise estatica simples dos arquivos \`app/api/**/route.ts\`. Ele nao executa rotas, nao acessa banco e nao chama APIs externas.

## Resumo

- APIs/metodos auditados: ${findings.length}
- Arquivos \`route.ts\`: ${new Set(findings.map((finding) => finding.file)).size}
- Rotas publicas esperadas: ${findings.filter((finding) => finding.type === "PUBLIC_SAFE").length}
- Rotas protegidas: ${findings.filter((finding) => finding.usesAuth).length}
- Rotas/metodos write: ${findings.filter((finding) => ["POST", "PUT", "PATCH", "DELETE"].includes(finding.method)).length}
- Rotas perigosas com confirmacao detectada: ${findings.filter((finding) => finding.type === "DANGEROUS_REQUIRES_CONFIRMATION").length}
- Dangerous routes with confirmation: ${dangerousWithConfirmation.length}
- Dangerous routes with audit log: ${dangerousWithAuditLog.length}
- Dangerous routes missing audit log: ${dangerousMissingAuditLog.length}

## Contagem por tipo

| Tipo | Quantidade |
| --- | ---: |
${summaryRows}

## Contagem por risco

| Risco | Quantidade |
| --- | ---: |
${riskRows}

## Dangerous routes with confirmation

${routeList(dangerousWithConfirmation)}

## Dangerous routes with audit log

${routeList(dangerousWithAuditLog)}

## Dangerous routes missing audit log

${routeList(dangerousMissingAuditLog)}

## Tabela completa

| Metodo | Rota | Arquivo | Tipo | Usa autenticacao? | Usa organizationId? | Altera dados? | Chama API externa? | Exige confirmacao textual? | Risco | Correcao recomendada |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${tableRows}
`;
}

const routeFiles = existsSync(apiRoot) ? walk(apiRoot) : [];
const findings = routeFiles.flatMap(auditRoute);
if (!existsSync(docsRoot)) mkdirSync(docsRoot, { recursive: true });
const output = markdown(findings);
writeFileSync(path.join(docsRoot, "API_SECURITY_AUDIT_GENERATED.md"), output, "utf8");

console.log(`API security audit generated: ${findings.length} methods in ${routeFiles.length} route files.`);
console.log(`Output: ${path.join("docs", "API_SECURITY_AUDIT_GENERATED.md")}`);
