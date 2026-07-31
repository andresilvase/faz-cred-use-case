# Plano de implementação — Loan Decision

**Base:** PRD 0.8  
**Estratégia:** TDD, entregas incrementais e commits atômicos  
**Stack:** TypeScript, Node.js 24, Express 5, PostgreSQL com `pg`, Vitest e Testcontainers

## 1. Objetivo

Implementar o Loan Decision em incrementos pequenos, funcionais e verificáveis. Cada tarefa abaixo deve produzir um commit independente, manter a suíte de testes aprovada e deixar o repositório em estado executável.

O plano contempla somente o escopo da PRD 0.8. Não inclui desembolso, outbox, worker, webhook, consumo ou publicação de eventos, quitação, cancelamento ou redução da exposição.

## 2. Regras para commits atômicos

Cada tarefa deve obedecer às seguintes regras:

- começar por um teste que descreva o comportamento esperado;
- incluir no mesmo commit os testes e a implementação que os faz passar;
- tratar apenas um comportamento ou uma mudança coesa;
- não misturar refatorações independentes com funcionalidade nova;
- não deixar testes quebrados, código morto ou implementação parcial;
- incluir migração e código consumidor no mesmo commit quando um não possuir utilidade sem o outro;
- permitir reversão do commit sem quebrar tarefas anteriores;
- usar mensagens no formato sugerido em cada tarefa.

Quando uma refatoração for necessária antes de uma funcionalidade, ela deverá ser feita em um commit próprio, sem alterar comportamento.

## 3. Camadas da solução

| Camada | Responsabilidade | Restrições |
|---|---|---|
| Domínio | Valores, política e cálculo da decisão | Não conhece HTTP, Express, `pg` ou PostgreSQL |
| Aplicação | Orquestra decisão, idempotência e transação | Depende de contratos, não de detalhes de transporte |
| Infraestrutura | PostgreSQL, migrations, locks, repositórios e logs | Não contém regras de concentração |
| Interface HTTP | Validação do contrato, códigos e serialização | Não executa SQL nem recalcula regras de negócio |
| Testes | Especificação e verificação das camadas | Unitários para domínio; integração para HTTP, banco e concorrência |

As tarefas evoluem essas camadas gradualmente. Uma tarefa pode atravessar mais de uma camada quando isso for necessário para entregar um comportamento completo, mas o commit deve continuar possuindo uma única finalidade observável.

## 4. Ordem de implementação

### Tarefa 1 — Inicializar o serviço e a suíte de testes

**Objetivo funcional:** disponibilizar uma aplicação mínima executável com verificação de saúde.

**Implementar:**

- projeto TypeScript executado em Node.js 24;
- servidor Express 5;
- carregamento e validação das configurações essenciais;
- endpoint `GET /health`;
- encerramento controlado do servidor;
- Vitest configurado;
- scripts de desenvolvimento, build, execução e testes.

**Testar:**

- inicialização da aplicação;
- resposta do endpoint de saúde;
- falha explícita quando uma configuração obrigatória estiver ausente.

**Pronto quando:** a aplicação inicia, responde ao health check e toda a suíte passa.

**Commit sugerido:** `feat: bootstrap loan decision service`

---

### Tarefa 2 — Validar os dados da solicitação no domínio

**Objetivo funcional:** impedir que valores ou UFs inválidos cheguem à decisão.

**Implementar:**

- representação do valor em unidade monetária mínima, sem ponto flutuante;
- validação de `amount` ausente, zero, negativo ou fora do intervalo suportado;
- validação das 27 UFs brasileiras;
- validação de `borrower_id`;
- erros de domínio independentes de HTTP.

**Testar:**

- valores válidos e inválidos;
- todas as UFs válidas;
- códigos de UF inexistentes;
- normalização permitida, se houver, definida explicitamente no teste.

**Pronto quando:** as invariantes de entrada são exercitáveis sem servidor ou banco.

**Commit sugerido:** `feat: validate loan decision input`

---

### Tarefa 3 — Modelar a política versionada

**Objetivo funcional:** determinar o percentual aplicável sem valores fixos na lógica de decisão.

**Implementar:**

- modelo de política com versão;
- `minimum_portfolio_for_percentage_rule`;
- limite percentual padrão;
- limites específicos por UF;
- resolução do limite específico com fallback para o limite padrão;
- política inicial: padrão de 10%, SP com 20% e bootstrap de R$ 100.000.

**Testar:**

- resolução do limite padrão;
- resolução da exceção de SP;
- política com percentuais diferentes;
- política inválida, sem limite padrão ou com percentual fora do intervalo aceito.

**Pronto quando:** alterar os percentuais da política muda o resultado sem alterar código de domínio.

