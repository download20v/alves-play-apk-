# ALVES PLAY API

API Node.js + PostgreSQL para o bot e o período de teste do ALVES PLAY. O banco pode ser hospedado no Supabase Free; a API roda no Render Free.

## Rotas
- `GET /health`: verifica API e conexão com o banco.
- `POST /bot/test`: inicia uma única janela de teste por identificador e encaminha a mensagem ao provedor do bot.

## Banco gratuito no Supabase
1. Crie um projeto no [Supabase](https://supabase.com/dashboard) usando o plano Free.
2. No projeto, abra **Connect** e selecione **Session pooler** (não use Transaction pooler para este backend persistente).
3. Copie a URI PostgreSQL. Ela terá host `*.pooler.supabase.com`, porta `5432` e usuário no formato `postgres.<PROJECT_REF>`.
4. Substitua o marcador da senha pela senha do banco. Se a senha tiver caracteres especiais, codifique-os para URL.
5. No Render, abra o serviço `alves-play-api` > **Environment** e salve a URI completa como `DATABASE_URL`. Nunca coloque essa URI no GitHub, HTML ou APK.
6. A API cria a tabela `app_clients` e o índice automaticamente na inicialização. O arquivo `db/schema.sql` também está disponível para execução manual.

**Não é necessário colocar a chave anon ou service_role do Supabase no aplicativo.** Este backend acessa o PostgreSQL pelo servidor, usando apenas a URI privada armazenada como variável secreta no Render.

## Configuração local / Render
1. Use Node.js 20 ou superior.
2. Configure as variáveis de ambiente a partir de `.env.example`.
3. Configure `BOT_PROVIDER_URL` para um endpoint HTTPS que aceite POST JSON com `app`, `client_id`, `command` e `message`, e retorne JSON com `reply`.
4. Configure `BOT_PROVIDER_API_KEY` somente no servidor, se o provedor exigir autenticação.
5. Configure `RENEW_URL` com a página de renovação.
6. Inicie com `npm start`.

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

## Limites do plano gratuito
- Render Free pode suspender a API após período sem tráfego; a primeira chamada pode demorar para acordar.
- Supabase Free inclui 500 MB de banco e pode pausar projetos com baixa atividade durante uma semana.
- O plano gratuito não inclui backups automáticos de banco. Faça exportações periódicas.
- Esta arquitetura é para testes e validação inicial, não uma garantia de disponibilidade para operação comercial.

## Segurança e pendências
- Não coloque chaves privadas no HTML, APK ou repositório.
- Use HTTPS e variáveis de ambiente do serviço de hospedagem.
- Defina `ALLOWED_ORIGINS` com a origem real do app quando ela estiver definida.
- Integração de pagamento/renovação não está implementada nesta versão.
