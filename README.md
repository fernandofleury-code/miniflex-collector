# MiniFlex Collector

Sistema full stack em Node.js, Express, SQLite, HTML, CSS e JavaScript puro para controlar catalogos fisicos, contas de colecionadores, ranking, hall da fama, loja informativa, painel admin e backup CSV.

## Requisitos

- Node.js 22.13 ou superior
- NPM

## Como rodar

```bash
npm install
npm run dev
```

Abra `http://localhost:3000`.

O banco SQLite e criado automaticamente em `data/miniflex.sqlite`. A primeira temporada vem com os 10 animais solicitados.

Se quiser testar com Turso localmente, copie `.env.example` para `.env` e preencha suas credenciais. O servidor carrega esse arquivo automaticamente.

## Banco Turso no Render

Para hospedagem gratuita no Render, use o Turso como banco persistente. O sistema usa SQLite local quando `TURSO_DATABASE_URL` nao existe, e usa Turso automaticamente quando essas variaveis estao configuradas:

```env
ADMIN_PASSWORD=sua-senha-admin
TURSO_DATABASE_URL=libsql://seu-banco-sua-conta.turso.io
TURSO_AUTH_TOKEN=seu-token-do-turso
```

No Render, configure:

```text
Build Command: npm install
Start Command: npm start
Instance Type: Free
```

Adicione as variaveis acima em `Environment`. O arquivo `render.yaml` ja esta preparado para Blueprint, mas voce tambem pode criar o Web Service manualmente pelo painel do Render.

Importante: em `NODE_ENV=production`, o app nao inicia sem `TURSO_DATABASE_URL`. Essa trava evita que o Render grave dados em SQLite local temporario.

Para migrar o banco local atual para Turso, rode no WSL com o Turso CLI:

```bash
cd /mnt/c/Users/ferna/Documents/Codex/2026-07-20/sites-plugin-sites-openai-bundled-criar-2
turso db create miniflex-collector --from-file ./data/miniflex.sqlite
turso db show miniflex-collector --url
turso db tokens create miniflex-collector --expiration never
```

## Admin

Acesse a aba `Admin`.

Senha padrao:

```text
miniflex-admin
```

Para trocar, defina a variavel de ambiente:

```bash
ADMIN_PASSWORD=sua-senha npm start
```

## Funcionalidades

- Cadastro e login por nome e senha.
- Area do colecionador com foto padrao, pacotes, conquistas e barra de progresso.
- Hall da Fama por temporada.
- Ranking por pacotes, Gold, Bicolor e colecao completa.
- Colecao com 10 animais, aparecendo cinza ate o registro administrativo.
- Painel admin para codigos, usuarios, compras, Gold, Bicolor, progresso e temporadas.
- Graficos administrativos em canvas.
- Importacao e exportacao CSV para backup.

## Testes

```bash
npm test
```
