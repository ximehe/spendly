import '../styles/tokens.css';
import '../styles/base.css';
import '../styles/statement.css';
import '../styles/new-transaction.css';

import { readTransactions, writeTransactions, StorageReadError, StorageWriteError } from './storage.js';
import { getMonthKeyFromDate } from './dates.js';
import { getCurrentMonthKey } from './month.js';
import { renderStatement } from './statement-view.js';
import { mountNewTransactionView } from './new-transaction-view.js';
import type { Transaction } from './types';

type AppView = 'statement' | 'new-transaction';

interface AppState {
  view: AppView;
  selectedMonthKey: string;
  transactions: Transaction[];
  isLoading: boolean;
  loadError: boolean;
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
};

function render(): void {
  appRoot!.innerHTML = '';

  if (state.view === 'new-transaction') {
    mountNewTransactionView(appRoot!, {
      originMonthKey: state.selectedMonthKey,
      onCancel: handleCancel,
      onSubmit: handleSubmit,
    });
    return;
  }

  renderStatement(appRoot!, {
    isLoading: state.isLoading,
    loadError: state.loadError,
    transactions: state.transactions,
    selectedMonthKey: state.selectedMonthKey,
    onSelectMonth: handleSelectMonth,
    onAddTransaction: handleAddTransaction,
    onRetryLoad: handleRetryLoad,
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

function handleSelectMonth(monthKey: string): void {
  state.selectedMonthKey = monthKey;
  render();
}

function handleAddTransaction(originMonthKey: string): void {
  state.selectedMonthKey = originMonthKey;
  state.view = 'new-transaction';
  render();
}

function handleCancel(): void {
  state.view = 'statement';
  render();
}

function handleRetryLoad(): void {
  loadTransactions();
}

/**
 * Punto de integración con `mountNewTransactionView`. Hace el ciclo
 * completo leer → agregar → escribir usando exclusivamente los módulos
 * de `storage.ts`, sin ningún wrapper nuevo de localStorage.
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
  state.selectedMonthKey = getMonthKeyFromDate(draft.date);
  state.view = 'statement';
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
