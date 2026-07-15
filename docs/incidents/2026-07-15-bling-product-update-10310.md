# Incidente de atualizacao de produto Bling - 2026-07-15

## Escopo

- Produto local: SKU visual `10310`
- Produto local: `***zrqr`
- Conexao: `***3ffq`
- Produto Bling: `***9153`
- Correlation ID: `968c...d2c9`
- Idempotency key: `0121...587d`
- PUT registrado em: `2026-07-15T15:04:02.997Z`
- Resultado registrado em: `2026-07-15T15:04:04.378Z`
- Quantidade de PUTs: `1`
- Campo solicitado pelo usuario: `images`

Nenhum token, segredo, cabecalho de autorizacao ou payload bruto foi registrado neste documento.

## Causa

O servico montou um payload minimo com `nome`, `tipo`, `situacao`, `formato` e `midia`.
O Bling trata `PUT` como atualizacao integral da entidade. Campos omitidos foram redefinidos,
embora a resposta da atualizacao e a verificacao das fotos tenham sido bem-sucedidas.

A verificacao posterior antiga comparava somente os campos solicitados pelo usuario. Por isso,
as duas fotos foram confirmadas e a perda de outros campos nao impediu o registro de sucesso.

Fonte oficial:

- https://developer.bling.com.br/bling-api
- https://developer.bling.com.br/referencia
- OpenAPI publicado pela pagina de referencia: `ProdutosDadosDTO` em
  https://developer.bling.com.br/build/assets/openapi-D-189jcU.json

## Estado anterior conhecido

| Campo | Valor anterior | Confianca | Fonte |
| --- | --- | --- | --- |
| nome | PNEU 110/70-14 CIBORG FURIA RACER G2 TUBELESS | CONFIRMADO | GET imediatamente anterior |
| marca | CINBORG | CONFIRMADO | GET imediatamente anterior |
| preco | 280.00 | CONFIRMADO | GET imediatamente anterior |
| saldo virtual | 4 | CONFIRMADO | GET imediatamente anterior |
| estoque minimo | 10 | CONFIRMADO | GET imediatamente anterior |
| estoque maximo | 100 | CONFIRMADO | GET imediatamente anterior |
| crossdocking | 20 | CONFIRMADO | GET imediatamente anterior |
| localizacao | P-2 A-B | CONFIRMADO | GET imediatamente anterior |
| tipo | P | CONFIRMADO | GET imediatamente anterior |
| situacao | A | CONFIRMADO | GET imediatamente anterior |
| formato | S | CONFIRMADO | GET imediatamente anterior |
| fotos | 0 | CONFIRMADO | GET imediatamente anterior |
| preco de custo | 187.00 | PROVAVEL | draft e preco local capturados no dia anterior |
| codigo/SKU remoto | 10310 | PROVAVEL | draft de importacao do dia anterior |
| unidade | desconhecido | DESCONHECIDO | draft e produto local vazios |
| categoria | desconhecido | DESCONHECIDO | draft e produto local vazios |
| GTIN | desconhecido | DESCONHECIDO | draft e produto local vazios |
| descricoes | desconhecido | DESCONHECIDO | nao havia snapshot integral anterior |
| pesos e dimensoes | desconhecido | DESCONHECIDO | nao havia snapshot integral anterior |
| tributacao | desconhecido | DESCONHECIDO | nao havia snapshot integral anterior |
| identidade do fornecedor | desconhecido | DESCONHECIDO | nao havia snapshot integral anterior |

## Estado posterior confirmado

| Campo | Valor posterior | Resultado |
| --- | --- | --- |
| nome | preservado | OK |
| marca | vazio | ALTERADO |
| preco | 0.00 | ALTERADO |
| saldo virtual | 4 | OK |
| estoque minimo | 0 | ALTERADO |
| estoque maximo | 0 | ALTERADO |
| crossdocking | 0 | ALTERADO |
| localizacao | vazia | ALTERADO |
| tipo/situacao/formato | P / A / S | OK |
| fotos | 2, unicas e na ordem solicitada | OK |
| video | URL vazia preservada | OK |

Uma nova tentativa de GET integral nao foi feita com renovacao automatica porque o token passou a
estar expirado. Campos nao capturados no GET posterior original permanecem classificados como
desconhecidos; nenhum valor foi inferido.

## Dry-run de restauracao

O dry-run permanece bloqueado. Um payload executavel nao pode ser gerado enquanto existirem campos
anteriores desconhecidos ou apenas provaveis. Em especial, devem ser confirmados manualmente:

- preco de custo e identidade do fornecedor;
- unidade e categoria;
- pesos e dimensoes;
- tributacao;
- descricoes, codigo e GTIN remotos anteriores.

Valores zero nunca devem ser usados como fallback. As duas fotos atuais, o nome e os demais valores
confirmados devem ser preservados em qualquer futura restauracao.

O resultado atual do dry-run e:

- `safeToExecute`: `false`
- payload executavel: `null`
- PUT corretivo executado: `nao`

## Contrato oficial auditado

A especificacao oficial atual identifica `PUT /produtos/{idProduto}` como alteracao integral e usa
`ProdutosDadosDTO`. Os campos obrigatorios sao `nome`, `tipo`, `situacao` e `formato`.

O contrato tambem aceita, conforme aplicavel ao produto:

- dados escalares: codigo, preco, descricoes, validade, unidade, pesos, volumes, itens por caixa,
  GTINs, producao, condicao, frete gratis, marca, links, observacoes e artigo perigoso;
- estruturas: categoria, estoque, fornecedor e contato, dimensoes, tributacao, linha de produto,
  campos customizados e midia;
- midia: URL de video e colecoes de imagens;
- estruturas especiais: variacoes e estrutura/composicao.

Variacoes, composicoes e filhos de variacao continuam fora deste fluxo. O saldo virtual e qualquer
acao de estoque tambem nao sao reproduzidos: sao dados comerciais e sua semantica de escrita nao foi
confirmada para esta operacao.

O incidente comprova que os opcionais nao podem ser simplesmente omitidos esperando preservacao. A
estrategia futura implementada no worktree e:

1. obter o estado remoto atual por GET;
2. copiar somente campos reconhecidos pelo contrato;
3. preservar marca, preco, custo, parametros de estoque, unidade, categoria, pesos, dimensoes,
   tributacao, fornecedor, video e galeria;
4. aplicar apenas titulo, marca ou fotos revisados pelo usuario;
5. executar no maximo um PUT;
6. fazer GET posterior e comparar os campos revisados e o snapshot de integridade;
7. registrar `EXTERNAL_UPDATE_INTEGRITY_FAILED` e nao atualizar o timestamp local se houver perda.

Nenhuma dessas escritas futuras esta liberada enquanto a trava temporaria estiver ativa.

## Contencao

O worktree do incidente contem uma trava compartilhada na interface, na rota e no servico. A rota
de escrita retorna `423` antes de criar job ou chamar o Bling, e o servico possui uma segunda trava
com `putRequests: 0`.

Esta contencao ainda nao esta em producao porque esta tarefa proibe commit e deploy.

## Estado local

- `Product.updatedAt`: preservado em `2026-07-14T09:28:38.336Z`
- `ProductExternalMapping.updatedAt`: preservado em `2026-07-14T06:02:38.993Z`
- `lastExternalSyncAt`: `2026-07-15T15:04:04.373Z`
- A operacao deve ser tratada como `EXTERNAL_UPDATE_INTEGRITY_FAILED`.
- Nenhum novo PUT foi executado durante esta auditoria.
