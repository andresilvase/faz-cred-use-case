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

