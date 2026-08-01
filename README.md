# Loan Decision

Serviço de decisão de empréstimos orientado por uma política versionada de concentração geográfica. O objetivo é impedir que a carteira acumule exposição excessiva em uma única UF, preservando consistência, idempotência e segurança mesmo sob requisições concorrentes.

## Visão geral

O Loan Decision recebe uma solicitação de um usuário previamente autenticado e autorizado, valida os dados e decide se o empréstimo pode ser aprovado sem violar a política vigente.

Quando a solicitação é aprovada, o serviço cria o empréstimo e atualiza a exposição total e da UF na mesma transação PostgreSQL. Quando é negada, não cria empréstimo nem altera os agregados.

O serviço decide e registra a aprovação, mas **não transfere ou desembolsa dinheiro**.

## Regra de concentração

A decisão considera o cenário depois da possível aprovação:

```text
total_projetado = exposição_total_atual + valor_solicitado
uf_projetada = exposição_atual_da_uf + valor_solicitado
```

Os percentuais não são constantes da lógica de domínio. Eles pertencem à política versionada vigente. A política inicial define:

| Aplicação | Percentual inicial |
|---|---:|
| Limite padrão | 10% |
| Exceção para SP | 20% |

### Bootstrap da carteira

Aplicar percentuais diretamente sobre uma carteira vazia impediria o primeiro empréstimo, pois ele representaria 100% do total. Por isso, a PRD adota um bootstrap até o limiar de R$ 100.000.

Enquanto `total_projetado < R$ 100.000`, o limite absoluto da UF é calculado por:

```text
limite_absoluto_da_uf = percentual_aplicável × R$ 100.000
```

Com a política inicial, isso corresponde a R$ 20.000 para SP e R$ 10.000 para as demais UFs. A solicitação que fizer o total atingir ou ultrapassar R$ 100.000 já obedece à regra percentual normal:

```text
concentração_projetada = uf_projetada / total_projetado
```

O empréstimo é aprovado somente quando a concentração projetada não ultrapassa o percentual aplicável da política vigente.

## Evolução do desenho

Os diagramas registram a evolução da solução em ordem cronológica:

1. [general-flow.svg](diagrams/general-flow.svg) — rascunho inicial do fluxo geral entre usuário, Loan Service e banco de dados.
2. [transaction-process.svg](diagrams/loan-service.mmd) — refinamento do funcionamento interno, com transação, bloqueio dos agregados, cálculo projetado e caminhos de aprovação ou negativa.
3. [fluxo-backend-0.8.svg](diagrams/fluxo-backend-0.8.svg) — arquitetura final proposta para o MVP da PRD 0.8.

O primeiro arquivo é histórico e não representa sozinho a especificação vigente. O SVG abaixo é a referência visual final do MVP:

![Arquitetura final do backend Loan Decision](diagrams/fluxo-backend-0.8.svg)

## Arquitetura

O código é organizado para manter regras de negócio independentes de HTTP e PostgreSQL:

| Camada | Responsabilidade |
|---|---|
| Domínio | Valores, validações, política e cálculo determinístico da decisão |
| Aplicação | Orquestra decisão, idempotência e fronteira transacional |
| Interface HTTP | Valida o contrato, traduz erros e serializa respostas |
| Infraestrutura | PostgreSQL, migrations, locks, repositórios e logs técnicos |

```text
src/
├── domain/          # invariantes, política e decisão pura
├── application/     # caso de uso, idempotência e contrato transacional
├── interfaces/http/ # Express, validação e contrato público
├── infrastructure/  # PostgreSQL, migrations, configuração e logs
└── test-support/     # PostgreSQL descartável para testes de integração
```

### Fluxo transacional

1. Receber `borrower_id`, `uf`, `amount` e `Idempotency-Key`.
2. Validar o contrato e os valores de domínio.
3. Verificar se a intenção já foi processada.
4. Iniciar uma transação PostgreSQL curta.
5. Bloquear `TOTAL` e a UF em ordem determinística.
6. Ler a política vigente.
7. Calcular a exposição projetada.
8. Aplicar bootstrap ou regra percentual.
9. Persistir a resposta idempotente e a versão da política.
10. Em caso de aprovação, criar o empréstimo e atualizar os agregados no mesmo commit.
11. Em caso de negativa, concluir sem criar empréstimo ou modificar a exposição.

