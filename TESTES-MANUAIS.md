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
