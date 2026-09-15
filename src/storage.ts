import type { Transaction } from './types';

/**
 * Clave versionada desde el día uno. Si el modelo de Transaction cambia
 * de forma incompatible más adelante, se migra a 'v2' en vez de romper
 * los datos existentes de alguien que ya tenga movimientos guardados.
 */
const STORAGE_KEY = 'spendly:transactions:v1';

/** Falla al leer o interpretar los datos guardados. */
export class StorageReadError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'StorageReadError';
    this.cause = options?.cause;
  }
}

/** Falla al escribir datos nuevos. */
export class StorageWriteError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = 'StorageWriteError';
    this.cause = options?.cause;
  }
}

/**
 * Validación mínima de forma, no de contenido exhaustivo. El objetivo es
 * detectar datos corruptos o de un esquema incompatible sin tener que
 * levantar una librería de validación para esta etapa.
 */
function isTransactionArray(value: unknown): value is Transaction[] {
  if (!Array.isArray(value)) return false;
  return value.every(
    (item) =>
      typeof item === 'object' &&
      item !== null &&
      typeof (item as Transaction).id === 'string' &&
      ((item as Transaction).type === 'income' ||
        (item as Transaction).type === 'expense') &&
      typeof (item as Transaction).amount === 'number' &&
      typeof (item as Transaction).description === 'string' &&
      typeof (item as Transaction).category === 'string' &&
      typeof (item as Transaction).date === 'string' &&
      typeof (item as Transaction).createdAt === 'string',
  );
}

/**
 * Lee todas las transacciones guardadas.
 *
 * Devuelve `[]` cuando todavía no hay nada guardado (primera vez real,
 * no es un error). Lanza `StorageReadError` si localStorage no está
 * disponible o si el contenido guardado está corrupto/es incompatible,
 * para que la capa de UI pueda mostrar el estado de error ya definido
 * en vez de arrancar con datos parciales o inventados.
 */
export function readTransactions(): Transaction[] {
  let raw: string | null;

  try {
    raw = window.localStorage.getItem(STORAGE_KEY);
  } catch (cause) {
    throw new StorageReadError(
      'No se pudo acceder al almacenamiento local.',
      { cause },
    );
  }

  if (raw === null) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (cause) {
    throw new StorageReadError(
      'Los datos guardados están dañados y no se pudieron interpretar.',
      { cause },
    );
  }

  if (!isTransactionArray(parsed)) {
    throw new StorageReadError(
      'Los datos guardados no tienen el formato esperado.',
    );
  }

  return parsed;
}

/**
 * Reemplaza por completo la lista de transacciones guardadas.
 *
 * Recibe siempre el array completo (no un solo movimiento): quien llama
 * es responsable de leer, modificar en memoria y volver a guardar. Lanza
 * `StorageWriteError` si falla (por ejemplo, cuota excedida o
 * almacenamiento no disponible), sin haber alterado lo guardado previamente.
 */
export function writeTransactions(transactions: Transaction[]): void {
  let serialized: string;
  try {
    serialized = JSON.stringify(transactions);
  } catch (cause) {
    throw new StorageWriteError(
      'No se pudieron preparar los datos para guardarlos.',
      { cause },
    );
  }

  try {
    window.localStorage.setItem(STORAGE_KEY, serialized);
  } catch (cause) {
    throw new StorageWriteError('No se pudo guardar el movimiento.', {
      cause,
    });
  }
}
