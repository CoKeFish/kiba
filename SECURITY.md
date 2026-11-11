# Política de seguridad

Kiba mueve dinero de usuarios y publicadores, así que los reportes de seguridad tienen prioridad sobre cualquier otro trabajo. Hoy Kiba corre en la testnet de Stellar: los saldos no tienen valor real, pero el código es el mismo que irá a mainnet.

[English version below](#security-policy).

## Cómo reportar una vulnerabilidad

**No abras un issue público.** Escribe a [andrelanfor@gmail.com](mailto:andrelanfor@gmail.com) con el asunto `Seguridad Kiba`.

Incluye lo que tengas de esta lista:

- Qué componente afecta (gateway, SDK, contratos, dashboard, conector MCP) y en qué versión o commit. El commit desplegado lo devuelve `GET https://api.kiba.tools/health`.
- Qué puede hacer un atacante y qué necesita para lograrlo.
- Pasos para reproducirlo, o una prueba de concepto.
- Si ya lo compartiste con alguien más.

## Qué puedes esperar

| Paso | Plazo |
|---|---|
| Acuse de recibo | 3 días hábiles |
| Evaluación inicial y severidad | 7 días |
| Corrección de un problema crítico o alto | 30 días |
| Aviso público | Después de desplegar la corrección, con crédito a quien reportó si lo quiere |

Te mantenemos al tanto durante todo el proceso. Si no estamos de acuerdo con la severidad, te explicamos por qué.

No hay programa de recompensas.

## Qué entra

- El gateway (`packages/gateway`) y la API en `api.kiba.tools`.
- El SDK (`packages/sdk`), el conector MCP (`packages/mcp-server`) y el instalador (`packages/installer`).
- Los contratos de Soroban: pagos (`packages/contracts-payments`), registro (`packages/contracts-soroban`) y la fábrica del depósito retirable (`packages/contracts-channel`).
- El dashboard (`packages/dashboard`) y la documentación (`packages/docs`).

Nos interesa sobre todo lo que permita:

- Cobrar a un usuario sin su autorización, o gastar su depósito o sus créditos.
- Cobrar como publicador sin haber servido la llamada, o cobrar dos veces.
- Sacar fondos de la tesorería o de un escrow de ganancias retenidas.
- Entrar a la cuenta de otra persona, o leer sus resultados, archivos o llaves.
- Hacer que el gateway llame a direcciones internas a través de `call_url`.

## Qué no entra

- Problemas en servicios de terceros publicados en el catálogo. Repórtalos a su publicador.
- Problemas en Stellar, Trustless Work, Privy u otros proveedores. Repórtalos a ellos; si afectan a Kiba, avísanos también.
- Ataques que requieren acceso físico al equipo del usuario o una wallet ya comprometida.
- Denegación de servicio por volumen, ingeniería social y spam.
- Reportes generados por una herramienta automática sin un impacto demostrado.

## Reglas para investigar

Investiga solo con cuentas tuyas y en testnet. No accedas a datos de otras personas, no degrades el servicio y no hagas público el problema antes de que esté corregido. Si cumples esto, no tomaremos acciones legales por tu investigación.

## Versiones con soporte

Solo la rama `main` y lo desplegado en producción reciben correcciones de seguridad. Los paquetes publicados se corrigen en su versión más reciente.

## Medidas actuales

Las medidas vigentes están en la [documentación de seguridad](https://docs.kiba.tools/recursos/seguridad). Cada despliegue pasa por un escaneo de secretos y por las pruebas automáticas.

---

# Security policy

Kiba handles money for users and publishers, so security reports take priority over other work. Kiba currently runs on Stellar testnet: balances have no real value, but the code is the same code that will go to mainnet.

## Reporting a vulnerability

**Do not open a public issue.** Email [andrelanfor@gmail.com](mailto:andrelanfor@gmail.com) with the subject `Kiba security`.

Please include the affected component and version or commit (`GET https://api.kiba.tools/health` returns the deployed commit), what an attacker can do and what they need, steps to reproduce or a proof of concept, and whether you have shared it with anyone else.

## What to expect

| Step | Target |
|---|---|
| Acknowledgement | 3 business days |
| Initial assessment and severity | 7 days |
| Fix for a critical or high issue | 30 days |
| Public notice | After the fix is deployed, with credit to the reporter if they want it |

There is no bounty program.

## Scope

In scope: the gateway and the API at `api.kiba.tools`, the SDK, the MCP connector, the installer, the Soroban contracts (payments, registry and the withdrawable deposit factory), the dashboard and the documentation.

We care most about anything that lets someone charge a user without authorization, get paid as a publisher without serving, withdraw funds from the treasury or from a held-earnings escrow, access another person's account or data, or make the gateway call internal addresses.

Out of scope: third-party services listed in the catalog, issues in Stellar, Trustless Work, Privy or other providers, attacks that need physical access or an already compromised wallet, volumetric denial of service, social engineering, and automated reports without demonstrated impact.

## Rules of engagement

Test only with your own accounts and on testnet. Do not access other people's data, do not degrade the service, and do not disclose the issue before it is fixed. If you follow these rules, we will not take legal action over your research.

## Supported versions

Only the `main` branch and what is deployed in production receive security fixes. Published packages are fixed in their latest version.
