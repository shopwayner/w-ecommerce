# Teste Visual Planos

Atualizado em 2026-06-04, usando o workspace `C:\W Ecommerce`.

## Header

- [x] Header publico com logo Matrix Commerce.
- [x] Links Recursos, Planos, Integracoes e Suporte.
- [x] Link Planos destacado na rota `/plans`.
- [x] Botao Entrar aponta para `/login`.
- [x] Botao Comecar agora aponta para `/login`.

## Hero

- [x] Titulo `Planos para cada fase do seu negocio`.
- [x] `seu negocio` destacado em dourado.
- [x] Subtexto comercial exibido.
- [x] Toggle Mensal/Anual funcional.
- [x] Badge `Economize 17% no anual`.

## Cards

- [x] Card PRO.
- [x] Card PLUS com badge `Mais popular`.
- [x] Card MATRIX com visual premium.
- [x] Valores mudam conforme mensal/anual.
- [x] Botoes nao iniciam pagamento real.
- [x] Botoes exibem feedback seguro de checkout/contato em breve.

## Beneficios

- [x] Faixa com Implantacao rapida.
- [x] Migracao facilitada.
- [x] Seguranca de ponta.
- [x] Integracoes avancadas.
- [x] Suporte prioritario.

## Comparativo

- [x] Tabela `Compare os recursos`.
- [x] Colunas Recurso, PRO, PLUS e MATRIX.
- [x] Indicadores visuais para incluido, limitado e nao incluido.
- [x] Scroll horizontal em telas menores.

## FAQ

- [x] Perguntas frequentes em accordion.
- [x] Itens abrem e fecham com animacao suave.

## CTA Final

- [x] Bloco final com titulo e subtexto.
- [x] Botao Comecar agora.
- [x] Botao Falar com especialista.

## Footer

- [x] Logo Matrix Commerce.
- [x] Links publicos.
- [x] Copyright 2026.

## Responsividade

- [x] Cards empilham em mobile.
- [x] Tabela tem scroll horizontal.
- [x] Header permanece utilizavel em telas menores.

## Dark Mode

- [x] Tokens globais aplicados.
- [x] Fundo escuro/grafite.
- [x] Dourado preservado como destaque.

## Validacoes

- `npm.cmd run prisma:generate`: passou.
- `npx.cmd prisma validate`: passou.
- `npm.cmd run lint`: passou, sem warnings ou erros.
- `npm.cmd run build`: passou.
- `npm.cmd run dev`: passou.

## Testes HTTP

- `/plans`: respondeu `200` sem sessao e sem redirect para login.
- `/login`: respondeu `200`.
- Middleware libera `/plans` como pagina publica.
