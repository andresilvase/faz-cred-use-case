# Testes manuais — Loan Decision

Este guia acompanha os incrementos da PRD 0.8. A coleção `Loan-Decision.postman_collection.json` contém somente comportamentos HTTP realmente expostos pelo serviço.

## Preparação comum

Pré-requisitos:

- Node.js 24;
- npm;
- repositório atualizado na branch `main`.

Prepare o projeto após um clone limpo:

```bash
npm ci
npm run build
```

## Tarefa 1 — Inicializar o serviço e a suíte de testes

### Objetivo verificável

Confirmar que o serviço inicia com a configuração obrigatória e responde ao health check.

### Postman

1. Importe `Loan-Decision.postman_collection.json`.
2. Confirme que a variável `base_url` vale `http://localhost:3000`.
3. Inicie o serviço em outro terminal:

   ```bash
   PORT=3000 npm start
   ```

4. Execute `Service health / GET /health`.

Resultado esperado:

- status HTTP `200`;
- `Content-Type` contendo `application/json`;
- corpo exatamente igual a `{ "status": "ok" }`;
- os três testes da requisição aprovados.

Para confirmar a falha de configuração, execute sem `PORT`:

```bash
env -u PORT npm start
```

O processo deve encerrar com erro informando que `PORT` é obrigatória, sem iniciar o servidor.

## Tarefa 2 — Validar os dados da solicitação no domínio

### Objetivo verificável

Confirmar diretamente no domínio que:

- `amount` aceita somente inteiros positivos em unidade monetária mínima e dentro do intervalo suportado;
- somente as 27 UFs brasileiras em letras maiúsculas são aceitas;
- `borrowerId` deve ser uma string não vazia e sem espaços nas extremidades;
- uma entrada válida produz um objeto de domínio cujo valor monetário é representado por `bigint`.

### Teste de entrada válida

Depois de executar `npm run build`:

```bash
node --input-type=module -e 'import { createLoanDecisionInput } from "./dist/domain/loan-decision-input.js"; console.log(createLoanDecisionInput({ borrowerId: "borrower-123", uf: "SP", amount: 10000 }));'
```

Resultado esperado:

```text
{ borrowerId: 'borrower-123', uf: 'SP', amount: 10000n }
```

O sufixo `n` comprova que `amount` foi convertido para `bigint` e não usa ponto flutuante dentro do domínio.

### Testes de entradas inválidas

Valor fracionário:

```bash
node --input-type=module -e 'import { createLoanAmount } from "./dist/domain/loan-decision-input.js"; try { createLoanAmount(10.5); } catch (error) { console.log(error.name, error.field, error.message); }'
```

Resultado esperado:

```text
DomainValidationError amount amount must be an integer between 1 and 9007199254740991
```

UF inexistente ou não normalizada:

```bash
node --input-type=module -e 'import { createUf } from "./dist/domain/loan-decision-input.js"; try { createUf("sp"); } catch (error) { console.log(error.name, error.field, error.message); }'
```

Resultado esperado:

```text
DomainValidationError uf uf must be one of the 27 uppercase Brazilian state codes
```

Identificador com espaços nas extremidades:

```bash
node --input-type=module -e 'import { createBorrowerId } from "./dist/domain/loan-decision-input.js"; try { createBorrowerId(" borrower-123 "); } catch (error) { console.log(error.name, error.field, error.message); }'
```

Resultado esperado:

```text
DomainValidationError borrowerId borrowerId must be a non-empty string without surrounding whitespace
```

### Verificação automatizada complementar

Execute a especificação completa da Tarefa 2:

```bash
npm test -- src/domain/loan-decision-input.test.ts
```

O arquivo deve executar 23 casos com sucesso.

### Por que a Tarefa 2 não está no Postman

Esta tarefa implementa somente funções puras do domínio. O endpoint `POST /loan-decisions` está previsto para a Tarefa 13. Até lá, expor essa validação por HTTP exigiria antecipar o plano ou criar uma rota artificial de teste.

Este procedimento comprova o comportamento das funções publicadas pelo módulo, mas não comprova o futuro mapeamento de erros do domínio para respostas HTTP.

## Tarefa 3 — Modelar a política versionada

### Objetivo verificável

Confirmar diretamente no domínio que:

- a política inicial possui versão `1` e limiar de bootstrap de R$ 100.000 em unidade monetária mínima;
- SP usa o limite específico de 20%, enquanto uma UF sem exceção usa o limite padrão de 10%;
- outra versão pode fornecer percentuais diferentes sem alteração da lógica de domínio;
- políticas inconsistentes são rejeitadas explicitamente.

Os percentuais são representados em pontos-base: `1_000` equivale a 10%, `2_000` a 20% e `10_000` a 100%.

### Política inicial e fallback por UF

Depois de executar `npm run build`:

```bash
node --input-type=module -e 'import { INITIAL_CONCENTRATION_POLICY } from "./dist/domain/concentration-policy.js"; import { createUf } from "./dist/domain/loan-decision-input.js"; console.log({ version: INITIAL_CONCENTRATION_POLICY.version, minimumPortfolioForPercentageRule: INITIAL_CONCENTRATION_POLICY.minimumPortfolioForPercentageRule, spLimitBasisPoints: INITIAL_CONCENTRATION_POLICY.limitFor(createUf("SP")), goLimitBasisPoints: INITIAL_CONCENTRATION_POLICY.limitFor(createUf("GO")) });'
```

Resultado esperado:

```text
{
  version: '1',
  minimumPortfolioForPercentageRule: 10000000n,
  spLimitBasisPoints: 2000,
  goLimitBasisPoints: 1000
}
```

