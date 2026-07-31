# PRD — Loan Decision

**Versão:** 0.8  
**Status:** Definição funcional do primeiro incremento  
**Serviço:** Loan Decision  
**Linguagem:** TypeScript  
**Runtime:** Node.js 24  
**Estratégia:** TDD, começando pelos testes

## 1. Resumo

O **Loan Decision** avalia uma solicitação de empréstimo segundo uma política de concentração geográfica. Quando aprova, cria o empréstimo e atualiza a exposição correspondente de maneira atômica.

O serviço **não libera ou transfere dinheiro** neste incremento.

Depois do bootstrap, cada UF deve respeitar o percentual definido na política vigente. A política inicial configura 10% como limite padrão e 20% para São Paulo.

## 2. Objetivo

Impedir concentração geográfica excessiva e garantir decisões consistentes mesmo quando várias solicitações forem processadas simultaneamente.

O primeiro incremento deve:

- decidir se o valor solicitado pode ser aprovado;
- criar e persistir o empréstimo quando houver aprovação;
- atualizar a exposição total e da UF quando houver aprovação;
- impedir duplicidade provocada por retries;
- impedir que decisões concorrentes ultrapassem os limites;
- persistir internamente a versão da política utilizada;
- produzir logs técnicos mínimos para diagnóstico.

## 3. Escopo

### 3.1 Incluído

- Receber solicitação de usuário já autenticado e autorizado.
- Validar UF, valor e chave de idempotência.
- Aplicar a premissa de bootstrap ou a regra percentual.
- Aprovar ou negar a solicitação.
- Criar e persistir o empréstimo somente quando houver aprovação.
- Atualizar atomicamente a exposição total e o agregado da UF.
- Persistir a versão da política aplicada.
- Produzir logs técnicos mínimos de execução e erro.

### 3.2 Fora do escopo

- Autenticação e autorização.
- Liberação, transferência ou desembolso do valor aprovado.
- Integração com banco, Pix, parceiro ou agente externo.
- Quitação, cancelamento, reversão ou redução posterior da exposição.
- Consumo ou publicação de eventos.
- Análise de crédito, fraude, renda, score ou capacidade de pagamento.
- Cobrança, parcelamento e renegociação.
- Comunicação com o cliente.
- Auditoria de negócio, métricas e dashboards.
- Interface de usuário ou painel administrativo.

### 3.3 Premissas e limitações conhecidas

- O case não define como formar uma carteira partindo de zero. A aplicação literal dos percentuais impediria o primeiro empréstimo, pois ele representaria 100% da carteira. Por isso, este incremento adota explicitamente a premissa de bootstrap descrita na seção 5.2.
- Somente empréstimos aprovados são registrados em `loans`; uma negativa não cria empréstimo.
- O valor total emprestado corresponde à soma de todos os empréstimos registrados.
- Quitação, cancelamento e redução da exposição não fazem parte deste incremento. Consequentemente, o total acumulado somente cresce.
- Idempotência, controle de concorrência, agregados e versionamento de políticas são garantias técnicas adicionais adotadas para robustez e evolução da solução.

## 4. Definições

| Termo | Definição |
|---|---|
| Exposição da UF | Soma dos valores dos empréstimos registrados naquela UF. |
| Exposição total | Soma dos valores de todos os empréstimos registrados. |
| Total projetado | Exposição total atual somada ao valor solicitado. |
| Exposição projetada da UF | Exposição atual da UF somada ao valor solicitado. |
| Bootstrap | Fase em que o total projetado é inferior a R$ 100.000. |
| Política vigente | Conjunto versionado de parâmetros e limites utilizado na decisão. |
| Limite aplicável da UF | Percentual obtido da política vigente para a UF solicitada, considerando eventual limite específico ou o limite padrão. |
| Agregado de exposição | Projeção derivada e reconstruível, usada para consultar e bloquear o total e a UF eficientemente. |

## 5. Regras de negócio

### 5.1 Cálculo projetado

```text
total_projetado = total_atual + valor_solicitado
uf_projetada = uf_atual + valor_solicitado
```

A seleção da regra deve considerar o cenário **depois** da possível aprovação.

### 5.2 Bootstrap

O limiar do bootstrap é:

```text
minimum_portfolio_for_percentage_rule = R$ 100.000
```

Se:

```text
total_projetado < R$ 100.000
```

o limite absoluto da UF será calculado a partir do percentual definido na política vigente:

```text
limite_absoluto_da_uf = percentual_aplicavel_da_uf * minimum_portfolio_for_percentage_rule
```

A política inicial será configurada da seguinte forma:

| Regra da política inicial | Percentual | Limite durante o bootstrap |
|---|---:|---:|
| Limite específico de SP | 20% | R$ 20.000 |
| Limite padrão | 10% | R$ 10.000 |

A tabela acima representa dados da versão inicial da política e não constantes codificadas no domínio. A solicitação será aprovada durante o bootstrap somente quando:

```text
uf_projetada <= limite_absoluto_da_uf
```

### 5.3 Regra percentual

Se:

```text
total_projetado >= R$ 100.000
```

deve ser aplicada a regra:

```text
concentracao_projetada = uf_projetada / total_projetado
```

A solicitação será aprovada somente quando:

```text
concentracao_projetada <= percentual_aplicavel_da_uf
```

O percentual aplicável deve ser lido da política vigente. A versão inicial usa 20% para SP e 10% como limite padrão para as demais UFs, mas a lógica de decisão não deve conter esses valores fixos.

A solicitação que fizer o total atingir ou ultrapassar R$ 100.000 já deve obedecer à regra percentual.

### 5.4 Efeitos da decisão

- Se negada, nenhum empréstimo deve ser criado e os agregados não podem ser alterados.
- Se aprovada, o empréstimo, os agregados e a resposta idempotente devem ser persistidos em uma única transação.
- Cada decisão deve persistir internamente a versão da política aplicada.
- A versão da política não deve ser retornada à ponta chamadora.

`loans` é a fonte oficial da exposição. `exposure_aggregates` é uma projeção derivada e reconstruível, atualizada atomicamente para permitir consultas e bloqueios eficientes.

## 6. Fluxo principal

1. Receber identificador do solicitante, UF, valor e chave de idempotência.
2. Validar a solicitação.
3. Consultar a chave de idempotência.
4. Iniciar uma transação no PostgreSQL.
5. Bloquear consistentemente os agregados `TOTAL` e da UF.
6. Ler a política vigente e resolver o percentual aplicável à UF, usando seu limite específico ou o limite padrão.
7. Calcular o total e a exposição projetados.
8. Aplicar a regra de bootstrap ou a regra percentual.
9. Se negada, persistir a resposta idempotente e a versão da política sem criar empréstimo nem alterar os agregados.
10. Se aprovada, criar o empréstimo e persistir os agregados atualizados, a versão da política e a resposta idempotente no mesmo commit.
11. Retornar `decision` e `message`, além do identificador persistido aplicável.

## 7. Idempotência

A chave de idempotência é metadado da requisição e deve ser criada pelo componente que inicia a operação.

```http
Idempotency-Key: <identificador único>
```

Regras:

- retries da mesma intenção devem reutilizar a mesma chave;
- uma nova intenção deve utilizar uma nova chave;
- mesma chave e mesmo payload devem retornar o resultado persistido;
- mesma chave e payload diferente devem produzir conflito;
- a unicidade deve considerar o solicitante e a chave;
- o registro idempotente deve participar da mesma transação da decisão;
- uma repetição não pode criar um segundo empréstimo.

A idempotência protege contra duplicidade causada por retries. Ela não impede duas solicitações intencionais distintas.

## 8. Contratos lógicos

### 8.1 Requisição HTTP

```http
POST /loan-decisions
Content-Type: application/json
Idempotency-Key: <identificador único>
```

| Campo | Descrição |
|---|---|
| `borrower_id` | Identificador do solicitante já autorizado. |
| `uf` | Código da unidade federativa. |
| `amount` | Valor solicitado em unidade monetária mínima. |

`idempotency_key` não compõe o corpo: deve ser enviado no header `Idempotency-Key`.

### 8.2 Saída mínima

| Campo | Descrição |
|---|---|
| `decision` | `APPROVED` ou `DENIED`. |
| `message` | Mensagem correspondente à decisão. |
| `loan_id` | Identificador persistido, retornado quando aprovado. |

Resposta lógica de aprovação:

```json
{
  "decision": "APPROVED",
  "message": "O valor solicitado foi aprovado.",
  "loan_id": "<identificador>"
}
```

Resposta lógica de negativa:

```json
{
  "decision": "DENIED",
  "message": "O empréstimo foi negado."
}
```

`policy_version` deve ser persistida internamente, mas não deve compor a resposta.

### 8.3 Códigos HTTP

| Código | Uso |
|---:|---|
| `200 OK` | Solicitação válida processada, com decisão `APPROVED` ou `DENIED`. |
| `400 Bad Request` | UF, valor, header ou corpo inválido. |
| `409 Conflict` | Mesma chave de idempotência reutilizada com payload diferente. |
| `500 Internal Server Error` | Falha inesperada ou impossibilidade de concluir a transação. |