Qualquer falha provoca rollback do conjunto inteiro. Nenhuma chamada externa acontece dentro da transação.

## Persistência

| Estrutura | Responsabilidade |
|---|---|
| `loans` | Fonte oficial dos empréstimos aprovados e da exposição |
| `exposure_aggregates` | Projeção reconstruível com linhas para `TOTAL` e para cada UF |
| `state_policies` | Dados gerais da política versionada: bootstrap, limite padrão, vigência e data de criação |
| `state_policy_limits` | Limites específicos por UF associados a uma versão da política |
| `idempotency_requests` | Chave, hash da solicitação, resultado, resposta e versão da política |

Uma política em `state_policies` pode possuir zero ou vários registros em `state_policy_limits`. Ao decidir:

1. o serviço procura um limite específico para a UF na versão vigente;
2. se encontrar, utiliza `limit_basis_points`;
3. caso contrário, utiliza `default_limit_basis_points` de `state_policies`.

Os percentuais são armazenados em pontos-base: `1000` representa 10% e `2000` representa 20%. Na política inicial, o limite padrão é 10% e `state_policy_limits` registra a exceção de 20% para SP.

`exposure_aggregates` existe para tornar consulta e bloqueio eficientes, mas não substitui `loans` como fonte oficial. Seus valores devem poder ser reconstruídos a partir dos empréstimos.

## Contrato HTTP

```http
POST /loan-decisions
Content-Type: application/json
Idempotency-Key: <identificador único>

{
  "borrower_id": "<identificador>",
  "uf": "GO",
  "amount": 10000
}
```

`amount` utiliza unidade monetária mínima. Uma nova intenção deve possuir uma nova chave; retries da mesma intenção devem reutilizar a chave original.

Resposta de aprovação:

```json
{
  "decision": "APPROVED",
  "message": "O valor solicitado foi aprovado.",
  "loan_id": "<identificador>"
}
```

Resposta de negativa:

```json
{
  "decision": "DENIED",
  "message": "O empréstimo foi negado."
}
```

Uma negativa por concentração é uma resposta de negócio válida e retorna `200 OK`. `policy_version` é persistida internamente, mas não é retornada ao cliente. Toda resposta inclui `X-Correlation-Id` para correlação com os logs técnicos.

| Status | Significado |
|---:|---|
| `200` | Decisão válida, aprovada ou negada |
| `400` | Body, UF, valor ou `Idempotency-Key` inválido |
| `409` | Mesma chave reutilizada com payload diferente |
| `500` | Falha técnica inesperada, sem detalhes internos do banco |

## Idempotência e concorrência

O serviço oferece as seguintes garantias:

- mesma chave e mesmo payload retornam a resposta original;
- mesma chave e payload diferente produzem `409 Conflict`;
- retries não criam empréstimos duplicados;
- locks de linha coordenam decisões concorrentes;
- empréstimo, agregados e resultado idempotente são persistidos atomicamente;
- falhas técnicas causam rollback integral.

Essas garantias são cobertas por testes de integração com PostgreSQL e Testcontainers.

## Stack

- TypeScript;
- Node.js 24;
- Express 5;
- PostgreSQL com `pg`;
- Vitest;
- Testcontainers para os testes de integração.

## Executar o serviço

### Pré-requisitos

- Git;
- Node.js 24 e npm;
- Docker com o daemon em execução, tanto para o PostgreSQL local quanto para os testes de integração.

### Instalação a partir de um clone limpo

```bash
git clone <url-do-repositorio>
cd faz-cred-use-case
npm ci
```

### Criar um PostgreSQL local vazio

O exemplo abaixo cria um banco descartável e dois usuários: o migrador possui DDL; a aplicação recebe somente DML nas tabelas criadas. As senhas são apenas exemplos locais e devem ser substituídas fora desse ambiente.