O valor `10000000n` representa R$ 100.000,00 em centavos. O resultado de GO comprova o fallback para o limite padrão, enquanto SP resolve sua exceção específica.

### Política futura com percentuais diferentes

```bash
node --input-type=module -e 'import { createConcentrationPolicy } from "./dist/domain/concentration-policy.js"; import { createUf } from "./dist/domain/loan-decision-input.js"; const policy = createConcentrationPolicy({ version: "future-policy", minimumPortfolioForPercentageRule: 20000000, defaultLimitBasisPoints: 2500, stateLimitBasisPoints: { SP: 3000 } }); console.log({ version: policy.version, goLimitBasisPoints: policy.limitFor(createUf("GO")), spLimitBasisPoints: policy.limitFor(createUf("SP")) });'
```

Resultado esperado:

```text
{
  version: 'future-policy',
  goLimitBasisPoints: 2500,
  spLimitBasisPoints: 3000
}
```

Esse cenário evidencia que os percentuais são dados da política versionada, não constantes da lógica de decisão.

### Política inválida

```bash
node --input-type=module -e 'import { createConcentrationPolicy } from "./dist/domain/concentration-policy.js"; try { createConcentrationPolicy({ version: "invalid-policy", minimumPortfolioForPercentageRule: 10000000, defaultLimitBasisPoints: 10001 }); } catch (error) { console.log(error.name, error.field, error.message); }'
```

Resultado esperado:

```text
InvalidConcentrationPolicyError defaultLimitBasisPoints defaultLimitBasisPoints must be an integer between 0 and 10000
```

### Verificação automatizada complementar

Execute a especificação completa da Tarefa 3:

```bash
npm test -- src/domain/concentration-policy.test.ts
```

O arquivo deve executar 13 casos com sucesso.

Para confirmar que o incremento não quebrou tarefas anteriores:

```bash
npm test
npm run typecheck
npm run build
```

Todos os comandos devem terminar com sucesso.

### Por que a Tarefa 3 não está no Postman

Esta tarefa adiciona somente o modelo e as validações da política no domínio. A política ainda não é exposta por HTTP e o endpoint `POST /loan-decisions` está previsto para a Tarefa 13. Por isso, a coleção Postman continua apenas com o health check; adicionar uma requisição agora criaria uma superfície inexistente.

Os comandos acima comprovam a resolução dos parâmetros e as validações do modelo. Eles ainda não comprovam o cálculo de aprovação ou negativa, que começa nas Tarefas 4 e 5.

## Tarefa 4 — Implementar a decisão durante o bootstrap

### Objetivo verificável

Confirmar diretamente no domínio que, enquanto o total projetado for inferior ao limiar da política:

- a exposição total e a exposição da UF são projetadas com o valor solicitado;
- o limite absoluto da UF é derivado do percentual aplicável e do limiar de bootstrap;
- a solicitação é aprovada quando a exposição projetada da UF está exatamente no limite;
- a solicitação é negada quando a exposição projetada da UF ultrapassa o limite;
- o bootstrap deixa de ser aplicado quando o total projetado alcança o limiar.

Todos os valores monetários abaixo estão em centavos e são processados como `bigint`.

### Aprovação de SP exatamente no limite inicial

Depois de executar `npm run build`:

```bash
node --input-type=module -e 'import { decideDuringBootstrap } from "./dist/domain/bootstrap-loan-decision.js"; import { INITIAL_CONCENTRATION_POLICY } from "./dist/domain/concentration-policy.js"; import { createLoanAmount, createUf } from "./dist/domain/loan-decision-input.js"; console.log(decideDuringBootstrap({ currentTotalExposure: 0n, currentUfExposure: 0n, requestedAmount: createLoanAmount(2000000), uf: createUf("SP"), policy: INITIAL_CONCENTRATION_POLICY }));'
```

Resultado esperado:

```text
{
  approved: true,
  projectedTotalExposure: 2000000n,
  projectedUfExposure: 2000000n,
  bootstrapUfLimit: 2000000n
}
```

Isso representa uma solicitação de R$ 20.000,00 aprovada exatamente no limite de SP definido pela política inicial.

### Negativa de SP acima do limite inicial

```bash
node --input-type=module -e 'import { decideDuringBootstrap } from "./dist/domain/bootstrap-loan-decision.js"; import { INITIAL_CONCENTRATION_POLICY } from "./dist/domain/concentration-policy.js"; import { createLoanAmount, createUf } from "./dist/domain/loan-decision-input.js"; console.log(decideDuringBootstrap({ currentTotalExposure: 2000000n, currentUfExposure: 2000000n, requestedAmount: createLoanAmount(1), uf: createUf("SP"), policy: INITIAL_CONCENTRATION_POLICY }));'
```

Resultado esperado:

```text
{
  approved: false,
  projectedTotalExposure: 2000001n,
  projectedUfExposure: 2000001n,
  bootstrapUfLimit: 2000000n
}
```

Um centavo acima do limite já deve produzir `approved: false`.

### Limite derivado de outra versão de política

```bash
node --input-type=module -e 'import { decideDuringBootstrap } from "./dist/domain/bootstrap-loan-decision.js"; import { createConcentrationPolicy } from "./dist/domain/concentration-policy.js"; import { createLoanAmount, createUf } from "./dist/domain/loan-decision-input.js"; const policy = createConcentrationPolicy({ version: "future-policy", minimumPortfolioForPercentageRule: 20000000, defaultLimitBasisPoints: 2500, stateLimitBasisPoints: { SP: 3000 } }); console.log(decideDuringBootstrap({ currentTotalExposure: 8000000n, currentUfExposure: 4000000n, requestedAmount: createLoanAmount(1000000), uf: createUf("GO"), policy }));'
```

