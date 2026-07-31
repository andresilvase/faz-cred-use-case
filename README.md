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

1. [general-flow.excalidraw](diagrams/general-flow.excalidraw) — rascunho inicial do fluxo geral entre usuário, Loan Service e banco de dados.
2. [loan-service.mmd](diagrams/loan-service.mmd) — refinamento do funcionamento interno, com transação, bloqueio dos agregados, cálculo projetado e caminhos de aprovação ou negativa.
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

Nenhuma chamada externa deve acontecer dentro da transação.

## Persistência

| Estrutura | Responsabilidade |
|---|---|
| `loans` | Fonte oficial dos empréstimos aprovados e da exposição |
| `exposure_aggregates` | Projeção reconstruível com linhas para `TOTAL` e para cada UF |
| `state_policies` | Políticas versionadas, bootstrap, limite padrão e exceções por UF |
| `idempotency_requests` | Chave, hash da solicitação, resultado, resposta e versão da política |

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

Uma negativa por concentração é uma resposta de negócio válida e retorna `200 OK`. `policy_version` é persistida internamente, mas não é retornada ao cliente.

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

- Node.js 24;
- npm.

### Instalação

```bash
npm ci
```

### Desenvolvimento

`PORT` é obrigatória e deve ser fornecida ao processo:

```bash
PORT=3000 npm run dev
```

Verifique o serviço em `http://localhost:3000/health`.

### Build e execução

```bash
npm run build
PORT=3000 npm start
```

### Testes e verificações

```bash
npm test
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
- credenciais fora do código;
- TLS e usuário de banco com menor privilégio;
- logs com `correlation_id`, rota, método, status e duração;
- nenhum token, segredo, payload completo ou dado pessoal completo nos logs;
- stack trace apenas no ambiente apropriado.

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
- os prazos de retenção de idempotência e logs permanecem em aberto na PRD 0.8.

## Decisões e trade-offs

- **Agregados de exposição:** melhoram eficiência e coordenação concorrente, ao custo de uma projeção adicional que precisa ser atualizada atomicamente e permanecer reconstruível.
- **Locks pessimistas:** priorizam consistência da política de concentração, podendo elevar a contenção sob carga intensa.
- **Políticas versionadas:** permitem alterar percentuais sem mudar a lógica, ao custo de persistência e validação adicionais.
- **Bootstrap explícito:** torna possível formar a carteira inicial, mas é uma premissa de produto adicionada porque o case não define esse cenário.
- **Implementação incremental com TDD:** reduz o escopo de cada mudança e mantém commits reversíveis, mas adia o primeiro fluxo HTTP completo até as dependências estarem prontas.
