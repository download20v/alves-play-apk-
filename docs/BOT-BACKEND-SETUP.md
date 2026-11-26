# ALVES PLAY — integração do bot

O app usa `window.ALVE_PLAY_API_BASE`, definido em `www/app-config.js`. Deixe vazio até implantar o backend HTTPS.

## Contrato de API

- `POST /bot/test`: recebe `{ app, client_id, command, message }`. O servidor deve reivindicar o teste atomicamente no banco antes de chamar o provedor.
- Sucesso: `{ allowed: true, reply: "...", renew_url?: "https://..." }` (também pode retornar campos da lista autorizada).
- Teste já usado: `{ allowed: false, used: true, message: "...", renew_url?: "https://..." }`.
- Tokens do provedor, chaves privadas e credenciais devem ficar somente em variáveis de ambiente do backend, nunca no HTML/JS público.
- O ID local identifica uma instalação, mas pode ser recriado ao limpar dados/reinstalar. Para uma política resistente a fraude, adicionar autenticação e Play Integrity no Android.

## Segurança

Credenciais anteriormente publicadas devem ser revogadas/rotacionadas. Apagar o valor do arquivo atual não remove cópias do histórico Git.

## APK

O workflow do GitHub Actions tenta compilar o APK após push para `main`. O artefato só estará disponível se a execução terminar com sucesso.
