import type { Category, CategoryId } from './types';

/**
 * Categorías fijas del MVP, en el orden en que deben listarse en la UI
 * (selector del formulario y resumen "Por categoría").
 *
 * No se persisten: viven en código porque todavía no hay categorías
 * personalizadas por usuario.
 */
export const CATEGORIES: readonly Category[] = [
  { id: 'alimentacion', label: 'Alimentación' },
  { id: 'cuentas', label: 'Cuentas' },
  { id: 'ocio', label: 'Ocio' },
  { id: 'ingresos', label: 'Ingresos' },
  { id: 'otros', label: 'Otros' },
];

/** Categoría por defecto al abrir el formulario de un movimiento nuevo. */
export const DEFAULT_CATEGORY_ID: CategoryId = 'otros';

/** Devuelve el label visible de una categoría a partir de su id. */
export function getCategoryLabel(categoryId: CategoryId): string {
  const category = CATEGORIES.find((c) => c.id === categoryId);
  // No debería ocurrir con CategoryId bien tipado, pero se cubre por robustez
  // ante datos viejos en localStorage que pudieran quedar desalineados.
  return category ? category.label : categoryId;
}
