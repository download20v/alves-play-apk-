# ALVES PLAY API

API Node.js + PostgreSQL para o bot e o período de teste do ALVES PLAY.

## Rotas
- `GET /health`: verifica API e conexão com o banco.
- `POST /bot/test`: inicia uma única janela de teste por identificador e encaminha a mensagem ao provedor do bot.

## Configuração
1. Use Node.js 20 ou superior.
2. Crie um banco PostgreSQL e execute `db/schema.sql`.
3. Configure as variáveis de ambiente a partir de `.env.example`.
4. Configure `BOT_PROVIDER_URL` para um endpoint HTTPS que aceite POST JSON com `app`, `client_id`, `command` e `message`, e retorne JSON com `reply`.
5. Configure `BOT_PROVIDER_API_KEY` somente no servidor, se o provedor exigir autenticação.
6. Configure `RENEW_URL` com a página de renovação.
7. Inicie com `npm start`.

## Regra de teste
O primeiro pedido válido cria uma janela de teste de `TRIAL_DURATION_HOURS` horas (padrão: 4). O identificador fica registrado no PostgreSQL; após o vencimento, a API nega novos pedidos e devolve o endereço de renovação. O período não é reiniciado por novas chamadas.

**Limite antifraude:** o identificador gerado no aplicativo pode ser apagado ou recriado. Para vincular de forma mais forte a um aparelho Android, adicionar autenticação e validação Play Integrity. O identificador local sozinho não prova a identidade física do dispositivo.

## Contrato do provedor do bot
Requisição:
```json
{ "app": "ALVES PLAY", "client_id": "id-do-cliente", "command": "chat", "message": "Olá" }
```
Resposta:
```json
{ "reply": "Olá! Como posso ajudar?" }
```

A API não inicia o período de teste enquanto `BOT_PROVIDER_URL` estiver vazio, para não consumir o teste antes de o bot estar configurado.

## Segurança e pendências
- Não coloque chaves privadas no HTML, APK ou repositório.
- Use HTTPS e variáveis de ambiente do serviço de hospedagem.
- Defina `ALLOWED_ORIGINS` com a origem real do app quando ela estiver definida.
- Integração de pagamento/renovação não está implementada nesta versão.