Uma negativa por regra de concentração é um resultado válido de negócio e deve retornar `200 OK`, não um código de erro.

## 9. Persistência mínima

| Estrutura | Responsabilidade |
|---|---|
| `loans` | Fonte oficial dos empréstimos aprovados: identificador, solicitante, UF, valor e versão da política. |
| `exposure_aggregates` | Projeção derivada com linhas `TOTAL` e por UF, usada para decisão concorrente eficiente. |
| `state_policies` | Versões das políticas, limite percentual padrão, limites específicos por UF e parâmetros de bootstrap. |
| `idempotency_requests` | Chave, hash da solicitação, resultado, resposta e versão da política. |

Os nomes físicos das tabelas podem mudar durante o desenho técnico, desde que as responsabilidades permaneçam.

Os agregados não substituem `loans` como fonte oficial e devem poder ser reconstruídos a partir dos empréstimos persistidos.

## 10. Requisitos funcionais

- **RF-01:** receber solicitações de usuários previamente autenticados e autorizados.
- **RF-02:** exigir uma chave de idempotência.
- **RF-03:** rejeitar UF inválida e valor ausente, zero ou negativo.
- **RF-04:** consultar a exposição total e da UF consistentemente.
- **RF-05:** selecionar automaticamente a regra aplicável pelo total projetado.
- **RF-06:** retornar `APPROVED` ou `DENIED` acompanhado de `message`.
- **RF-07:** persistir a versão da política sem retorná-la.
- **RF-08:** criar exatamente um empréstimo quando a decisão for aprovada.
- **RF-09:** não criar empréstimo nem alterar os agregados quando a decisão for negada.
- **RF-10:** impedir que solicitações concorrentes ultrapassem os limites.
- **RF-11:** impedir empréstimos duplicados provocados por retries.
- **RF-12:** obter o percentual aplicável da política vigente, sem codificar no domínio os percentuais de SP ou das demais UFs.

## 11. Requisitos não funcionais

- **Consistência:** empréstimo, agregados e resultado idempotente devem ser persistidos atomicamente.
- **Concorrência:** bloqueios e transações devem impedir ultrapassagem dos limites.
- **Segurança:** queries parametrizadas, menor privilégio no banco, TLS e segredos fora do código.
- **Idempotência:** repetir a mesma solicitação não pode duplicar efeitos.
- **Privacidade:** logs não devem conter tokens, segredos ou dados pessoais completos.
- **Recuperação:** deve ser possível reconstruir os agregados a partir dos empréstimos persistidos.
- **Manutenibilidade:** domínio, aplicação, HTTP e persistência devem possuir responsabilidades claramente separadas.
- **Evolução:** as regras de concentração devem estar isoladas da camada HTTP e do acesso ao PostgreSQL.

### 11.1 Logs técnicos mínimos

O serviço deve registrar somente informações técnicas necessárias para operação e diagnóstico:

- inicialização e encerramento do processo;
- identificador de correlação da requisição;
- rota, método, status HTTP e duração;
- falhas de validação sem reproduzir dados pessoais;
- falhas de conexão, transação e consulta ao PostgreSQL;
- erros inesperados com stack trace no ambiente apropriado.

Não fazem parte deste incremento auditoria de negócio, métricas, dashboards ou logs completos do payload.

## 12. Estratégia de implementação

### 12.1 Stack definida

| Responsabilidade | Tecnologia |
|---|---|
| Linguagem | TypeScript |
| Runtime | Node.js 24 |
| HTTP | Express 5 |
| PostgreSQL | `pg` (`node-postgres`) |
| Testes | Vitest |
| PostgreSQL em testes de integração | Testcontainers |

### 12.2 Desenvolvimento orientado por testes

A implementação deve começar pelos testes e seguir TDD:

1. **Red:** escrever um teste que descreva o próximo comportamento e inicialmente falhe.
2. **Green:** implementar somente o necessário para o teste passar.
3. **Refactor:** melhorar o código mantendo toda a suíte verde.

Nenhuma regra de negócio deve ser implementada antes de existir um teste que descreva seu comportamento esperado.

### 12.3 Testes unitários

Devem validar regras puras sem PostgreSQL ou servidor HTTP:

