import type { CategoryId, TransactionType } from './types';

/** Valores crudos del formulario, tal como llegan de los controles del DOM. */
export interface NewTransactionFormValues {
  readonly type: TransactionType;
  readonly description: string;
  readonly category: CategoryId;
  readonly date: string; // 'YYYY-MM-DD'
}

export interface NewTransactionFormErrors {
  amount?: string;
  description?: string;
  date?: string;
}

/**
 * Las tres validaciones definidas en la especificación, ni una más.
 *
 * `parsedAmount` se recibe ya calculado (ver format-amount.ts) en vez de
 * que esta función parsee el texto crudo, para mantener el parseo de
 * montos y las reglas de validación en responsabilidades separadas.
 *
 * Las fechas se comparan como strings 'YYYY-MM-DD': ese formato es
 * lexicográficamente ordenable, así que no hace falta construir objetos
 * Date (y evita corrimientos de zona horaria).
 */
export function validateNewTransactionForm(
  values: NewTransactionFormValues,
  parsedAmount: number | null,
  todayISODate: string,
): NewTransactionFormErrors {
  const errors: NewTransactionFormErrors = {};

  if (parsedAmount === null || parsedAmount <= 0) {
    errors.amount = 'Ingresá un monto mayor a $U 0,00.';
  }

  if (values.description.trim() === '') {
    errors.description = 'Ingresá una descripción.';
  }

  if (values.date > todayISODate) {
    errors.date = 'La fecha no puede ser posterior a hoy.';
  }

  return errors;
}