**Commit sugerido:** `feat: model versioned concentration policy`

---

### Tarefa 4 — Implementar a decisão durante o bootstrap

**Objetivo funcional:** decidir solicitações enquanto o total projetado for inferior a R$ 100.000.

**Implementar:**

- cálculo de `total_projetado` e `uf_projetada`;
- seleção do bootstrap pelo total projetado;
- cálculo do limite absoluto usando o percentual da política;
- aprovação no limite e negativa acima do limite.

**Testar:**

- SP até R$ 20.000 com a política inicial;
- SP acima de R$ 20.000;
- outra UF até R$ 10.000 com a política inicial;
- outra UF acima de R$ 10.000;
- percentuais alternativos fornecidos por outra política.

**Pronto quando:** a regra de bootstrap funciona como função pura e não conhece PostgreSQL ou HTTP.

**Commit sugerido:** `feat: decide loans during portfolio bootstrap`

---

### Tarefa 5 — Implementar a regra percentual

**Objetivo funcional:** decidir solicitações quando o total projetado atingir ou ultrapassar R$ 100.000.

**Implementar:**

- cálculo da concentração projetada da UF;
- comparação com o percentual aplicável da política;
- transição exata do bootstrap para a regra percentual;
- proteção contra divisão inválida e overflow.

**Testar:**

- total projetado exatamente em R$ 100.000;
- concentração abaixo, exatamente no limite e acima do limite;
- limite padrão e limite específico;
- política futura com percentuais diferentes.

**Pronto quando:** bootstrap e regra percentual compõem um único serviço de decisão determinístico.

**Commit sugerido:** `feat: apply projected concentration rule`

---

### Tarefa 6 — Definir o resultado lógico da decisão

**Objetivo funcional:** produzir respostas de negócio estáveis antes da integração HTTP.

**Implementar:**

- resultado `APPROVED` ou `DENIED`;
- mensagem `O valor solicitado foi aprovado.`;
- mensagem `O empréstimo foi negado.`;
- inclusão interna da versão da política aplicada;
- `loan_id` somente para aprovação após persistência.

**Testar:**

- mensagens exatas;
- ausência de `loan_id` na negativa;
- versão da política disponível internamente, mas fora da saída pública.

**Pronto quando:** o caso de uso possui contrato lógico independente do transporte.

**Commit sugerido:** `feat: define loan decision result`

---

### Tarefa 7 — Preparar PostgreSQL e testes de integração

**Objetivo funcional:** disponibilizar um banco descartável e reproduzível para o serviço.

**Implementar:**

- configuração de conexão com `pg`;
- Testcontainers para PostgreSQL;
- executor de migrations;
- migration técnica mínima necessária para validar o mecanismo;
- isolamento e limpeza do banco entre os testes.

**Testar:**

- aplicação das migrations em banco vazio;
- reaplicação segura conforme a estratégia escolhida;
- conexão, rollback e descarte do container.

**Pronto quando:** qualquer teste pode iniciar um PostgreSQL limpo e aplicar migrations de forma reproduzível.

**Commit sugerido:** `test: add postgres integration harness`

---

### Tarefa 8 — Persistir e consultar a política vigente

**Objetivo funcional:** usar a configuração de política armazenada no banco.

**Implementar:**

- migration de `state_policies` com suas constraints e índices;
- seed explícito da política inicial;
- consulta da versão vigente;
- leitura do limite padrão, exceções por UF e bootstrap;
- mapeamento entre registros do banco e modelo de domínio;
- erro técnico explícito quando não houver política vigente válida.

**Testar:**

- leitura da política inicial;
- leitura de uma nova versão;
- exceção de UF e fallback padrão;
- ausência ou inconsistência da política.

**Pronto quando:** a decisão pode receber uma política reconstruída do PostgreSQL.

**Commit sugerido:** `feat: load active concentration policy`

---

### Tarefa 9 — Consultar e bloquear os agregados de exposição

**Objetivo funcional:** obter uma visão consistente de `TOTAL` e da UF durante a decisão.

**Implementar:**

- migration de `exposure_aggregates` com chave única para `TOTAL` e cada UF;
- criação da linha `TOTAL` inicial;
- leitura das linhas `TOTAL` e `UF` de `exposure_aggregates`;
- bloqueio consistente com `SELECT ... FOR UPDATE`;
- ordem determinística de aquisição dos locks;
- criação controlada da linha da UF quando ainda não existir;
- atualização dos dois agregados na mesma transação.

**Testar:**

- carteira vazia;
- UF ainda não registrada;
- leitura e atualização de `TOTAL` e UF;
- rollback sem alteração residual.

**Pronto quando:** agregados podem ser lidos, bloqueados e atualizados atomicamente.

