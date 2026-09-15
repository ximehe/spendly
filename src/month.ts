import { getMonthKeyFromDate, getTodayISODate } from './dates.js';
import type { Transaction } from './types';

/**
 * Nombres de mes en español rioplatense/uruguayo: "setiembre", no
 * "septiembre", consistente con el resto de la interfaz ya aprobada.
 */
const MONTH_NAMES = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'setiembre', 'octubre', 'noviembre', 'diciembre',
] as const;

function monthNameFromKey(monthKey: string): string {
  const monthNumber = Number(monthKey.slice(5, 7));
  return MONTH_NAMES[monthNumber - 1] ?? monthKey;
}

function capitalize(word: string): string {
  return word.length === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1);
}

/** Clave de mes 'YYYY-MM' correspondiente a hoy. */
export function getCurrentMonthKey(): string {
  return getMonthKeyFromDate(getTodayISODate());
}

/**
 * Las claves de mes 'YYYY-MM' son lexicográficamente comparables, así
 * que no hace falta construir objetos Date para saber si un mes es
 * posterior al actual.
 */
export function isFutureMonthKey(monthKey: string): boolean {
  return monthKey > getCurrentMonthKey();
}

/** 'Setiembre 2026', para el título del statement. */
export function formatMonthTitle(monthKey: string): string {
  const year = monthKey.slice(0, 4);
  return `${capitalize(monthNameFromKey(monthKey))} ${year}`;
}

/** 'Setiembre', para el ítem del índice mensual. */
export function formatMonthShortLabel(monthKey: string): string {
  return capitalize(monthNameFromKey(monthKey));
}

/** 'setiembre', en minúscula, para usar dentro de una oración. */
export function formatMonthNameLowercase(monthKey: string): string {
  return monthNameFromKey(monthKey);
}

/** '12 de setiembre', para el encabezado de un grupo de día. */
export function formatDayHeading(date: string): string {
  const day = Number(date.slice(8, 10));
  const monthKey = getMonthKeyFromDate(date);
  return `${day} de ${monthNameFromKey(monthKey)}`;
}

/**
 * Meses a listar en el índice: todos los meses con al menos una
 * transacción, más el mes actual (siempre visible, incluso vacío),
 * sin duplicados y en orden descendente (más reciente primero).
 */
export function getAvailableMonthKeys(
  transactions: readonly Transaction[],
): string[] {
  const keys = new Set<string>(
    transactions.map((transaction) => getMonthKeyFromDate(transaction.date)),
  );
  keys.add(getCurrentMonthKey());
  return Array.from(keys).sort((a, b) => (a < b ? 1 : a > b ? -1 : 0));
}
