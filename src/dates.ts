/**
 * Helpers de fecha mínimos para esta etapa. Todas las fechas de dominio
 * usan el formato 'YYYY-MM-DD' como string, sin objetos Date persistidos
 * ni cálculos de zona horaria: evita los corrimientos de un día típicos
 * de `new Date('YYYY-MM-DD')` interpretado como UTC.
 */

function pad2(value: number): string {
  return value.toString().padStart(2, '0');
}

/** Fecha de hoy en formato 'YYYY-MM-DD', según el huso horario local. */
export function getTodayISODate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/** Extrae la clave de mes 'YYYY-MM' de una fecha 'YYYY-MM-DD'. */
export function getMonthKeyFromDate(date: string): string {
  return date.slice(0, 7);
}

/**
 * Último día válido de un mes.
 * `month` es 1-indexado (1 = enero, 12 = diciembre), para que coincida
 * con la forma en que se lee una clave de mes 'YYYY-MM'.
 */
export function getLastDayOfMonth(year: number, month: number): number {
  // Día 0 del mes siguiente (0-indexado internamente por Date) es el
  // último día del mes buscado.
  return new Date(year, month, 0).getDate();
}

/**
 * Resuelve la fecha inicial para cargar un movimiento en un mes distinto
 * al actual: mismo día del mes que hoy, o el último día válido de ese mes
 * si el día no existe (ej. hoy 31/08 → abrir febrero → último día de febrero).
 */
export function resolveDateForMonth(
  todayISODate: string,
  targetMonthKey: string,
): string {
  const todayDay = Number(todayISODate.slice(8, 10));
  const targetYear = Number(targetMonthKey.slice(0, 4));
  const targetMonth = Number(targetMonthKey.slice(5, 7));

  const lastDayOfTargetMonth = getLastDayOfMonth(targetYear, targetMonth);
  const resolvedDay = Math.min(todayDay, lastDayOfTargetMonth);

  return `${targetYear}-${pad2(targetMonth)}-${pad2(resolvedDay)}`;
}
