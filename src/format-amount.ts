/**
 * Parseo y formato de montos ingresados por el usuario en el campo "Monto".
 *
 * Reglas asumidas para el parseo (no todas están en la especificación
 * original, documentadas acá como decisión):
 * - La coma es el separador decimal por defecto (convención uruguaya):
 *   si el texto tiene una coma, todo punto anterior se interpreta como
 *   separador de miles.
 * - Si el texto solo tiene un punto y exactamente 3 dígitos después
 *   (ej. "1.000"), se interpreta como separador de miles, no decimal,
 *   porque así es como alguien tipearía mil pesos redondos por costumbre.
 * - Si el punto tiene 1 o 2 dígitos después (ej. "1000.5"), se interpreta
 *   como separador decimal.
 * - Nunca se acepta signo negativo: se descarta como cualquier otro
 *   carácter inválido (el signo lo determina el campo Tipo).
 */

/** Filtra, mientras el usuario escribe, cualquier carácter que no sea dígito, coma o punto. */
export function sanitizeAmountInputChars(raw: string): string {
  return raw.replace(/[^0-9.,]/g, '');
}

/**
 * Convierte el texto crudo del campo a un número, o `null` si no hay
 * ningún monto interpretable. Nunca devuelve un número negativo.
 */
export function parseAmountInput(raw: string): number | null {
  const cleaned = sanitizeAmountInputChars(raw.trim());
  if (cleaned === '') return null;

  let integerPart: string;
  let decimalPart: string;

  if (cleaned.includes(',')) {
    const lastComma = cleaned.lastIndexOf(',');
    integerPart = cleaned.slice(0, lastComma).replace(/[.,]/g, '');
    decimalPart = cleaned.slice(lastComma + 1).replace(/[^0-9]/g, '').slice(0, 2);
  } else {
    const lastDot = cleaned.lastIndexOf('.');
    if (lastDot === -1) {
      integerPart = cleaned;
      decimalPart = '';
    } else {
      const afterDot = cleaned.slice(lastDot + 1);
      if (afterDot.length === 3) {
        // "1.000" escrito como entero con punto de miles, no como decimal.
        integerPart = cleaned.replace(/\./g, '');
        decimalPart = '';
      } else {
        integerPart = cleaned.slice(0, lastDot).replace(/\./g, '');
        decimalPart = afterDot.replace(/[^0-9]/g, '').slice(0, 2);
      }
    }
  }

  if (integerPart === '') integerPart = '0';

  const numeric = Number(`${integerPart}.${decimalPart || '0'}`);
  return Number.isFinite(numeric) ? numeric : null;
}

/** Formatea un número como monto uruguayo sin símbolo de moneda, ej. "1.000,50". */
export function formatAmountUYU(value: number): string {
  return new Intl.NumberFormat('es-UY', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}
