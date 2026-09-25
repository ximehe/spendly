import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/statement.css';
import '../styles/new-transaction.css';

import { readTransactions, writeTransactions, StorageReadError, StorageWriteError } from './storage.js';
import { getMonthKeyFromDate } from './dates.js';
import { getCurrentMonthKey } from './month.js';
import { renderStatement } from './statement-view.js';
import { mountTransactionFormView } from './new-transaction-view.js';
import type { CategoryId, Transaction } from './types';

type AppView = 'statement' | 'new-transaction';

interface AppState {
  view: AppView;
  selectedMonthKey: string;
  transactions: Transaction[];
  isLoading: boolean;
  loadError: boolean;
  /** Filtro por categoría del statement. Solo en memoria, nunca se persiste. */
  categoryFilter: CategoryId | null;
  /**
   * Categoría inicial para el formulario, capturada al momento de abrirlo
   * (normalmente igual a `categoryFilter` si había uno activo). Se guarda
   * aparte para no depender de que `categoryFilter` no cambie mientras el
   * formulario está abierto.
   */
  formInitialCategoryId: CategoryId | undefined;
  /**
   * Id del movimiento que se está editando, si el formulario está abierto
   * en modo edición. `null` cuando el formulario está en modo creación o
   * cuando no está abierto. Solo estado de sesión, nunca se persiste.
   */
  editingTransactionId: string | null;
  /** Id del movimiento mostrando la confirmación inline "¿Eliminar...?". */
  pendingDeleteId: string | null;
  /** Error de eliminación asociado a un movimiento puntual, si lo hay. */
  deleteError: { id: string; message: string } | null;
  /**
   * A qué movimiento devolver el foco tras cancelar una confirmación o
   * tras un borrado fallido. Se fija explícitamente en cada handler
   * (nunca queda un valor "viejo" de un render anterior sin querer).
   */
  focusTriggerId: string | null;
  /** A qué botón "Editar" devolver el foco (cancelar edición, o guardado exitoso si el movimiento sigue en este mes). */
  focusEditTriggerId: string | null;
  /** A qué ítem del índice mensual devolver el foco (tras seleccionarlo). */
  focusMonthKey: string | null;
  /** A qué botón de categoría devolver el foco (tras usarlo para filtrar). */
  focusCategoryId: CategoryId | null;
  /**
   * Señal de un solo uso para cuando el elemento que tenía el foco ya no
   * existe y no hay un punto puntual al cual devolverlo (guardar,
   * eliminar con éxito, o "Quitar filtro" desde la línea de estado).
   * También actúa como respaldo si `focusEditTriggerId` no aparece en el
   * nuevo render (el movimiento editado cambió de mes).
   */
  focusFallback: boolean;
}

const appRoot = document.getElementById('app');
if (!appRoot) {
  throw new Error('No se encontró el elemento #app.');
}

/**
 * `?mes=YYYY-MM` en la URL es solo una ayuda de navegación/prueba para
 * esta etapa (no hay todavía un selector de mes futuro en la UI real,
 * ya que el índice solo lista meses con transacciones más el actual).
 * Permite verificar manualmente los estados de "mes pasado vacío" y
 * "mes futuro" sin depender de datos ya cargados.
 */
function getInitialMonthKey(): string {
  const params = new URLSearchParams(window.location.search);
  return params.get('mes') ?? getCurrentMonthKey();
}

const state: AppState = {
  view: 'statement',
  selectedMonthKey: getInitialMonthKey(),
  transactions: [],
  isLoading: true,
  loadError: false,
  categoryFilter: null,
  formInitialCategoryId: undefined,
  editingTransactionId: null,
  pendingDeleteId: null,
  deleteError: null,
  focusTriggerId: null,
  focusEditTriggerId: null,
  focusMonthKey: null,
  focusCategoryId: null,
  focusFallback: false,
};