Resultado esperado:

```text
{
  approved: true,
  projectedTotalExposure: 9000000n,
  projectedUfExposure: 5000000n,
  bootstrapUfLimit: 5000000n
}
```

O teto de R$ 50.000,00 resulta dos 25% definidos pela política futura sobre seu limiar de R$ 200.000,00. Isso evidencia que o cálculo não contém os percentuais da política inicial fixados no código.

### Transição para fora do bootstrap

```bash
node --input-type=module -e 'import { decideDuringBootstrap } from "./dist/domain/bootstrap-loan-decision.js"; import { INITIAL_CONCENTRATION_POLICY } from "./dist/domain/concentration-policy.js"; import { createLoanAmount, createUf } from "./dist/domain/loan-decision-input.js"; console.log(decideDuringBootstrap({ currentTotalExposure: 9000000n, currentUfExposure: 0n, requestedAmount: createLoanAmount(1000000), uf: createUf("SP"), policy: INITIAL_CONCENTRATION_POLICY }));'
```

Resultado esperado:

```text
null
```

O total projetado chega exatamente a R$ 100.000,00. Conforme a PRD, essa solicitação já deve seguir a regra percentual, que será implementada na Tarefa 5. Nesta tarefa, `null` significa apenas que a decisão não pertence ao fluxo de bootstrap; não significa aprovação nem negativa.

### Verificação automatizada complementar

Execute a especificação completa da Tarefa 4:

```bash
npm test -- src/domain/bootstrap-loan-decision.test.ts
```

O arquivo deve executar 6 casos com sucesso.

Para verificar também as tarefas anteriores e o projeto:

```bash
npm test
npm run typecheck
npm run build
```

Todos os comandos devem terminar com sucesso.

### Por que a Tarefa 4 não está no Postman

Esta tarefa implementa uma função pura do domínio e ainda não expõe a decisão por HTTP. O endpoint `POST /loan-decisions` está previsto para a Tarefa 13. Até lá, adicionar uma requisição Postman exigiria criar uma rota inexistente ou antecipar o plano.

Os comandos acima comprovam o cálculo e o limite do bootstrap, mas não comprovam persistência, atomicidade, idempotência, concorrência ou contrato HTTP, que pertencem a tarefas posteriores.

## Tarefa 5 — Implementar a regra percentual

### Objetivo verificável

Confirmar diretamente no domínio que:

- bootstrap e regra percentual são selecionados pelo total projetado;
- a solicitação que faz a carteira atingir R$ 100.000,00 já usa a regra percentual;
- concentrações abaixo e exatamente no limite são aprovadas, enquanto valores acima são negados;
- o limite específico de SP e o limite padrão das demais UFs vêm da política;
- a comparação permanece exata para números maiores que `Number.MAX_SAFE_INTEGER`;
- snapshots de exposição impossíveis são rejeitados.

Todos os valores monetários abaixo estão em centavos e são processados como `bigint`.

### Transição exata para a regra percentual

Depois de executar `npm run build`:

```bash
node --input-type=module -e 'import { decideLoan } from "./dist/domain/loan-decision.js"; import { INITIAL_CONCENTRATION_POLICY } from "./dist/domain/concentration-policy.js"; import { createLoanAmount, createUf } from "./dist/domain/loan-decision-input.js"; console.log(decideLoan({ currentTotalExposure: 9000000n, currentUfExposure: 0n, requestedAmount: createLoanAmount(1000000), uf: createUf("GO"), policy: INITIAL_CONCENTRATION_POLICY }));'
```

Resultado esperado:

```text
{
  approved: true,
  appliedRule: 'PERCENTAGE',
  projectedTotalExposure: 10000000n,
  projectedUfExposure: 1000000n
}
```

O total projetado atinge exatamente R$ 100.000,00 e GO fica exatamente em 10%. A evidência principal é `appliedRule: 'PERCENTAGE'`.

### Limite padrão abaixo, exatamente no limite e acima

```bash
node --input-type=module -e 'import { decideLoan } from "./dist/domain/loan-decision.js"; import { INITIAL_CONCENTRATION_POLICY } from "./dist/domain/concentration-policy.js"; import { createLoanAmount, createUf } from "./dist/domain/loan-decision-input.js"; for (const [scenario, currentUfExposure] of [["below", 900000n], ["exactly", 1000000n], ["above", 1000001n]]) { const result = decideLoan({ currentTotalExposure: 19000000n, currentUfExposure, requestedAmount: createLoanAmount(1000000), uf: createUf("GO"), policy: INITIAL_CONCENTRATION_POLICY }); console.log(scenario, result.approved, result.appliedRule, result.projectedUfExposure); }'
```

Resultado esperado:

```text
below true PERCENTAGE 1900000n
exactly true PERCENTAGE 2000000n
above false PERCENTAGE 2000001n
```

Com total projetado de R$ 200.000,00, o limite padrão de 10% corresponde a R$ 20.000,00.

### Limite específico de SP

```bash
node --input-type=module -e 'import { decideLoan } from "./dist/domain/loan-decision.js"; import { INITIAL_CONCENTRATION_POLICY } from "./dist/domain/concentration-policy.js"; import { createLoanAmount, createUf } from "./dist/domain/loan-decision-input.js"; for (const [scenario, currentUfExposure] of [["exactly", 3000000n], ["above", 3000001n]]) { const result = decideLoan({ currentTotalExposure: 19000000n, currentUfExposure, requestedAmount: createLoanAmount(1000000), uf: createUf("SP"), policy: INITIAL_CONCENTRATION_POLICY }); console.log(scenario, result.approved, result.projectedUfExposure); }'
```

