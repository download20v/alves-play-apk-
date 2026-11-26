# ALVES PLAY API

API Node.js + PostgreSQL para bot, período de teste e atendimento do ALVES PLAY. O banco pode ser hospedado no Supabase; a API pode rodar no Render.

## Rotas principais
- `GET /health`: verifica API e conexão com o banco.
- `POST /bot/test`: inicia uma única janela de teste por identificador e encaminha a mensagem ao provedor do bot.
- `POST /support/messages`: cliente envia uma mensagem usando seu identificador de dispositivo.
- `GET /support/messages?client_id=...`: cliente consulta o histórico e recebe respostas do administrador.
- `GET /admin/support/conversations`: administrador lista conversas e mensagens não lidas.
- `GET /admin/support/conversations/:id/messages`: administrador abre o histórico.
- `POST /admin/support/conversations/:id/messages`: administrador responde ao cliente.
- `PATCH /admin/support/conversations/:id`: administrador abre/fecha o atendimento (status `open` ou `closed`).

## Atendimento cliente e administrador
O backend cria uma conversa por combinação de aplicativo e identificador de dispositivo. Mensagens ficam persistidas em PostgreSQL com remetente (`client` ou `admin`), data/hora e data de leitura. O cliente envia/consulta usando `client_id`; as rotas administrativas exigem o cabeçalho `Authorization: Bearer SUPPORT_ADMIN_TOKEN`.

Configure `SUPPORT_ADMIN_TOKEN` no ambiente do servidor com um segredo longo, aleatório e exclusivo. Não coloque esse token no HTML, JavaScript público ou APK. O identificador do dispositivo é um identificador de conversa, não uma credencial de autenticação. Para produção, recomenda-se vincular o cliente a uma sessão autenticada e, no Android, usar Play Integrity para reduzir falsificação do identificador.

### Exemplos de chamadas
Cliente envia:
```http
POST /support/messages
Content-Type: application/json

{"client_id":"ID_UNICO_DO_APARELHO","message":"Preciso de ajuda"}
```

Cliente consulta:
```http
GET /support/messages?client_id=ID_UNICO_DO_APARELHO
```

Administrador responde:
```http
POST /admin/support/conversations/123/messages
Authorization: Bearer SEU_TOKEN_ADMIN
Content-Type: application/json

{"message":"Olá! Vamos ajudar você."}
```

As rotas retornam mensagens e status de leitura; a interface pode atualizar a conversa por consulta periódica. Notificações push e tempo real ainda precisam ser ligados ao aplicativo.

## Banco gratuito no Supabase
1. Crie um projeto no [Supabase](https://supabase.com/dashboard).
2. Abra **Connect** e selecione **Session pooler** (porta 5432).
3. Copie a URI PostgreSQL e substitua a senha. Codifique caracteres especiais da senha para URL.
4. No Render, configure a URI como `DATABASE_URL`. Nunca coloque essa URI no GitHub, HTML ou APK.
5. O backend cria as tabelas `app_clients`, `support_conversations` e `support_messages` automaticamente na inicialização. O arquivo `db/schema.sql` também pode ser executado manualmente.

Não é necessário colocar a chave anon ou service_role do Supabase no aplicativo.

## Configuração local / Render
1. Use Node.js 20 ou superior.
2. Configure as variáveis de ambiente a partir de `.env.example`.
3. Configure `BOT_PROVIDER_URL` como endpoint HTTPS que aceite POST JSON com `app`, `client_id`, `command` e `message`, retornando JSON com `reply`.
4. Configure `BOT_PROVIDER_API_KEY` somente no servidor, se exigido.
5. Configure `RENEW_URL` com a página de renovação.
6. Configure `SUPPORT_ADMIN_TOKEN` com segredo forte.
7. Inicie com `npm start`.

O backend exige HTTPS para `BOT_PROVIDER_URL`, cancela chamadas ao provedor após 15 segundos e valida o campo `command`.

## Regra de teste
O primeiro pedido válido cria uma janela de teste de `TRIAL_DURATION_HOURS` horas (padrão: 4). O identificador fica registrado no PostgreSQL; após o vencimento, a API nega novos pedidos. O período não é reiniciado por novas chamadas.

O identificador local sozinho não prova a identidade física do dispositivo: ele pode ser apagado ou recriado. Para maior resistência a fraude, implemente Play Integrity e autenticação do cliente.

## Contrato do provedor do bot
Requisição:
```json
{ "app": "ALVES PLAY", "client_id": "id-do-cliente", "command": "chat", "message": "Olá" }
```
Resposta:
```json
{ "reply": "Olá! Como posso ajudar?" }
```

A API não inicia o período de teste enquanto `BOT_PROVIDER_URL` estiver vazio.

## Limites e segurança
- Render Free pode suspender a API após inatividade; a primeira chamada pode demorar.
- Supabase Free tem limites de armazenamento e pode pausar projetos inativos.
- Não coloque chaves privadas no HTML, APK ou repositório.
- Defina `ALLOWED_ORIGINS` com a origem real do app quando ela estiver definida.
- Pagamentos/renovação e notificações push ainda não estão integrados.
