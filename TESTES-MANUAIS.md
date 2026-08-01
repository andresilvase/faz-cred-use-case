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