Resultado esperado:

```text
exactly true 4000000n
above false 4000001n
```

Com total projetado de R$ 200.000,00, o limite específico de 20% de SP corresponde a R$ 40.000,00.

### Aritmética exata acima do limite seguro de `number`

```bash
node --input-type=module -e 'import { decideLoan } from "./dist/domain/loan-decision.js"; import { INITIAL_CONCENTRATION_POLICY } from "./dist/domain/concentration-policy.js"; import { createLoanAmount, createUf } from "./dist/domain/loan-decision-input.js"; const hugeExposure = 10n ** 100n; console.log(decideLoan({ currentTotalExposure: hugeExposure * 10n, currentUfExposure: hugeExposure, requestedAmount: createLoanAmount(1), uf: createUf("GO"), policy: INITIAL_CONCENTRATION_POLICY }));'
```

Resultado esperado:

- `approved: false`;
- `appliedRule: 'PERCENTAGE'`;
- exposições projetadas impressas como `bigint`, sem `Infinity`, arredondamento ou exceção de overflow.

A negativa está correta porque a exposição de GO, que estava em 10%, aumenta um centavo enquanto o total aumenta apenas um centavo. A implementação compara produtos inteiros, sem efetuar divisão.

### Snapshot de exposição inválido

```bash
node --input-type=module -e 'import { decideLoan } from "./dist/domain/loan-decision.js"; import { INITIAL_CONCENTRATION_POLICY } from "./dist/domain/concentration-policy.js"; import { createLoanAmount, createUf } from "./dist/domain/loan-decision-input.js"; try { decideLoan({ currentTotalExposure: 1n, currentUfExposure: 2n, requestedAmount: createLoanAmount(1), uf: createUf("GO"), policy: INITIAL_CONCENTRATION_POLICY }); } catch (error) { console.log(error.name, error.message); }'
```

Resultado esperado:

```text
InvalidExposureSnapshotError exposures must be non-negative and UF exposure cannot exceed total exposure
```

Também são inválidas exposições total ou da UF negativas.

### Verificação automatizada complementar

Execute a especificação completa da Tarefa 5:

```bash
npm test -- src/domain/loan-decision.test.ts
```

O arquivo deve executar 12 casos com sucesso.

Para verificar todo o projeto:

```bash
npm test
npm run typecheck
npm run build
```

Todos os comandos devem terminar com sucesso.

### Por que a Tarefa 5 não está no Postman

A decisão completa de concentração ainda é uma função pura do domínio. O endpoint `POST /loan-decisions` somente será exposto na Tarefa 13. A coleção Postman continua apenas com o health check para não representar uma interface HTTP inexistente.

Estes testes comprovam o resultado determinístico da regra, mas ainda não comprovam persistência, atomicidade, idempotência, concorrência ou serialização HTTP.

## Tarefa 6 — Definir o resultado lógico da decisão

### Objetivo verificável

Confirmar diretamente no domínio que:

- uma aprovação usa `APPROVED` e a mensagem exata definida na PRD;
- uma negativa usa `DENIED` e sua mensagem exata;
- a versão da política permanece no resultado interno;
- uma decisão aprovada ainda não avaliada como persistida não possui `loanId`;
- o identificador somente é anexado depois do passo explícito de persistência;
- a saída pública não expõe a versão da política;
- a negativa pública não contém identificador de empréstimo.

### Resultados internos de aprovação e negativa

Depois de executar `npm run build`:

```bash
node --input-type=module -e 'import { createLoanDecisionResult } from "./dist/domain/loan-decision-result.js"; const base = { appliedRule: "BOOTSTRAP", projectedTotalExposure: 1000000n, projectedUfExposure: 1000000n }; const approved = createLoanDecisionResult({ ...base, approved: true }, "policy-version-1"); const denied = createLoanDecisionResult({ ...base, approved: false }, "policy-version-2"); console.log("approved", approved); console.log("denied", denied); console.log("approvedHasLoanId", Object.hasOwn(approved, "loanId")); console.log("deniedHasLoanId", Object.hasOwn(denied, "loanId"));'
```

Resultado esperado:

```text
approved {
  decision: 'APPROVED',
  message: 'O valor solicitado foi aprovado.',
  policyVersion: 'policy-version-1'
}
denied {
  decision: 'DENIED',
  message: 'O empréstimo foi negado.',
  policyVersion: 'policy-version-2'
}
approvedHasLoanId false
deniedHasLoanId false
```

A formatação do objeto pode variar entre versões do Node.js. Os campos, valores e indicadores booleanos devem ser exatamente os demonstrados.

### Aprovação após persistência e saída pública

```bash
node --input-type=module -e 'import { attachPersistedLoanId, createLoanDecisionResult, toPublicLoanDecisionResult } from "./dist/domain/loan-decision-result.js"; const evaluated = createLoanDecisionResult({ approved: true, appliedRule: "BOOTSTRAP", projectedTotalExposure: 1000000n, projectedUfExposure: 1000000n }, "policy-version-1"); const persisted = attachPersistedLoanId(evaluated, "loan-123"); console.log("persisted", persisted); console.log("public", toPublicLoanDecisionResult(persisted));'
```

Resultado esperado:

```text
persisted {
  decision: 'APPROVED',
  message: 'O valor solicitado foi aprovado.',
  policyVersion: 'policy-version-1',
  loanId: 'loan-123'
}
public {
  decision: 'APPROVED',
  message: 'O valor solicitado foi aprovado.',
  loan_id: 'loan-123'
}
```

A evidência principal é que `policyVersion` existe internamente, mas não aparece na saída pública. O campo público usa `loan_id`, conforme a PRD.