```bash
docker run --name loan-decision-postgres \
  -e POSTGRES_USER=loan_decision_migrator \
  -e POSTGRES_PASSWORD=local_migrator_password \
  -e POSTGRES_DB=loan_decision \
  -p 5432:5432 \
  -d postgres:17

until docker exec loan-decision-postgres \
  pg_isready -U loan_decision_migrator -d loan_decision; do sleep 1; done

docker exec loan-decision-postgres psql \
  -U loan_decision_migrator \
  -d loan_decision \
  -v ON_ERROR_STOP=1 \
  -c "CREATE ROLE loan_decision_app LOGIN PASSWORD 'local_app_password'" \
  -c "GRANT CONNECT ON DATABASE loan_decision TO loan_decision_app" \
  -c "GRANT USAGE ON SCHEMA public TO loan_decision_app" \
  -c "ALTER DEFAULT PRIVILEGES FOR ROLE loan_decision_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO loan_decision_app"
```

Na primeira inicialização, `MIGRATION_DATABASE_URL` aplica todas as migrations no banco vazio. O pool da aplicação usa `DATABASE_URL`, mantendo as credenciais de DDL separadas das credenciais de runtime.

### Configuração

| Variável | Obrigatória | Uso |
|---|---|---|
| `PORT` | Sim | Porta HTTP entre 1 e 65535 |
| `DATABASE_URL` | Sim | Conexão do usuário de runtime com menor privilégio |
| `MIGRATION_DATABASE_URL` | Sim | Conexão do usuário autorizado a executar migrations |
| `DATABASE_SSL_MODE` | Sim | `disable` para ambiente local confiável ou `verify-full` |
| `DATABASE_SSL_CA` | Quando necessário | CA confiável usada com `verify-full` |
| `NODE_ENV` | Não | `production` por padrão; stacks sanitizados somente fora de produção |

As variáveis contêm credenciais e não devem ser commitadas. O arquivo [.env.example](.env.example) contém apenas valores locais ilustrativos; o processo não carrega `.env` automaticamente.

Para executar em desenvolvimento:

```bash
export PORT=3000
export DATABASE_URL='postgresql://loan_decision_app:local_app_password@localhost:5432/loan_decision'
export MIGRATION_DATABASE_URL='postgresql://loan_decision_migrator:local_migrator_password@localhost:5432/loan_decision'
export DATABASE_SSL_MODE=disable
export NODE_ENV=development
npm run dev
```

Em outro terminal:

```bash
curl --fail http://localhost:3000/health

curl --include \
  --request POST http://localhost:3000/loan-decisions \
  --header 'Content-Type: application/json' \
  --header 'Idempotency-Key: example-intention-001' \
  --data '{"borrower_id":"example-borrower","uf":"GO","amount":10000}'
```

O primeiro comando retorna `{"status":"ok"}`. Em um banco vazio com a política inicial, a solicitação de exemplo é aprovada e retorna `decision`, `message` e `loan_id` com status `200`.

### Build e execução de produção

```bash
npm run build
export PORT=3000
export DATABASE_URL='<url-do-usuario-runtime>'
export MIGRATION_DATABASE_URL='<url-do-usuario-de-migrations>'
export DATABASE_SSL_MODE=verify-full
export DATABASE_SSL_CA='<ca-confiavel-em-pem>'
export NODE_ENV=production
npm start
```

Em produção, forneça segredos por um gerenciador de segredos, use usuários distintos para migration e runtime e mantenha `verify-full`. A aplicação executa migrations antes de abrir a porta HTTP e encerra o pool de migrations em seguida.

### Testes e verificações

Os testes de domínio não precisam de banco:

```bash
npx vitest run src/domain
```

Com Docker ativo, a suíte completa provisiona PostgreSQL descartável via Testcontainers e cobre persistência, rollback, migrations, idempotência, concorrência, reconstrução dos agregados, HTTP e logs:

```bash
npm test
```

