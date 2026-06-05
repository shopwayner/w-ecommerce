# Teste Visual Login

Atualizado em 2026-06-04, usando o workspace `C:\W Ecommerce`.

## Layout Desktop

- [x] Layout em duas colunas.
- [x] Wrapper usa altura de viewport e centralizacao vertical.
- [x] Card de login fica centralizado verticalmente no lado esquerdo.
- [x] Card de login tem largura controlada e altura natural.
- [x] Hero premium branco/dourado fica alinhado verticalmente ao card.
- [x] Hero tem altura controlada entre desktop e notebook.
- [x] Cards decorativos de metricas aparecem somente como elemento visual.
- [x] Cards flutuantes ficam dentro do container relativo do hero.
- [x] Cards flutuantes usam fundo claro legivel no light mode.
- [x] Textos do hero nao colidem com cards decorativos.
- [x] Rodape com marca, seguranca, LGPD, uptime e suporte.

## Layout Mobile

- [x] Card de login fica como foco principal.
- [x] Hero decorativo e cards flutuantes ficam ocultos em telas menores.
- [x] Botao Entrar permanece visivel e acessivel.

## Animacao

- [x] Card inicia com opacity baixa, deslocamento horizontal e scale menor.
- [x] Entrada usa CSS puro com easing suave.
- [x] Card nao fica flutuando depois da entrada para preservar alinhamento.
- [x] Cards do hero entram com pequeno delay.
- [x] `prefers-reduced-motion` desativa animacoes.

## Painel de Planos

- [x] Setinha lateral permanece visivel no card de login.
- [x] Painel abre ao lado sem limpar dados digitados.
- [x] Painel tem largura menor e conteudo rolavel no desktop.
- [x] Mobile usa drawer inferior para planos.

## Formulario

- [x] Login real por e-mail e senha preservado.
- [x] Botao mostrar/ocultar senha implementado.
- [x] Checkbox Lembrar-me visual implementado sem alterar sessao.
- [x] Link Esqueci minha senha e visual apenas.
- [x] Google aparece como `em breve` e desabilitado.
- [x] Erro amigavel para senha/e-mail invalidos.

## Dark Mode

- [x] Login respeita tokens globais claro/escuro.
- [x] Card usa fundo escuro translucido no dark mode.
- [x] Cards flutuantes usam fundo escuro legivel no dark mode.
- [x] Dourado permanece como destaque principal.

## Credenciais Locais

- [x] `Crowner@admin.com` preservado.
- [x] `admin@matrix.local` preservado no seed local.
- [x] `viewer@matrix.local` preservado no seed local.

## Validacoes

- `npm.cmd run prisma:generate`: passou.
- `npx.cmd prisma validate`: passou.
- `npm.cmd run prisma:seed`: passou.
- `npm.cmd run lint`: passou.
- `npm.cmd run build`: passou.
- `npm.cmd run dev`: passou.

## Testes de Login

- `/login`: respondeu `200`.
- Login master local: respondeu `200`.
- Login admin local: respondeu `200`.
- Login viewer local: respondeu `200`.
- Login com senha invalida: respondeu `401`.

## Correcao de Alinhamento

- `/login`: respondeu `200` apos a correcao.
- Login valido: respondeu `200` apos a correcao.
- Login invalido: respondeu `401` apos a correcao.