Este passo apenas demonstra o contrato lógico que será usado depois da persistência. A Tarefa 6 ainda não grava empréstimos no banco.

### Negativa pública

```bash
node --input-type=module -e 'import { createLoanDecisionResult, toPublicLoanDecisionResult } from "./dist/domain/loan-decision-result.js"; const denied = createLoanDecisionResult({ approved: false, appliedRule: "PERCENTAGE", projectedTotalExposure: 20000000n, projectedUfExposure: 2000001n }, "policy-version-2"); const result = toPublicLoanDecisionResult(denied); console.log(result); console.log({ hasPolicyVersion: Object.hasOwn(result, "policyVersion"), hasPolicyVersionSnakeCase: Object.hasOwn(result, "policy_version"), hasLoanId: Object.hasOwn(result, "loan_id") });'
```

Resultado esperado:

```text
{ decision: 'DENIED', message: 'O empréstimo foi negado.' }
{
  hasPolicyVersion: false,
  hasPolicyVersionSnakeCase: false,
  hasLoanId: false
}
```

A negativa não deve expor versão da política nem identificador de empréstimo.

### Verificação automatizada complementar

Execute a especificação completa da Tarefa 6:

```bash
npm test -- src/domain/loan-decision-result.test.ts
```

O arquivo deve executar 4 casos com sucesso.

Para verificar todo o projeto:

```bash
npm test
npm run typecheck
npm run build
```

Todos os comandos devem terminar com sucesso.

### Por que a Tarefa 6 não está no Postman

A tarefa define contratos lógicos e a serialização pública no domínio, mas ainda não conecta esse comportamento ao Express. O endpoint `POST /loan-decisions` será exposto na Tarefa 13. Inserir uma requisição Postman agora representaria uma rota inexistente.

Os comandos acima comprovam mensagens, campos e separação entre resultado interno e público. Eles não comprovam persistência real, contrato HTTP, idempotência ou atomicidade.

## Tarefa 7 — Preparar PostgreSQL e testes de integração

### Objetivo verificável

Confirmar que o harness de integração:

- inicia um PostgreSQL 17 descartável por Testcontainers;
- aceita conexões feitas pelo pool de `pg`;
- limpa o schema público entre os testes;
- aplica migrations em um banco vazio;
- não reaplica uma migration já registrada;
- desfaz toda a transação quando uma migration falha;
- encerra o pool e o container ao terminar.

### Pré-requisitos

Além dos requisitos comuns, esta tarefa exige:

- Docker Desktop ou Docker Engine em execução;
- permissão para o usuário atual acessar o daemon do Docker;
- acesso inicial à imagem `postgres:17`, caso ainda não esteja armazenada localmente.

Confirme o daemon:

```bash
docker info >/dev/null && echo "Docker disponível"
```

Resultado esperado:

```text
Docker disponível
```

Se o comando falhar, inicie o Docker antes de continuar. Uma falha de daemon não representa defeito na Tarefa 7.

Depois de um clone limpo, instale as dependências:

```bash
npm ci
```

O comando deve terminar com exit code `0` e não deve modificar `package-lock.json`.

### Executar o harness de integração

Registre os containers PostgreSQL 17 existentes, execute somente a especificação da Tarefa 7 e confirme que nenhum container adicional permaneceu:

```bash
before="$(docker ps -q --filter ancestor=postgres:17 | sort)"; npm test -- src/test-support/postgres-test-harness.test.ts --reporter=verbose; test_exit_code=$?; after="$(docker ps -q --filter ancestor=postgres:17 | sort)"; if [ "$before" != "$after" ]; then echo "FAIL: a lista de containers postgres:17 mudou"; docker ps --filter ancestor=postgres:17; exit 1; fi; exit "$test_exit_code"
```

Na primeira execução, o download da imagem pode tornar o teste mais demorado.

Resultado esperado:

- exit code `0`;
- uma suíte aprovada;
- 4 testes aprovados;
- nenhuma falha;
- os seguintes cenários reportados como aprovados:

```text
starts a disposable PostgreSQL and accepts connections
resets the database to an empty schema between tests
applies migrations to an empty database and reapplies them safely
rolls back every migration change when a migration fails
```

O comando compara os IDs de containers `postgres:17` antes e depois. Se já existia um container dessa imagem, ele deve continuar existindo; o teste somente não pode deixar um container adicional.

### Evidências verificadas pela suíte

O terceiro cenário aplica as migrations duas vezes e exige:

- existência de `migration_probe`;
- exatamente uma linha em `schema_migrations`.

Isso comprova a reaplicação segura segundo a estratégia versionada atual.

O quarto cenário executa uma migration válida seguida de SQL inválido e exige que, após o rollback:

- `schema_migrations` não exista;
- `should_rollback` não exista.

Isso comprova o rollback transacional do lote de migrations.

A limpeza entre testes é feita recriando o schema `public`. O teste que conta as tabelas exige zero tabelas no início do cenário.

### Verificação completa do projeto

```bash
npm test
npm run typecheck
npm run build
```

Todos os comandos devem terminar com exit code `0`. A suíte completa também precisa de Docker porque agora inclui o teste de integração.

Para confirmar que o harness de testes não foi incluído no artefato de produção:

```bash
test ! -e dist/test-support/postgres-test-harness.js && echo "Harness ausente do build de produção"
```

Resultado esperado:

```text
Harness ausente do build de produção
```

Execute essa última verificação após `npm run build`.

### Limpeza segura

O teste chama `harness.stop()` no `afterAll`, encerrando o pool e o container. Se a execução for interrompida abruptamente, confira:

```bash
docker ps --filter ancestor=postgres:17
```