**Commit sugerido:** `feat: lock and update exposure aggregates`

---

### Tarefa 10 — Persistir uma aprovação atomicamente

**Objetivo funcional:** criar um empréstimo aprovado sem permitir divergência da exposição.

**Implementar:**

- migration de `loans` com constraints, índices e referência à versão da política;
- transação curta;
- bloqueio dos agregados;
- leitura da política vigente dentro da decisão transacional;
- recálculo da exposição projetada;
- criação em `loans` somente quando aprovada;
- persistência de `policy_version` no empréstimo;
- atualização de `TOTAL` e UF no mesmo commit;
- rollback integral em falha técnica.

**Testar:**

- aprovação cria exatamente um empréstimo;
- empréstimo e agregados refletem o mesmo valor;
- versão da política é persistida;
- falha após o `INSERT` não deixa empréstimo ou agregado parcial.

**Pronto quando:** aprovação e exposição constituem uma única operação atômica.

**Commit sugerido:** `feat: persist approved loan atomically`

---

### Tarefa 11 — Processar uma negativa sem criar empréstimo

**Objetivo funcional:** negar uma solicitação sem alterar a carteira.

**Implementar:**

- caminho transacional de negativa;
- ausência de `INSERT` em `loans`;
- ausência de atualização dos agregados;
- resultado interno contendo a versão da política aplicada.

**Testar:**

- negativa não cria empréstimo;
- negativa não modifica `TOTAL` nem UF;
- aprovação anterior permanece intacta;
- falha técnica continua distinta de negativa de negócio.

**Pronto quando:** a regra “empréstimo negado não deve ser criado” estiver comprovada no PostgreSQL.

**Commit sugerido:** `feat: persist denied decision without exposure changes`

---

### Tarefa 12 — Implementar idempotência ponta a ponta

**Objetivo funcional:** impedir duplicidade por retry e reproduzir a resposta original.

**Implementar:**

- migration de `idempotency_requests` com constraints e índice único;
- chave composta por solicitante e `Idempotency-Key`;
- hash determinístico dos campos relevantes da solicitação;
- persistência de resultado, resposta e `policy_version`;
- mesma chave e payload retornando a resposta original;
- mesma chave e payload diferente produzindo conflito;
- registro idempotente participando da mesma transação do empréstimo.

**Testar:**

- retry de aprovação cria somente um empréstimo;
- retry de negativa não cria empréstimo;
- retry retorna exatamente a resposta persistida;
- reutilização da chave com payload diferente produz conflito;
- solicitações distintas podem usar chaves distintas.

**Pronto quando:** retries não duplicam efeitos nem recalculam decisões concluídas.

**Commit sugerido:** `feat: make loan decisions idempotent`

> A expiração automática não deve ser implementada enquanto o prazo de retenção permanecer em aberto na PRD.

---

### Tarefa 13 — Expor `POST /loan-decisions`

**Objetivo funcional:** disponibilizar o caso de uso pelo contrato HTTP da PRD.

**Implementar:**

- body com `borrower_id`, `uf` e `amount`;
- header obrigatório `Idempotency-Key`;
- `200` para `APPROVED` e `DENIED`;
- `400` para entrada inválida;
- `409` para conflito de idempotência;
- `500` para falha técnica inesperada;
- `policy_version` ausente da resposta pública.

**Testar:**

- contrato completo de aprovação;
- contrato completo de negativa;
- todos os erros de entrada;
- conflito de idempotência;
- falha de banco convertida em erro técnico sem expor detalhes internos.

**Pronto quando:** todos os códigos, campos e mensagens da PRD estiverem cobertos por testes HTTP.

**Commit sugerido:** `feat: expose loan decision endpoint`

---

### Tarefa 14 — Garantir segurança concorrente

**Objetivo funcional:** impedir aprovações simultâneas que, combinadas, excedam a política.

**Implementar:**

- coordenação concorrente usando os locks dos agregados;
- timeout de lock e tratamento de deadlock conforme estratégia documentada;
- retry técnico somente quando seguro;
- ordem consistente de bloqueio entre `TOTAL` e UF.

**Testar:**

- duas solicitações simultâneas para a mesma UF;
- solicitações simultâneas para UFs diferentes disputando `TOTAL`;
- somente o conjunto permitido pela política sendo aprovado;
- ausência de empréstimos e agregados divergentes após concorrência.

**Pronto quando:** testes paralelos comprovarem que nenhuma combinação ultrapassa os limites.

**Commit sugerido:** `fix: prevent concurrent concentration breaches`

---

### Tarefa 15 — Reconstruir e verificar os agregados

**Objetivo funcional:** comprovar que `exposure_aggregates` é derivado e `loans` permanece como fonte oficial.