function render(): void {
  if (state.view === 'new-transaction') {
    const editingTransaction = state.editingTransactionId
      ? state.transactions.find((t) => t.id === state.editingTransactionId)
      : undefined;

    // Robustez: si se pidió editar un movimiento que ya no existe (por
    // ejemplo, se eliminó desde otra pestaña), no se muestra un
    // formulario de edición roto — se vuelve al statement como si se
    // hubiera cancelado.
    if (state.editingTransactionId && !editingTransaction) {
      state.view = 'statement';
      state.editingTransactionId = null;
      resetTransientUiState();
      state.focusFallback = true;
      render();
      return;
    }

    mountTransactionFormView(appRoot!, {
      mode: editingTransaction ? 'edit' : 'create',
      originMonthKey: state.selectedMonthKey,
      editingTransaction,
      initialCategoryId: state.formInitialCategoryId,
      onCancel: handleCancel,
      onSubmit: editingTransaction ? handleEditSubmit : handleSubmit,
    });
    return;
  }

  renderStatement(appRoot!, {
    isLoading: state.isLoading,
    loadError: state.loadError,
    transactions: state.transactions,
    selectedMonthKey: state.selectedMonthKey,
    categoryFilter: state.categoryFilter,
    pendingDeleteId: state.pendingDeleteId,
    deleteError: state.deleteError,
    focusTriggerId: state.focusTriggerId,
    focusEditTriggerId: state.focusEditTriggerId,
    focusMonthKey: state.focusMonthKey,
    focusCategoryId: state.focusCategoryId,
    focusFallback: state.focusFallback,
    onSelectMonth: handleSelectMonth,
    onAddTransaction: handleAddTransaction,
    onRetryLoad: handleRetryLoad,
    onSetCategoryFilter: handleSetCategoryFilter,
    onClearCategoryFilter: handleClearCategoryFilter,
    onEditTransaction: handleEditTransaction,
    onRequestDelete: handleRequestDelete,
    onCancelDelete: handleCancelDelete,
    onConfirmDelete: handleConfirmDelete,
  });

  updateStickyBalance();
}

function loadTransactions(): void {
  state.isLoading = true;
  state.loadError = false;
  render();

  // La lectura de localStorage es sincrónica e instantánea; se difiere
  // un tick para que el estado "Cargando movimientos…" llegue a pintarse
  // en vez de resolverse antes de que el navegador muestre algo.
  window.setTimeout(() => {
    try {
      state.transactions = readTransactions();
      state.isLoading = false;
      state.loadError = false;
    } catch (error) {
      if (error instanceof StorageReadError) {
        state.isLoading = false;
        state.loadError = true;
      } else {
        throw error;
      }
    }
    render();
  }, 0);
}

/**
 * Limpia todas las señales de foco de un solo uso y el estado transitorio
 * de eliminación (confirmación abierta, error). Cada handler la llama
 * primero y después fija, si corresponde, la señal puntual que le toca —
 * así ningún valor "viejo" de un render anterior se filtra a uno que no
 * tiene nada que ver.
 */
function resetTransientUiState(): void {
  state.pendingDeleteId = null;
  state.deleteError = null;
  state.focusTriggerId = null;
  state.focusEditTriggerId = null;
  state.focusMonthKey = null;
  state.focusCategoryId = null;
  state.focusFallback = false;
}

function handleSelectMonth(monthKey: string): void {
  state.selectedMonthKey = monthKey;
  // Cambiar de mes limpia el filtro: evita quedar viendo un filtro de una
  // categoría que puede no existir (o no tener sentido) en el nuevo mes.
  state.categoryFilter = null;
  resetTransientUiState();
  // El ítem del índice que se acaba de activar se re-crea entero en el
  // próximo render (todo el DOM se reemplaza); sin esto el foco se
  // perdería en <body> en vez de quedarse en el índice.
  state.focusMonthKey = monthKey;
  render();
}

function handleAddTransaction(originMonthKey: string, initialCategoryId?: CategoryId): void {
  state.selectedMonthKey = originMonthKey;
  state.formInitialCategoryId = initialCategoryId;
  state.editingTransactionId = null;
  state.view = 'new-transaction';
  resetTransientUiState();
  render();
}

function handleEditTransaction(transactionId: string): void {
  state.editingTransactionId = transactionId;
  state.view = 'new-transaction';
  resetTransientUiState();
  render();
}

