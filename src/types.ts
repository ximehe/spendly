/**
 * Tipos del dominio de Spendly.
 *
 * `amount` en Transaction es SIEMPRE positivo. El signo de un movimiento
 * nunca se persiste: se deriva de `type` a través de `getSignedAmount`
 * (ver transactions.ts). Esto evita que un monto guardado pueda quedar
 * inconsistente con su tipo.
 */

/** Ingreso o gasto. Determina el signo del movimiento, nunca `amount` en sí. */
export type TransactionType = 'income' | 'expense';

/** Categorías fijas del MVP. Sin categorías personalizadas por ahora. */
export type CategoryId =
  | 'alimentacion'
  | 'cuentas'
  | 'ocio'
  | 'ingresos'
  | 'otros';

/**
 * Un movimiento del statement.
 *
 * - `date`: fecha del movimiento, formato 'YYYY-MM-DD' (sin hora, sin zona horaria).
 * - `createdAt`: momento real de creación del registro, ISO datetime completo.
 *   Solo se usa para ordenar movimientos dentro de un mismo día; no reemplaza a `date`.
 */
export interface Transaction {
  readonly id: string;
  readonly type: TransactionType;
  readonly amount: number;
  readonly description: string;
  readonly category: CategoryId;
  readonly date: string;
  readonly createdAt: string;
}

/** Categoría visible en la interfaz. Lista fija, no se persiste. */
export interface Category {
  readonly id: CategoryId;
  readonly label: string;
}
