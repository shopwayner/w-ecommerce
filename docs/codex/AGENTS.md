# Regras de Trabalho do Codex

Este arquivo define a comunicacao padrao entre ChatGPT, Codex e o projeto Matrix Commerce Hub.

## Regras gerais do projeto

- Antes de qualquer alteracao, ler esta documentacao e entender o escopo da tarefa atual.
- Nunca alterar layout, fluxo, cores ou funcionalidades fora do escopo pedido.
- Sempre preservar o que ja esta funcionando.
- Antes de alterar, analisar impacto em autenticacao, permissoes, multi-tenant, banco, build e experiencia visual.
- Nao remover funcionalidades sem autorizacao explicita.
- Nao criar dados de teste em producao.
- Nao expor secrets, tokens, chaves privadas, credenciais, cookies, `DATABASE_URL`, `AUTH_SECRET`, `APP_ENCRYPTION_KEY` ou `service_role` no frontend, logs ou documentacao publica.
- Nao salvar senhas em texto puro.
- Nao implementar integracoes reais, pagamentos reais ou fluxos de producao quando a tarefa pedir apenas estrutura visual, mock seguro ou preparacao.
- Em caso de duvida tecnica, escolher a solucao mais segura, preservar comportamento existente e documentar a decisao.

## Antes de alterar

- Ler `docs/codex/TASK_ATUAL.md` quando estiver preenchido.
- Conferir se a tarefa pede alteracao visual, backend, banco, documentacao ou validacao.
- Identificar arquivos provaveis e impacto antes de editar.
- Verificar se existem scripts de validacao no `package.json`.

## Durante a alteracao

- Manter as edicoes pequenas, objetivas e relacionadas ao escopo.
- Seguir padroes existentes do projeto.
- Nao trocar tecnologia, banco, provider ou arquitetura sem pedido explicito.
- Nao reverter alteracoes do usuario sem autorizacao.

## Depois de alterar

- Rodar `lint`, `test` e `build` quando existirem scripts disponiveis.
- Rodar validacoes especificas da tarefa quando forem solicitadas.
- Em alteracoes visuais, conferir responsividade e ausencia de erros no console quando possivel.
- Atualizar documentacao relevante quando a tarefa pedir ou quando a decisao tecnica precisar ficar registrada.

## Entrega final

Sempre informar:

- Arquivos alterados.
- Motivo da alteracao.
- Comandos executados.
- Resultado das validacoes.
- Pendencias, riscos ou ressalvas.