**Implementar:**

- operação interna de reconstrução dos agregados a partir de `loans`;
- verificação de divergência entre valores calculados e armazenados;
- execução manual ou administrativa, sem criar endpoint público neste incremento.

**Testar:**

- reconstrução com carteira vazia;
- reconstrução com múltiplas UFs;
- correção de agregado propositalmente divergente;
- soma de `TOTAL` igual à soma oficial de `loans`.

**Pronto quando:** os agregados puderem ser descartados e reproduzidos sem perda de informação.

**Commit sugerido:** `feat: rebuild exposure aggregates from loans`

---

### Tarefa 16 — Adicionar logs técnicos e proteções de infraestrutura

**Objetivo funcional:** permitir diagnóstico técnico sem registrar dados sensíveis.

**Implementar:**

- logs de inicialização e encerramento;
- `correlation_id`, rota, método, status e duração;
- logs de validação, conexão, consulta, transação e erro inesperado;
- stack trace somente no ambiente apropriado;
- queries exclusivamente parametrizadas;
- credenciais e segredos fora do código;
- configuração para TLS e usuário de banco com menor privilégio.

**Não registrar:**

- tokens ou segredos;
- payload completo;
- dados pessoais completos;
- `Idempotency-Key` em texto aberto, se ela puder ser correlacionada externamente.

**Testar:**

- presença dos campos técnicos mínimos;
- ausência de dados sensíveis;
- logs produzidos em falhas relevantes;
- erro HTTP sem vazamento da mensagem interna do banco.

**Pronto quando:** os cenários críticos forem diagnosticáveis sem violar os requisitos de privacidade.

**Commit sugerido:** `feat: add safe technical logging and database protections`

> A exclusão automática dos logs não deve ser implementada enquanto o prazo de retenção permanecer em aberto na PRD.

---

### Tarefa 17 — Documentar e finalizar a entrega

**Objetivo funcional:** tornar a solução compreensível, executável e avaliável sem contexto externo.

**Implementar no `README.md`:**

- visão geral da solução;
- requisitos e comandos de instalação, execução e testes;
- arquitetura e responsabilidades das camadas;
- fluxo da transação de aprovação e negativa;
- idempotência e concorrência;
- `loans` como fonte oficial e agregados como projeção;
- políticas versionadas e bootstrap como premissa;
- decisões técnicas e trade-offs;
- limitações e itens fora do escopo;
- possíveis evoluções.

**Verificar:**

- execução a partir de um clone limpo;
- migrations em banco vazio;
- testes unitários e de integração;
- ausência de referências a desembolso, outbox, worker ou webhook como funcionalidades implementadas;
- exemplos HTTP coerentes com o contrato final.

**Pronto quando:** uma pessoa externa conseguir executar, testar e compreender a solução usando somente o repositório.

**Commit sugerido:** `docs: document loan decision implementation`

## 5. Dependências entre tarefas

| Tarefa | Depende de |
|---|---|
| 1 | — |
| 2 | 1 |
| 3 | 2 |
| 4 | 3 |
| 5 | 4 |
| 6 | 5 |
| 7 | 1 |
| 8 | 3 e 7 |
| 9 | 7 |
| 10 | 5, 6, 8 e 9 |
| 11 | 10 |
| 12 | 10 e 11 |
| 13 | 2, 6 e 12 |
| 14 | 10, 12 e 13 |
| 15 | 10 |
| 16 | 13 e 14 |
| 17 | Todas as anteriores |

## 6. Checklist para cada commit

Antes de criar cada commit:

- [ ] o teste do comportamento foi escrito primeiro;
- [ ] a implementação contém somente o necessário para o teste passar;
- [ ] testes unitários e de integração afetados estão verdes;
- [ ] build e verificação de tipos passam;
- [ ] migrations e código estão sincronizados;
- [ ] não há segredo ou dado pessoal nos arquivos ou logs;
- [ ] o commit possui uma única responsabilidade;
- [ ] a mensagem descreve o resultado entregue;
- [ ] a reversão do commit não invalida commits anteriores.

## 7. Definição de concluído do MVP

O MVP estará concluído quando:

- todas as tarefas obrigatórias estiverem implementadas;
- toda aprovação criar exatamente um empréstimo e atualizar os agregados atomicamente;
- toda negativa não criar empréstimo nem alterar a exposição;
- políticas vigentes determinarem bootstrap e percentuais;
- retries não duplicarem efeitos;
- concorrência não permitir ultrapassagem dos limites;
- agregados forem reconstruíveis a partir de `loans`;
- contratos HTTP, logs e documentação estiverem consistentes com a PRD 0.8;
- toda a suíte automatizada estiver aprovada.
