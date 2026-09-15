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
