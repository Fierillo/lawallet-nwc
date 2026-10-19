# Walletilla

Una wallet Lightning con direcciones personalizadas y conexión a wallets mediante
Nostr Wallet Connect (NWC). Fork de [LaWallet NWC](https://github.com/lawalletio/lawallet-nwc).

**[Abrir Walletilla → walletilla.fierillo.world](https://walletilla.fierillo.world)**

[![CI](https://github.com/Fierillo/lawallet-nwc/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Fierillo/lawallet-nwc/actions/workflows/ci.yml)
[![Security](https://github.com/Fierillo/lawallet-nwc/actions/workflows/security.yml/badge.svg?branch=main)](https://github.com/Fierillo/lawallet-nwc/actions/workflows/security.yml)

> Proyecto en pre-alpha. No usar con fondos reales; pueden producirse cambios incompatibles.

## Qué ofrece

- Enviar y recibir pagos Lightning.
- Direcciones Lightning con dominio `fierillo.world`.
- Conectar wallets compatibles con NWC.
- Organizar transacciones con tags privados, guardados por cuenta y excluidos de los recibos compartidos.
- Consultar mensajes y gestionar tags desde las listas de Inicio y Actividad.
- Soporte para tarjetas NFC BoltCard y administración según el rol del usuario.

## Enlaces

- [Walletilla](https://walletilla.fierillo.world)
- [Referencia interactiva de la API](https://walletilla.fierillo.world/api-docs)
- [Código fuente](https://github.com/Fierillo/lawallet-nwc)
- [Reportar un problema](https://github.com/Fierillo/lawallet-nwc/issues)

## Desarrollo local

Requiere [Node.js 24.21](./.nvmrc), pnpm 11 y Docker.

```bash
git clone https://github.com/Fierillo/lawallet-nwc.git
cd lawallet-nwc
nvm use
pnpm start:dev-server
```

El comando instala dependencias, prepara el entorno local y PostgreSQL, aplica
migraciones y muestra la URL del servidor. Conserva los datos existentes entre
ejecuciones.

```bash
pnpm test        # Tests del monorepo
pnpm typecheck   # Comprobación de tipos
pnpm lint        # Análisis del código
```

Stack: Next.js, React, TypeScript y PostgreSQL con Prisma.

## Documentación

- [Arquitectura](./docs/ARCHITECTURE.md)
- [Tests](./docs/TESTING.md)
- [Despliegue con Docker](./docs/DOCKER.md)
- [Automatizaciones y actualizaciones desde LaWallet](./docs/FORK-SYNC.md)
- [Documentación oficial de LaWallet](https://docs.lawallet.io)

## Créditos y licencia

Walletilla es una adaptación de [LaWallet NWC](https://github.com/lawalletio/lawallet-nwc),
desarrollado por sus contribuidores y mantenido por
[Agustín Kassis](https://github.com/agustinkassis).
Las personalizaciones de este fork son de [Fierillo](https://github.com/Fierillo).

[Licencia MIT](./LICENSE).