Não remova containers automaticamente. Compare com os containers que já existiam antes do teste e interrompa somente um container comprovadamente criado por esta execução.

### Por que a Tarefa 7 não está no Postman

Esta tarefa adiciona infraestrutura de banco e uma suíte de integração, mas nenhum comportamento HTTP. A coleção Postman continua somente com o health check. Criar uma rota para migrations ou para o harness exporia uma superfície técnica indevida.

Os cenários acima comprovam conexão, migrations, rollback, isolamento e descarte do PostgreSQL de testes. Eles ainda não comprovam persistência de políticas ou empréstimos, que pertencem às tarefas seguintes.

## Tarefa 8 — Persistir e consultar a política vigente

### Objetivo verificável

Confirmar no PostgreSQL descartável que:

- as migrations criam as tabelas e constraints da política;
- a versão inicial ativa é semeada com bootstrap de R$ 100.000,00;
- o limite padrão é 10% e a exceção de SP é 20%;
- uma nova versão ativa substitui a anterior e seus percentuais são reconstruídos no domínio;
- a ausência de política ativa produz erro técnico explícito;
- dados persistidos que não formam uma política de domínio válida produzem erro técnico explícito;
- o banco impede mais de uma política ativa;
- o banco rejeita percentuais persistidos fora do intervalo permitido.

### Pré-requisitos

Esta tarefa usa o mesmo PostgreSQL 17 descartável da Tarefa 7. Confirme que o Docker está disponível:

```bash
docker info >/dev/null && echo "Docker disponível"
```

Resultado esperado:

```text
Docker disponível
```

Depois de um clone limpo:

```bash
npm ci
```

O comando deve terminar com exit code `0` sem modificar `package-lock.json`.

### Executar a integração da política vigente

Registre os containers existentes, execute a especificação da Tarefa 8 e confirme que nenhum PostgreSQL adicional permaneceu:

```bash
before="$(docker ps -q --filter ancestor=postgres:17 | sort)"; npm test -- src/infrastructure/database/postgres-concentration-policy-repository.test.ts --reporter=verbose; test_exit_code=$?; after="$(docker ps -q --filter ancestor=postgres:17 | sort)"; if [ "$before" != "$after" ]; then echo "FAIL: a lista de containers postgres:17 mudou"; docker ps --filter ancestor=postgres:17; exit 1; fi; exit "$test_exit_code"
```

Resultado esperado:

- exit code `0`;
- uma suíte aprovada;
- 6 testes aprovados;
- nenhuma falha;
- os seguintes cenários reportados como aprovados:

```text
loads the seeded initial active policy
loads a new active version with its default and state-specific limits
reports explicitly when no active policy exists
reports explicitly when stored policy data cannot form a domain policy
prevents more than one policy from being active
rejects invalid persisted percentages
```

A comparação dos IDs de containers preserva qualquer PostgreSQL 17 que já estivesse ativo e detecta somente a permanência de um container adicional.

### Evidências da política inicial

O primeiro cenário exige que a política reconstruída apresente:

```text
version = 1
minimumPortfolioForPercentageRule = 10000000n
GO = 1000 pontos-base
SP = 2000 pontos-base
```

Isso corresponde a:

- R$ 100.000,00 como limiar de bootstrap;
- 10% como limite padrão, observado por GO;
- 20% como limite específico de SP.

Esses valores devem vir dos registros semeados pelas migrations, não de constantes aplicadas pelo repositório.

### Evidências de uma nova versão

O segundo cenário desativa a versão `1`, persiste a versão `2` como ativa e exige:

```text
version = 2
minimumPortfolioForPercentageRule = 20000000n
GO = 2500 pontos-base
SP = 3000 pontos-base
```

O resultado comprova a leitura de outra versão, o fallback de GO para o limite padrão de 25% e a exceção de 30% para SP.

### Evidências de falha técnica e integridade

A especificação exige os seguintes comportamentos:

- nenhuma política ativa: `ActiveConcentrationPolicyNotFoundError`;
- política armazenada incompatível com o domínio: `InvalidStoredConcentrationPolicyError`;
- tentativa de manter duas políticas ativas: PostgreSQL SQLSTATE `23505`, violação de unicidade;
- percentual `10001` persistido para uma UF: PostgreSQL SQLSTATE `23514`, violação de check constraint.

Esses erros são técnicos e não representam uma negativa de empréstimo.

### Verificar as migrations acumuladas

A especificação do harness da Tarefa 7 foi ajustada para aceitar a quantidade atual de migrations. Execute-a novamente:

```bash
npm test -- src/test-support/postgres-test-harness.test.ts --reporter=verbose
```

Resultado esperado:

- 4 testes aprovados;
- aplicação e reaplicação segura de todas as migrations atuais;
- rollback integral preservado.

### Verificação completa do projeto

```bash
npm test
npm run typecheck
npm run build
```

Todos os comandos devem terminar com exit code `0`. A suíte completa requer Docker.

Após o build, confirme que o suporte de testes continua fora do artefato de produção:

```bash
test ! -e dist/test-support/postgres-test-harness.js && echo "Harness ausente do build de produção"
```

Resultado esperado:

```text
Harness ausente do build de produção
```

### Limpeza segura

Os testes recriam o schema `public` antes de cada cenário e encerram pool e container no `afterAll`. Se uma execução for interrompida abruptamente, liste os containers:

```bash
docker ps --filter ancestor=postgres:17
```

Não interrompa containers preexistentes. Remova somente um container comprovadamente criado pela execução interrompida.

### Por que a Tarefa 8 não está no Postman

A política vigente é uma dependência interna da decisão e não possui endpoint administrativo ou público. A coleção Postman continua apenas com o health check. Expor leitura ou edição de políticas por HTTP anteciparia uma interface fora do plano.