function handleCancel(): void {
  // Si se estaba editando, el foco vuelve al botón "Editar" de ese
  // mismo movimiento (que sigue existiendo: cancelar no lo toca). Si se
  // estaba creando, no hay un disparador puntual al que volver — se usa
  // el respaldo genérico, que encuentra "Agregar movimiento".
  const wasEditingId = state.editingTransactionId;
  state.view = 'statement';
  state.editingTransactionId = null;
  resetTransientUiState();
  if (wasEditingId) {
    state.focusEditTriggerId = wasEditingId;
  } else {
    state.focusFallback = true;
  }
  render();
}

function handleRetryLoad(): void {
  loadTransactions();
}

function handleSetCategoryFilter(categoryId: CategoryId): void {
  // Click sobre la categoría ya activa: actúa como "quitar filtro".
  state.categoryFilter = state.categoryFilter === categoryId ? null : categoryId;
  resetTransientUiState();
  // El botón de categoría que se acaba de usar sigue existiendo en el
  // nuevo render (activo o no); el foco vuelve ahí en vez de a <body>.
  state.focusCategoryId = categoryId;
  render();
}

function handleClearCategoryFilter(): void {
  state.categoryFilter = null;
  resetTransientUiState();
  // "Quitar filtro" (la acción de la línea de estado) desaparece del
  // todo en el nuevo render: no hay a dónde devolver el foco puntual,
  // se usa el punto lógico de respaldo.
  state.focusFallback = true;
  render();
}

function handleRequestDelete(transactionId: string): void {
  state.pendingDeleteId = transactionId;
  state.deleteError = null;
  // No hace falta un focusTriggerId acá: mientras pendingDeleteId esté
  // presente, la vista siempre enfoca el botón "Eliminar" de la propia
  // confirmación (ver applyFocusManagement en statement-view.ts).
  state.focusTriggerId = null;
  state.focusEditTriggerId = null;
  state.focusMonthKey = null;
  state.focusCategoryId = null;
  state.focusFallback = false;
  render();
}

function handleCancelDelete(transactionId: string): void {
  state.pendingDeleteId = null;
  // La confirmación desaparece; el foco vuelve al disparador "Eliminar"
  // de esa misma fila, no se pierde en el body.
  state.focusTriggerId = transactionId;
  state.focusEditTriggerId = null;
  state.focusMonthKey = null;
  state.focusCategoryId = null;
  state.focusFallback = false;
  render();
}

/**
 * Ciclo leer → filtrar → escribir, igual que el guardado: usa
 * exclusivamente `storage.ts`, sin wrapper nuevo. Si falla, el
 * movimiento nunca se quita de `state.transactions` (ese array recién
 * se reemplaza después de que `writeTransactions` resuelve con éxito),
 * así que no hace falta "restaurarlo": nunca llegó a desaparecer.
 */
function handleConfirmDelete(transactionId: string): void {
  let existing: Transaction[];
  try {
    existing = readTransactions();
  } catch {
    state.pendingDeleteId = null;
    state.deleteError = {
      id: transactionId,
      message: 'No se pudo eliminar el movimiento. Intentá de nuevo.',
    };
    // El fallo es consecuencia directa de esta acción del usuario: el
    // foco vuelve a esa misma fila para que pueda reintentar de inmediato.
    state.focusTriggerId = transactionId;
    state.focusEditTriggerId = null;
    state.focusMonthKey = null;
    state.focusCategoryId = null;
    state.focusFallback = false;
    render();
    return;
  }

  const updated = existing.filter((t) => t.id !== transactionId);

  try {
    writeTransactions(updated);
  } catch (error) {
    if (error instanceof StorageWriteError) {
      state.pendingDeleteId = null;
      state.deleteError = {
        id: transactionId,
        message: 'No se pudo eliminar el movimiento. Intentá de nuevo.',
      };
      state.focusTriggerId = transactionId;
      state.focusEditTriggerId = null;
      state.focusMonthKey = null;
      state.focusCategoryId = null;
      state.focusFallback = false;
      render();
      return;
    }
    throw error;
  }

  state.transactions = updated;
  state.pendingDeleteId = null;
  state.deleteError = null;
  // La fila ya no existe: no hay a dónde "volver" el foco, se ubica en
  // un punto lógico cercano (ver applyFocusManagement).
  state.focusTriggerId = null;
  state.focusEditTriggerId = null;
  state.focusMonthKey = null;
  state.focusCategoryId = null;
  state.focusFallback = true;
  render();
}