- cálculo do total projetado;
- cálculo da exposição projetada da UF;
- seleção entre bootstrap e regra percentual;
- cálculo do limite absoluto de bootstrap a partir do percentual fornecido pela política;
- limite de R$ 20.000 para SP na configuração inicial de bootstrap;
- limite de R$ 10.000 para as demais UFs na configuração inicial de bootstrap;
- transição exatamente em R$ 100.000;
- aplicação de limite específico por UF fornecido pela política;
- aplicação do limite padrão fornecido pela política;
- alteração dos resultados quando uma versão de política fornecer percentuais diferentes;
- mensagens de aprovação e negativa;
- validação de UF e valor.

### 12.4 Testes de integração

Devem utilizar PostgreSQL descartável provisionado por Testcontainers e validar:

- criação do empréstimo, atualização dos agregados e resposta idempotente na mesma transação;
- atualização atômica de `TOTAL` e UF;
- ausência de empréstimo e de alteração dos agregados quando a decisão for negada;
- rollback completo quando a transação falhar;
- persistência da versão da política;
- leitura do limite padrão e do limite específico da política vigente;
- idempotência da solicitação;
- conflito ao reutilizar uma chave com payload diferente;
- bloqueio de linhas e concorrência entre solicitações;
- reconstrução dos agregados a partir de `loans`;
- contrato HTTP implementado com Express 5;
- logs técnicos em cenários de falha relevantes.

### 12.5 Ordem inicial de implementação

1. Criar testes unitários da regra de bootstrap.
2. Implementar o modelo de decisão mínimo.
3. Adicionar testes da regra percentual e da transição em R$ 100.000.
4. Implementar validação e mensagens.
5. Criar testes de integração do schema e dos agregados com Testcontainers.
6. Implementar a transação de decisão, criação do empréstimo e atualização dos agregados usando `pg`.
7. Testar e implementar idempotência.
8. Testar concorrência com solicitações simultâneas.
9. Implementar o contrato HTTP com Express 5.
10. Adicionar logs técnicos mínimos e testes dos cenários relevantes.

## 13. Critérios de aceite

- Com a política inicial, aprovar SP durante o bootstrap com exposição projetada de até R$ 20.000.
- Com a política inicial, negar SP durante o bootstrap acima de R$ 20.000.
- Com a política inicial, aprovar outra UF durante o bootstrap com exposição projetada de até R$ 10.000.
- Com a política inicial, negar outra UF durante o bootstrap acima de R$ 10.000.
- Aplicar a regra percentual quando a solicitação fizer o total atingir R$ 100.000.
- Com a política inicial, negar GO quando sua concentração projetada ultrapassar o limite padrão de 10%.
- Com a política inicial, permitir SP até seu limite específico de 20% e negar acima dele.
- Aplicar novos percentuais sem alterar a lógica de domínio quando outra versão de política estiver vigente.
- Criar exatamente um empréstimo para cada aprovação.
- Não criar empréstimo nem alterar agregados quando a decisão for negada.
- Impedir que solicitações concorrentes produzam uma concentração inválida.
- Retornar o mesmo resultado para retry com a mesma chave e payload.
- Produzir conflito para a mesma chave com payload diferente.
- Persistir `policy_version` sem retorná-la.
- Retornar `"O valor solicitado foi aprovado."` quando aprovado.
- Retornar `"O empréstimo foi negado."` quando negado.
- Manter testes unitários e de integração automatizados e aprovados.

## 14. Decisões em aberto

| Item | Status |
|---|---|
| Endpoint e códigos HTTP | Definido: `POST /loan-decisions`; `200`, `400`, `409` e `500` |
| Versão do Node.js | Definido: Node.js 24 |
| Retenção das chaves e respostas de idempotência | A definir |
| Retenção dos logs técnicos | A definir |
| Quitação, cancelamento e redução futura da exposição | Fora deste incremento |

## 15. Entregáveis e README

A entrega deve conter o código-fonte em um repositório Git e um `README.md` com:

- visão geral da solução;
- instruções para instalação e execução;
- instruções para executar os testes;
- arquitetura e organização do código;
- decisões técnicas relevantes;
- premissas adotadas, incluindo a necessidade do bootstrap;
- funcionamento da transação, concorrência e idempotência;
- trade-offs e limitações conhecidas;
- o que poderia ser evoluído com mais tempo.

## 16. Conclusão do primeiro incremento

O incremento estará concluído quando:

- todos os critérios de aceite estiverem cobertos por testes automatizados;
- testes unitários e de integração estiverem aprovados;
- o contrato HTTP físico estiver documentado;
- concorrência e idempotência estiverem validadas no PostgreSQL;
- o empréstimo e os agregados forem persistidos atomicamente em toda aprovação;
- nenhuma negativa criar um empréstimo;
- os agregados puderem ser reconstruídos a partir de `loans`;
- as premissas e limitações estiverem documentadas no `README.md`.