Os testes acima comprovam schema, seed, constraints, leitura e reconstrução da política. Eles ainda não comprovam a transação de criação do empréstimo nem o contrato HTTP.

## Tarefa 9 — Consultar e bloquear os agregados de exposição

### Objetivo verificável

Confirmar no PostgreSQL descartável que:

- o agregado total da carteira existe desde a migration com exposição zero;
- a linha de uma UF ainda inexistente é criada ao ser bloqueada;
- o agregado TOTAL é bloqueado antes do agregado da UF;
- total e UF são lidos e atualizados dentro da mesma transação;
- um rollback desfaz tanto a criação da UF quanto as alterações de exposição;
- o teste não deixa um container PostgreSQL adicional em execução.

### Pré-requisitos

Esta tarefa usa o PostgreSQL 17 descartável preparado na Tarefa 7. Confirme que o Docker está disponível:

~~~bash
docker info >/dev/null && echo "Docker disponível"
~~~

Resultado esperado:

~~~text
Docker disponível
~~~

Depois de um clone limpo:

~~~bash
npm ci
~~~

O comando deve terminar com exit code 0 sem modificar package-lock.json.

### Executar a integração dos agregados de exposição

Registre os containers existentes, execute somente a especificação da Tarefa 9 e confirme que nenhum PostgreSQL adicional permaneceu:

~~~bash
before="$(docker ps -q --filter ancestor=postgres:17 | sort)"; npm test -- src/infrastructure/database/postgres-exposure-repository.test.ts --reporter=verbose; test_exit_code=$?; after="$(docker ps -q --filter ancestor=postgres:17 | sort)"; if [ "$before" != "$after" ]; then echo "FAIL: a lista de containers postgres:17 mudou"; docker ps --filter ancestor=postgres:17; exit 1; fi; exit "$test_exit_code"
~~~

Resultado esperado:

- exit code 0;
- uma suíte aprovada;
- 4 testes aprovados;
- nenhuma falha;
- os seguintes cenários reportados como aprovados:

~~~text
locks an empty portfolio and creates the missing UF aggregate
reads and updates TOTAL and UF in the same transaction
rolls back aggregate creation and updates without residual changes
acquires the TOTAL lock before any UF lock
~~~

A comparação dos IDs de containers preserva qualquer PostgreSQL 17 que já estivesse ativo e detecta somente a permanência de um container adicional.

### Evidências da carteira vazia

O primeiro cenário bloqueia GO em uma carteira recém-criada e exige os seguintes registros após o commit:

~~~text
GO = 0
TOTAL = 0
~~~

A linha de TOTAL vem do seed da migration. A linha de GO é criada pelo repositório quando a UF ainda não existe.

### Evidências da atualização atômica

O segundo cenário atualiza os dois agregados sob os locks da mesma transação e, em seguida, exige a releitura deste snapshot:

~~~text
totalExposure = 1500n
ufExposure = 500n
~~~

A atualização precisa afetar exatamente as linhas de TOTAL e da UF bloqueada. A ausência de qualquer uma delas produz erro técnico explícito em vez de uma atualização parcial silenciosa.

### Evidências do rollback

O terceiro cenário cria e atualiza o agregado de SP, mas encerra a transação com rollback. Ao consultar o banco depois disso, a especificação exige somente:

~~~text
TOTAL = 0
~~~

A linha de SP não pode permanecer e o valor total não pode ser alterado. Isso comprova que a criação sob demanda da UF e a atualização dos agregados participam da mesma transação.

### Evidências da ordem dos locks

O quarto cenário mantém uma transação com os locks de TOTAL e GO. Enquanto ela está aberta, uma segunda transação tenta bloquear SP com lock_timeout de 100 ms.

Resultado esperado para a segunda transação:

~~~text
PostgreSQL SQLSTATE 55P03
~~~

Embora as UFs sejam diferentes, a segunda transação deve aguardar porque ambas tentam bloquear TOTAL primeiro. O timeout comprova a ordem determinística TOTAL → UF, reduzindo o risco de deadlock entre decisões concorrentes.

Este cenário valida o protocolo de locks do repositório. A garantia concorrente do fluxo completo de decisão, incluindo impedir duas aprovações incompatíveis, pertence à Tarefa 14.

### Verificação completa do projeto

~~~bash
npm test
npm run typecheck
npm run build
~~~

Todos os comandos devem terminar com exit code 0. A suíte completa requer Docker.

Após o build, confirme que o suporte de testes continua fora do artefato de produção:

~~~bash
test ! -e dist/test-support/postgres-test-harness.js && echo "Harness ausente do build de produção"
~~~

Resultado esperado:

~~~text
Harness ausente do build de produção
~~~

### Limpeza segura

Os testes recriam o schema public antes de cada cenário e encerram pool e container no afterAll. Se uma execução for interrompida abruptamente, liste os containers:

~~~bash
docker ps --filter ancestor=postgres:17
~~~

Não interrompa containers preexistentes. Remova somente um container comprovadamente criado pela execução interrompida.

### Por que a Tarefa 9 não está no Postman

A tarefa implementa persistência e locks internos, sem acrescentar endpoint HTTP. A coleção Postman continua apenas com o health check. Expor os agregados ou seus locks por uma rota artificial anteciparia uma interface inexistente e revelaria detalhes internos indevidos.

Os testes acima comprovam schema, criação sob demanda, leitura, atualização, rollback e ordem dos locks. Eles ainda não comprovam o fluxo transacional completo da decisão nem o contrato HTTP.

## Tarefa 10 — Persistir uma aprovação atomicamente

### Objetivo verificável