/**
 * Punto de integración con `mountTransactionFormView` en modo 'create'.
 * Hace el ciclo completo leer → agregar → escribir usando exclusivamente
 * los módulos de `storage.ts`, sin ningún wrapper nuevo de localStorage.
 *
 * Devuelve `true` si se guardó con éxito (la vista de formulario se
 * reemplaza por el statement) o `false` si falló (la vista de
 * formulario sigue montada y muestra el error general).
 */
function handleSubmit(draft: Transaction): boolean {
  let existing: Transaction[];
  try {
    existing = readTransactions();
  } catch {
    return false;
  }

  const updated = [...existing, draft];

  try {
    writeTransactions(updated);
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return false;
    }
    throw error;
  }

  state.transactions = updated;
  const newMonthKey = getMonthKeyFromDate(draft.date);
  if (newMonthKey !== state.selectedMonthKey) {
    // Mismo criterio que cambiar de mes desde el índice: no dejar un
    // filtro de una categoría que puede no tener sentido en el mes nuevo.
    state.categoryFilter = null;
  }
  state.selectedMonthKey = newMonthKey;
  state.view = 'statement';
  resetTransientUiState();
  // El formulario (que tenía el foco en "Guardar") se acaba de desmontar
  // por completo; sin esto el foco quedaría perdido en <body>.
  state.focusFallback = true;
  render();
  return true;
}

/**
 * Punto de integración con `mountTransactionFormView` en modo 'edit'.
 * Mismo ciclo leer → escribir que `handleSubmit`, pero reemplaza
 * únicamente el movimiento con ese `id` dentro del array existente en
 * vez de agregar uno nuevo — `id` y `createdAt` ya vienen preservados
 * desde la vista del formulario, acá no se tocan.
 */
function handleEditSubmit(updatedTransaction: Transaction): boolean {
  let existing: Transaction[];
  try {
    existing = readTransactions();
  } catch {
    return false;
  }

  const nextTransactions = existing.map((t) =>
    t.id === updatedTransaction.id ? updatedTransaction : t,
  );

  try {
    writeTransactions(nextTransactions);
  } catch (error) {
    if (error instanceof StorageWriteError) {
      return false;
    }
    throw error;
  }

  state.transactions = nextTransactions;
  const newMonthKey = getMonthKeyFromDate(updatedTransaction.date);
  if (newMonthKey !== state.selectedMonthKey) {
    // Mismo criterio que cambiar de mes: no dejar un filtro de una
    // categoría que puede no tener sentido en el mes nuevo.
    state.categoryFilter = null;
  }
  state.selectedMonthKey = newMonthKey;
  state.view = 'statement';
  state.editingTransactionId = null;
  resetTransientUiState();
  // Si el movimiento sigue visible en este mes, el foco vuelve a su
  // propio botón "Editar"; si cambió de mes (y ya no está acá), el
  // respaldo genérico entra en juego automáticamente (ver
  // applyFocusManagement en statement-view.ts).
  state.focusEditTriggerId = updatedTransaction.id;
  state.focusFallback = true;
  render();
  return true;
}

/**
 * El balance strip pasa a estado "pegado" solo en mobile, al scrollear.
 * Se reengancha en cada render porque el statement se re-crea entero
 * cada vez (no hay DOM persistente entre renders).
 */
function updateStickyBalance(): void {
  const strip = appRoot!.querySelector<HTMLElement>('.balance-strip');
  if (!strip) return;
  const shouldStick = window.innerWidth <= 768 && window.scrollY > 40;
  strip.classList.toggle('is-stuck', shouldStick);
}

window.addEventListener('scroll', updateStickyBalance);
window.addEventListener('resize', updateStickyBalance);

loadTransactions();
