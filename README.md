# Spendly

Registro financiero personal — proyecto de portfolio. Interfaz completamente en
español, con formato regional de Uruguay (`$U 1.234,56`, meses en español).

Statement / ledger, no dashboard: tipografía (Fraunces, IBM Plex Mono, Public
Sans), hairlines y jerarquía tipográfica hacen el trabajo visual. Sin cards,
sombras, gradientes ni pills.

## Requisitos

- Node.js 18 o superior.

## Uso

```bash
npm install
npm run dev
```

Abrí la URL que muestra la terminal (por defecto `http://localhost:5173`).

Para generar el build de producción:

```bash
npm run build
npm run preview   # sirve el build generado, para probarlo localmente
```

`npm run build` corre `tsc --noEmit` en modo estricto antes de compilar con
Vite; si hay un error de tipos, el build se detiene ahí.

## Persistencia

Todos los datos se guardan en `localStorage` del navegador, bajo la clave
`spendly:transactions:v1`. No hay backend ni cuenta de usuario: los datos
quedan únicamente en el navegador donde se cargaron.

## Estructura

```
src/
  types.ts               Tipos del dominio (Transaction, Category, etc.)
  categories.ts           Categorías fijas del MVP
  transactions.ts         getSignedAmount (único punto de signo)
  dates.ts                Helpers de fecha (YYYY-MM-DD)
  month.ts                Formato de mes/fecha en español + lista de meses
  format-amount.ts        Parseo/formato de montos en formato uruguayo
  validation.ts           Validaciones del formulario
  storage.ts               Lectura/escritura en localStorage
  new-transaction-view.ts  Vista "Nuevo movimiento"
  statement-view.ts       Vista del statement (saldo, movimientos, índice)
  main.ts                  Orquestación: navegación + carga inicial

styles/
  tokens.css        Colores y fuentes
  base.css          Reset mínimo y utilidades
  statement.css     Estilos del statement
  new-transaction.css  Estilos del formulario
```

## Estado del proyecto

Implementado: modelo de datos, persistencia, formulario de alta de
movimientos, statement conectado a datos reales (saldo global, agrupación por
día, índice mensual, resumen por categoría), y los estados vacíos/carga/error
definidos para cada uno.

Pendiente (etapas futuras): eliminar movimientos, editar movimientos, filtros.