Execute também as verificações estáticas e o build:

```bash
npm run typecheck
npm run build
```

Para executar os testes em modo de observação:

```bash
npm run test:watch
```

## Testes manuais e Postman

As instruções incrementais estão em [TESTES-MANUAIS.md](TESTES-MANUAIS.md). Importe [Loan-Decision.postman_collection.json](Loan-Decision.postman_collection.json) na extensão do Postman ou no aplicativo.

O plano de construção está registrado em [PLANO-DE-IMPLEMENTACAO-PRD-0.8.md](PLANO-DE-IMPLEMENTACAO-PRD-0.8.md), e os requisitos completos estão em [PRD-MVP-Loan-Decision.md](PRD-MVP-Loan-Decision.md).

## Segurança e observabilidade

- queries exclusivamente parametrizadas;
- credenciais fornecidas por ambiente, fora do código;
- pools separados para migrations e runtime;
- TLS verificável e usuário de banco com menor privilégio;
- logs com `correlation_id`, rota, método, status e duração;
- nenhum token, segredo, payload completo ou dado pessoal completo nos logs;
- stack trace sanitizado apenas fora de produção;
- erros HTTP genéricos, sem mensagens internas do PostgreSQL.

Os logs são JSON emitidos em `stdout`, adequados para coleta pela plataforma de execução. A retenção deve ser definida externamente quando houver uma política aprovada.

## Operação dos agregados

`PostgresExposureRebuilder` verifica divergências e reconstrói `exposure_aggregates` a partir de `loans` dentro de uma transação com lock exclusivo. A operação é interna e administrativa: este MVP não expõe endpoint público nem comando CLI para executá-la. Os testes de integração demonstram reconstrução de carteira vazia, múltiplas UFs e correção de divergência.

## Fora do escopo do MVP

- autenticação e autorização;
- transferência, liberação ou desembolso;
- integração com banco, Pix ou parceiro externo;
- quitação, cancelamento, reversão ou redução da exposição;
- consumo ou publicação de eventos;
- análise de crédito, fraude, renda, score ou capacidade de pagamento;
- cobrança, parcelamento e renegociação;
- comunicação com o cliente;
- painel administrativo, métricas e dashboards.

## Limitações conhecidas

- quitação e redução de exposição estão fora deste incremento, portanto o total acumulado só cresce;
- os prazos de retenção de idempotência e logs permanecem em aberto na PRD 0.8;
- migrations são executadas no startup; implantações com muitas réplicas podem preferir uma etapa exclusiva de deployment;
- locks pessimistas no agregado `TOTAL` preservam consistência, mas limitam throughput sob contenção elevada;
- a reconstrução de agregados existe como operação interna, sem interface administrativa;
- não há autenticação ou autorização neste serviço: a identidade recebida deve ter sido validada pelo componente anterior.

## Decisões e trade-offs

- **Agregados de exposição:** melhoram eficiência e coordenação concorrente, ao custo de uma projeção adicional que precisa ser atualizada atomicamente e permanecer reconstruível.
- **Locks pessimistas:** priorizam consistência da política de concentração, podendo elevar a contenção sob carga intensa.
- **Políticas versionadas:** permitem alterar percentuais sem mudar a lógica, ao custo de persistência e validação adicionais.
- **Bootstrap explícito:** torna possível formar a carteira inicial, mas é uma premissa de produto adicionada porque o case não define esse cenário.
- **Implementação incremental com TDD:** reduz o escopo de cada mudança e mantém commits reversíveis, mas adia o primeiro fluxo HTTP completo até as dependências estarem prontas.

## Possíveis evoluções

- definir e automatizar retenção de logs e registros idempotentes;
- mover migrations para uma etapa exclusiva do deployment;
- oferecer um comando administrativo autenticado para verificar e reconstruir agregados;
- adicionar autenticação, autorização, métricas operacionais e tracing distribuído;
- executar testes de carga para calibrar pool, timeout de lock e política de retries;
- modelar quitação, cancelamento e redução de exposição em um incremento futuro, com novas regras de consistência.
