# Teste Visual Login Planos

Atualizado em 2026-06-04, usando o workspace `C:\W Ecommerce`.

## Setinha

- [x] Setinha dourada fica na lateral direita do card de login no desktop/tablet.
- [x] Estado fechado mostra seta para direita.
- [x] Estado aberto mostra seta para esquerda.
- [x] Botao usa `aria-controls`, `aria-expanded` e `aria-label`.

## Painel de Planos

- [x] Estado inicial fechado.
- [x] Abre entre o card de login e o hero visual.
- [x] Usa animacao de largura, opacidade e deslocamento.
- [x] Fecha ao clicar novamente na setinha.
- [x] Fecha com `Esc`.
- [x] Nao recarrega a pagina.
- [x] Nao limpa e-mail ou senha digitados.

## Cards Comerciais

- [x] Plano PRO.
- [x] Plano PLUS.
- [x] Plano MATRIX com destaque dourado e icone de diamante.
- [x] Botoes Assinar sao apenas visuais e mostram mensagem `Checkout em breve`.
- [x] Link Saiba mais tambem e visual nesta etapa.

## Mobile

- [x] Setinha lateral vira botao `Ver planos`.
- [x] Planos abrem em drawer inferior.
- [x] Login continua como foco principal.
- [x] Campos de e-mail e senha nao ficam escondidos pelo painel.

## Dark Mode

- [x] Painel usa fundo escuro translucido.
- [x] Bordas e destaques dourados preservados.
- [x] Textos usam tokens globais do tema.

## Login

- [x] Formulario real preservado.
- [x] Google continua desabilitado como `em breve`.
- [x] Sessao JWT httpOnly nao foi alterada.
- [x] Middleware nao foi alterado.

## Validacoes

- `npm.cmd run prisma:generate`: passou.
- `npx.cmd prisma validate`: passou.
- `npm.cmd run lint`: passou.
- `npm.cmd run build`: passou.
- `npm.cmd run dev`: passou.

## Testes HTTP

- `/login`: respondeu `200`.
- Login valido: respondeu `200`.
- Login invalido: respondeu `401`.
