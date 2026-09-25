import type { Transaction } from './types';

/**
 * Único punto del código que combina `type` + `amount` en un valor firmado.
 *
 * Cualquier cálculo de saldo, subtotal por categoría o subtotal por día
 * debe pasar por acá en lugar de reimplementar la regla de signo en cada
 * lugar que sume montos.
 */
export function getSignedAmount(transaction: Transaction): number {
  return transaction.type === 'expense'
    ? -transaction.amount
    : transaction.amount;
}

/**
 * Redondea a centésimos. Sumar muchos montos de punto flotante (ej. varias
 * decenas de movimientos con centavos) puede arrastrar errores minúsculos
 * de redondeo binario (el clásico 0.1 + 0.2). No cambia el modelo de datos
 * — `amount` sigue siendo un `number` común — solo normaliza el resultado
 * de una suma antes de compararlo (ej. ¿es negativo?) o mostrarlo.
 */
export function roundToCents(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}