Confirmar no PostgreSQL descartável que:

- uma solicitação aprovada cria exatamente um empréstimo;
- o empréstimo e os agregados de TOTAL e da UF refletem o mesmo valor;
- a versão da política usada na decisão é persistida no empréstimo;
- uma nova política vigente é lida dentro da transação;
- uma falha técnica depois do INSERT desfaz o empréstimo, a criação da UF e as alterações dos agregados;
- o teste não deixa um container PostgreSQL adicional em execução.

### Pré-requisitos

Esta tarefa usa o PostgreSQL 17 descartável preparado na Tarefa 7. Confirme que o Docker está disponível:

~~~bash
docker info >/dev/null && echo "Docker disponível"
~~~

Resultado esperado:

~~~text
Docker disponível
~~~

Depois de um clone limpo:

~~~bash
npm ci
~~~

O comando deve terminar com exit code 0 sem modificar package-lock.json.

### Executar a integração da aprovação atômica

Registre os containers existentes, execute somente a especificação da Tarefa 10 e confirme que nenhum PostgreSQL adicional permaneceu:

~~~bash
before="$(docker ps -q --filter ancestor=postgres:17 | sort)"; npm test -- src/application/persist-approved-loan.test.ts --reporter=verbose; test_exit_code=$?; after="$(docker ps -q --filter ancestor=postgres:17 | sort)"; if [ "$before" != "$after" ]; then echo "FAIL: a lista de containers postgres:17 mudou"; docker ps --filter ancestor=postgres:17; exit 1; fi; exit "$test_exit_code"
~~~

Resultado esperado:

- exit code 0;
- uma suíte aprovada;
- 3 testes aprovados;
- nenhuma falha;
- os seguintes cenários reportados como aprovados:

~~~text
creates one approved loan and updates matching exposures atomically
reads a new active policy inside the transaction and persists its version
rolls back the loan and aggregates when updating exposure fails after insert
~~~

A comparação dos IDs de containers preserva qualquer PostgreSQL 17 que já estivesse ativo e detecta somente a permanência de um container adicional.

### Evidências da aprovação persistida

O primeiro cenário solicita 1.000.000 de unidades monetárias mínimas para GO e exige um resultado interno com:

~~~text
decision = APPROVED
message = O valor solicitado foi aprovado.
policyVersion = 1
loanId = identificador UUID gerado
~~~

Após o commit, a tabela loans deve conter exatamente um registro:

~~~text
borrower_id = borrower-123
uf = GO
amount_minor_units = 1000000
policy_version = 1
~~~

Os agregados devem conter exatamente:

~~~text
GO = 1000000
TOTAL = 1000000
~~~

O mesmo valor no empréstimo, na UF e no total evidencia que a fonte oficial e sua projeção foram persistidas de forma consistente.

### Evidências do versionamento da política

O segundo cenário desativa a política 1 e cria a política 2 como vigente, com limite padrão de 25%. Em seguida, solicita 2.000.000 de unidades monetárias mínimas para GO.

Resultado esperado:

~~~text
resultado interno: policyVersion = 2
loans.policy_version = 2
~~~

Isso comprova que a política vigente é lida durante a operação transacional e que a versão efetivamente aplicada acompanha o empréstimo. A versão permanece interna e ainda não é exposta por HTTP.

### Evidências do rollback integral

O terceiro cenário instala temporariamente um trigger que força uma falha ao atualizar exposure_aggregates. A falha ocorre depois da tentativa de inserir o empréstimo.

Resultado esperado após o rollback:

~~~text
quantidade de loans = 0
TOTAL = 0
linha de GO ausente
~~~

A exceção deve conter a mensagem técnica forçada:

~~~text
forced exposure update failure
~~~

Nenhum empréstimo, agregado de UF ou aumento do total pode sobreviver. Isso comprova que INSERT e atualização dos agregados participam da mesma transação.

### Escopo comprovado e limitação

A suíte comprova atomicidade diante da falha técnica injetada, persistência da versão e consistência entre o empréstimo aprovado e os agregados. Ela não comprova ainda:

- o caminho normal de uma negativa, pertencente à Tarefa 11;
- idempotência, pertencente à Tarefa 12;
- contrato HTTP, pertencente à Tarefa 13;
- segurança sob requisições concorrentes, pertencente à Tarefa 14.

A migration cria constraints e índices para loans, mas esta especificação não exercita individualmente cada violação de constraint nem mede o uso dos índices pelo planejador do PostgreSQL.

### Verificação completa do projeto

~~~bash
npm test
npm run typecheck
npm run build
~~~

Todos os comandos devem terminar com exit code 0. A suíte completa requer Docker.

Após o build, confirme que o suporte de testes continua fora do artefato de produção:

~~~bash
test ! -e dist/test-support/postgres-test-harness.js && echo "Harness ausente do build de produção"
~~~

Resultado esperado:

~~~text
Harness ausente do build de produção
~~~

### Limpeza segura

Os testes recriam o schema public antes de cada cenário e encerram pool e container no afterAll. Se uma execução for interrompida abruptamente, liste os containers:

~~~bash
docker ps --filter ancestor=postgres:17
~~~

Não interrompa containers preexistentes. Remova somente um container comprovadamente criado pela execução interrompida.

### Por que a Tarefa 10 não está no Postman

A aprovação atômica foi implementada como caso de uso da aplicação e transação de infraestrutura, mas ainda não foi conectada a uma rota Express. O endpoint POST /loan-decisions está previsto para a Tarefa 13.

Adicionar uma requisição agora representaria uma interface HTTP inexistente. Os testes manuais desta tarefa são, portanto, executados pela especificação de integração contra um PostgreSQL descartável.

