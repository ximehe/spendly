import { CATEGORIES, getCategoryLabel } from './categories.js';
import { getMonthKeyFromDate } from './dates.js';
import { formatAmountUYU } from './format-amount.js';
import { getSignedAmount, roundToCents } from './transactions.js';
import {
  formatDayHeading,
  formatMonthNameLowercase,
  formatMonthShortLabel,
  formatMonthTitle,
  getAvailableMonthKeys,
  isFutureMonthKey,
} from './month.js';
import type { CategoryId, Transaction } from './types';

export interface StatementViewProps {
  readonly isLoading: boolean;
  readonly loadError: boolean;
  readonly transactions: readonly Transaction[];
  readonly selectedMonthKey: string;
  readonly categoryFilter: CategoryId | null;
  readonly pendingDeleteId: string | null;
  readonly deleteError: { readonly id: string; readonly message: string } | null;
  /**
   * Indica a qué movimiento devolver el foco después de este render,
   * cuando corresponde (cancelar una confirmación, o un intento de
   * borrado fallido). `null` en cualquier otro caso: no todos los
   * re-renders deben mover el foco.
   */
  readonly focusTriggerId: string | null;
  /** Devuelve el foco al botón "Editar" de ese movimiento (cancelar edición, o guardado exitoso si sigue visible). */
  readonly focusEditTriggerId: string | null;
  /** Devuelve el foco al ítem del índice de ese mes (tras seleccionarlo). */
  readonly focusMonthKey: string | null;
  /** Devuelve el foco al botón de esa categoría en "Por categoría" (tras filtrar/des-filtrar con ese botón). */
  readonly focusCategoryId: CategoryId | null;
  /**
   * Señal de un solo uso para cuando el elemento que tenía el foco ya no
   * existe y no hay un elemento puntual al cual devolverlo (guardado
   * exitoso, borrado exitoso, edición que cambió de mes, o "Quitar
   * filtro" vía la línea de estado). Se ubica el foco en un punto lógico
   * cercano en vez de perderlo en `body`. También actúa como respaldo si
   * `focusEditTriggerId` apunta a un movimiento que ya no está visible
   * en este mes.
   */
  readonly focusFallback: boolean;
  readonly onSelectMonth: (monthKey: string) => void;
  readonly onAddTransaction: (originMonthKey: string, initialCategoryId?: CategoryId) => void;
  readonly onRetryLoad: () => void;
  readonly onSetCategoryFilter: (categoryId: CategoryId) => void;
  readonly onClearCategoryFilter: () => void;
  readonly onEditTransaction: (transactionId: string) => void;
  readonly onRequestDelete: (transactionId: string) => void;
  readonly onCancelDelete: (transactionId: string) => void;
  readonly onConfirmDelete: (transactionId: string) => void;
}

function formatSignedAmount(transaction: Transaction): string {
  const prefix = transaction.type === 'expense' ? '–$U ' : '+$U ';
  return `${prefix}${formatAmountUYU(transaction.amount)}`;
}

function computeGlobalBalance(transactions: readonly Transaction[]): number {
  return roundToCents(transactions.reduce((sum, t) => sum + getSignedAmount(t), 0));
}

interface DayGroup {
  readonly date: string;
  readonly transactions: Transaction[];
}

/** Agrupa por día (orden descendente) y, dentro de cada día, por createdAt descendente. */
function groupByDayDescending(monthTransactions: readonly Transaction[]): DayGroup[] {
  const byDate = new Map<string, Transaction[]>();
  for (const transaction of monthTransactions) {
    const existing = byDate.get(transaction.date);
    if (existing) {
      existing.push(transaction);
    } else {
      byDate.set(transaction.date, [transaction]);
    }
  }

  const groups: DayGroup[] = Array.from(byDate.entries()).map(([date, txs]) => ({
    date,
    transactions: [...txs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
  }));

  return groups.sort((a, b) => (a.date < b.date ? 1 : -1));
}

interface CategorySummaryRow {
  readonly id: CategoryId;
  readonly label: string;
  readonly signedTotal: number;
}

/** Solo categorías con al menos un movimiento ese mes, en el orden fijo de CATEGORIES. */
function computeCategorySummary(monthTransactions: readonly Transaction[]): CategorySummaryRow[] {
  const rows: CategorySummaryRow[] = [];
  for (const category of CATEGORIES) {
    const matching = monthTransactions.filter((t) => t.category === category.id);
    if (matching.length === 0) continue;
    rows.push({
      id: category.id,
      label: category.label,
      signedTotal: roundToCents(matching.reduce((sum, t) => sum + getSignedAmount(t), 0)),
    });
  }
  return rows;
}

function formatSignedTotal(total: number): string {
  const prefix = total < 0 ? '–$U ' : '+$U ';
  return `${prefix}${formatAmountUYU(Math.abs(total))}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function renderStatement(container: HTMLElement, props: StatementViewProps): void {
  const balanceHtml = renderBalanceStrip(props);
  const bodyHtml = props.isLoading || props.loadError
    ? '' // el contenido de carga/error ya está resuelto dentro del balance; el cuerpo se simplifica abajo
    : renderLayout(props);

  container.innerHTML = `
    <div class="page">
      ${balanceHtml}
      ${props.isLoading ? renderLoadingBody() : props.loadError ? renderErrorBody() : bodyHtml}
    </div>
  `;

  wireInteractions(container, props);
  applyFocusManagement(container, props);
}

/**
 * Manejo explícito de foco tras eliminar, editar o navegar. El DOM se
 * reemplaza entero en cada render (`container.innerHTML = ...`), así
 * que cualquier elemento que tenía el foco deja de existir y el
 * navegador lo devuelve a `body` si no hacemos nada — hay que ubicar el
 * foco a mano en un lugar lógico en vez de dejar que se pierda.
 *
 * Prioridad (la primera que encuentra un elemento real gana):
 * 1. Confirmación de borrado recién abierta → su botón "Eliminar".
 * 2. Confirmación cancelada, o borrado fallido → el disparador
 *    "Eliminar" de esa misma fila.
 * 3. Edición cancelada, o guardado de edición exitoso → el botón
 *    "Editar" de ese movimiento, si sigue visible en este mes.
 * 4. Selección de mes → el ítem de índice de ese mes.
 * 5. Filtro aplicado/quitado con un botón de categoría → ese botón.
 * 6. Respaldo genérico → "Agregar movimiento" si está visible, o el
 *    título del mes como último recurso. Sirve tanto como señal directa
 *    (guardar, eliminar, "Quitar filtro") como respaldo automático
 *    cuando el objetivo de `focusEditTriggerId` ya no está visible
 *    (el movimiento editado cambió de mes).
 * En cualquier otro render (cambiar de mes sin motivo, etc.) no se toca
 * el foco en absoluto: todas las señales llegan en `null`/`false`.
 */
function applyFocusManagement(container: HTMLElement, props: StatementViewProps): void {
  // Se busca por comparación directa de `dataset` en vez de interpolar el
  // id dentro de un selector CSS: evita que un valor inesperado (por
  // ejemplo, un `id` corrupto en localStorage editado a mano) rompa el
  // selector o se interprete como parte de él.
  function findByDataset(
    selector: string,
    key: 'txId' | 'monthKey' | 'categoryId',
    value: string,
  ): HTMLElement | undefined {
    return Array.from(container.querySelectorAll<HTMLElement>(selector)).find(
      (el) => el.dataset[key] === value,
    );
  }

  function tryFocus(el: HTMLElement | undefined): boolean {
    if (!el) return false;
    el.focus();
    return true;
  }

  if (props.pendingDeleteId) {
    tryFocus(findByDataset('[data-action="confirm-delete"]', 'txId', props.pendingDeleteId));
    return;
  }

  if (props.focusTriggerId) {
    tryFocus(findByDataset('[data-action="request-delete"]', 'txId', props.focusTriggerId));
    return;
  }

  let focused = false;

  if (props.focusEditTriggerId) {
    focused = tryFocus(findByDataset('[data-action="edit-transaction"]', 'txId', props.focusEditTriggerId));
  }

  if (!focused && props.focusMonthKey) {
    focused = tryFocus(findByDataset('.index-item', 'monthKey', props.focusMonthKey));
  }

  if (!focused && props.focusCategoryId) {
    focused = tryFocus(findByDataset('[data-action="set-filter"]', 'categoryId', props.focusCategoryId));
  }

  if (!focused && props.focusFallback) {
    focused = tryFocus(container.querySelector<HTMLElement>('[data-action="add-transaction"]') ?? undefined);
    if (!focused) {
      // El mes quedó sin movimientos: no hay fila ni acción persistente
      // cerca. El título del mes no es foco-able por defecto; se habilita
      // puntualmente como último recurso.
      const title = container.querySelector<HTMLElement>('.month-title');
      if (title) {
        title.setAttribute('tabindex', '-1');
        title.focus();
      }
    }
  }
}

function renderBalanceStrip(props: StatementViewProps): string {
  const monthLabel = formatMonthNameLowercase(props.selectedMonthKey);

  let balanceValueHtml: string;
  if (props.isLoading) {
    balanceValueHtml = `
      <p class="balance-amount" aria-hidden="true">$U &middot;&middot;&middot;</p>
      <span class="sr-only">Cargando saldo</span>
    `;
  } else if (props.loadError) {
    balanceValueHtml = `<p class="balance-amount">$U —</p>`;
  } else {
    const globalBalance = computeGlobalBalance(props.transactions);
    const sign = globalBalance < 0 ? '–' : '';
    balanceValueHtml = `<p class="balance-amount">${sign}$U ${formatAmountUYU(Math.abs(globalBalance))}</p>`;
  }

  return `
    <header class="balance-strip">
      <div class="balance-main">
        <p class="balance-label">Saldo, ${escapeHtml(monthLabel)}</p>
        ${balanceValueHtml}
      </div>
    </header>
  `;
}

function renderLoadingBody(): string {
  return `
    <div class="statement-body" aria-live="polite">
      <p class="empty-state__primary">Cargando movimientos…</p>
    </div>
  `;
}

function renderErrorBody(): string {
  return `
    <div class="statement-body" aria-live="polite">
      <p class="empty-state__primary">No se pudieron cargar los movimientos.</p>
      <p class="empty-state__secondary">Puede ser un problema de conexión.</p>
      <button type="button" class="action-link action-link--add" data-action="retry-load">Reintentar</button>
    </div>
  `;
}

function renderLayout(props: StatementViewProps): string {
  const monthKey = props.selectedMonthKey;
  const monthTransactions = props.transactions.filter(
    (t) => getMonthKeyFromDate(t.date) === monthKey,
  );
  const isFuture = isFutureMonthKey(monthKey);
  const isFirstEverEmpty = props.transactions.length === 0;
  const monthTitle = formatMonthTitle(monthKey);

  const showPersistentAddAction = monthTransactions.length > 0;

  const activeFilter = props.categoryFilter;
  const filteredTransactions = activeFilter
    ? monthTransactions.filter((t) => t.category === activeFilter)
    : monthTransactions;

  let filterStatusHtml = '';
  let mainContentHtml: string;

  if (isFuture) {
    mainContentHtml = `
      <div class="statement-body" aria-live="polite">
        <p class="empty-state__primary">Todavía no llegó ${escapeHtml(formatMonthNameLowercase(monthKey))}.</p>
      </div>
    `;
  } else if (isFirstEverEmpty) {
    mainContentHtml = `
      <div class="statement-body" aria-live="polite">
        <p class="empty-state__primary">No hay movimientos registrados todavía.</p>
        <p class="empty-state__secondary">Cuando cargues el primero, va a aparecer acá agrupado por fecha.</p>
        <button type="button" class="action-link action-link--add" data-action="add-transaction">Agregar el primer movimiento</button>
      </div>
    `;
  } else if (monthTransactions.length === 0) {
    mainContentHtml = `
      <div class="statement-body" aria-live="polite">
        <p class="empty-state__primary">No se registraron movimientos en ${escapeHtml(formatMonthNameLowercase(monthKey))}.</p>
        <p class="empty-state__secondary">El saldo no cambió este mes.</p>
        <button type="button" class="action-link action-link--add" data-action="add-transaction">Agregar un movimiento en ${escapeHtml(formatMonthNameLowercase(monthKey))}</button>
      </div>
    `;
  } else if (activeFilter && filteredTransactions.length === 0) {
    // El mes tiene movimientos, pero ninguno coincide con el filtro activo
    // (por ejemplo, se acaba de eliminar el último de esa categoría).
    filterStatusHtml = renderFilterStatus(activeFilter);
    mainContentHtml = `
      <div class="statement-body" aria-live="polite">
        <p class="empty-state__primary">No hay movimientos de ${escapeHtml(getCategoryLabel(activeFilter))} este mes.</p>
        <button type="button" class="action-link action-link--add" data-action="clear-filter">Quitar filtro</button>
      </div>
    `;
  } else {
    if (activeFilter) {
      filterStatusHtml = renderFilterStatus(activeFilter);
    }
    const groups = groupByDayDescending(filteredTransactions);
    mainContentHtml = `
      <div class="statement-body" aria-live="polite">
        ${groups.map((group) => renderDayGroup(group, props)).join('')}
      </div>
    `;
  }

  // El resumen por categoría y las categorías filtrables siempre se
  // calculan sobre el mes completo, nunca sobre el resultado filtrado.
  const categorySummaryRows = isFuture ? [] : computeCategorySummary(monthTransactions);
  const categorySummaryHtml = renderCategorySummary(categorySummaryRows, isFirstEverEmpty, activeFilter);
  const monthIndexHtml = renderMonthIndex(props.transactions, monthKey);

  return `
    <div class="layout">
      <main class="statement">
        <div class="month-header">
          <h1 class="month-title">${escapeHtml(monthTitle)}</h1>
          ${showPersistentAddAction ? '<button type="button" class="action-link action-link--add" data-action="add-transaction">Agregar movimiento</button>' : ''}
        </div>
        ${filterStatusHtml}
        ${mainContentHtml}
      </main>

      <aside class="index-nav" aria-label="Índice de meses y categorías">
        ${monthIndexHtml}
        ${categorySummaryHtml}
      </aside>
    </div>
  `;
}

function renderFilterStatus(categoryId: CategoryId): string {
  return `
    <div class="filter-status">
      <span class="filter-status__text">Filtrando por: ${escapeHtml(getCategoryLabel(categoryId))}</span>
      <button type="button" class="action-link action-link--add" data-action="clear-filter">Quitar filtro</button>
    </div>
  `;
}

function renderDayGroup(group: DayGroup, props: StatementViewProps): string {
  return `
    <section class="day-group">
      <h2 class="day-heading">${escapeHtml(formatDayHeading(group.date))}</h2>
      <ul class="tx-list">
        ${group.transactions.map((transaction) => renderTransactionRow(transaction, props)).join('')}
      </ul>
    </section>
  `;
}

function renderTransactionRow(transaction: Transaction, props: StatementViewProps): string {
  const amountClass = transaction.type === 'income' ? 'income' : 'expense';
  const isPending = props.pendingDeleteId === transaction.id;
  const hasError = props.deleteError?.id === transaction.id;
  const suppressBorder = isPending || hasError;
  // `id` sale de localStorage: en uso normal siempre es un UUID generado
  // por la propia app, pero nada impide que alguien edite el storage a
  // mano. Se escapa igual que cualquier otro dato dinámico antes de
  // interpolarlo en un atributo.
  const safeId = escapeHtml(transaction.id);

  const rowHtml = `
    <li class="tx-row${suppressBorder ? ' tx-row--no-border' : ''}">
      <div class="tx-info">
        <p class="tx-desc">${escapeHtml(transaction.description)}</p>
        <p class="tx-category">${escapeHtml(getCategoryLabel(transaction.category))}</p>
      </div>
      <span class="tx-amount ${amountClass}">${formatSignedAmount(transaction)}</span>
      <button type="button" class="tx-edit" data-action="edit-transaction" data-tx-id="${safeId}">Editar</button>
      <button type="button" class="tx-delete" data-action="request-delete" data-tx-id="${safeId}">Eliminar</button>
    </li>
  `;

  if (isPending) {
    return `
      ${rowHtml}
      <li class="tx-confirm">
        <p class="tx-confirm__text">¿Eliminar este movimiento?</p>
        <div class="tx-confirm__actions">
          <button type="button" class="action-link action-link--save" data-action="confirm-delete" data-tx-id="${safeId}">Eliminar</button>
          <button type="button" class="action-link action-link--cancel" data-action="cancel-delete" data-tx-id="${safeId}">Cancelar</button>
        </div>
      </li>
    `;
  }

  if (hasError) {
    return `
      ${rowHtml}
      <li class="tx-confirm" aria-live="polite">
        <p class="tx-confirm__text tx-confirm__text--error">No se pudo eliminar el movimiento. Intentá de nuevo.</p>
      </li>
    `;
  }

  return rowHtml;
}

function renderCategorySummary(
  rows: CategorySummaryRow[],
  isFirstEverEmpty: boolean,
  activeFilter: CategoryId | null,
): string {
  let bodyHtml: string;
  if (rows.length > 0) {
    bodyHtml = `
      <ul class="category-list">
        ${rows.map((row) => {
          const isActive = row.id === activeFilter;
          return `
            <li class="category-row">
              <button
                type="button"
                class="category-name category-name--filterable"
                data-action="set-filter"
                data-category-id="${row.id}"
                ${isActive ? 'aria-current="true"' : ''}
              >${escapeHtml(row.label)}</button>
              <span class="category-amount ${row.signedTotal < 0 ? 'expense' : 'income'}">${formatSignedTotal(row.signedTotal)}</span>
            </li>
          `;
        }).join('')}
      </ul>
    `;
  } else if (isFirstEverEmpty) {
    bodyHtml = `<p class="empty-state__secondary">Todavía no hay categorías con movimientos.</p>`;
  } else {
    bodyHtml = `<p class="empty-state__secondary">Sin movimientos por categoría este mes.</p>`;
  }

  return `
    <p class="index-title">Por categoría</p>
    ${bodyHtml}
  `;
}

function renderMonthIndex(transactions: readonly Transaction[], selectedMonthKey: string): string {
  const months = getAvailableMonthKeys(transactions);
  return `
    <p class="index-title">Índice</p>
    <ul class="index-list">
      ${months.map((monthKey) => `
        <li>
          <a
            class="index-item"
            href="#"
            data-month-key="${escapeHtml(monthKey)}"
            ${monthKey === selectedMonthKey ? 'aria-current="page"' : ''}
          >${escapeHtml(formatMonthShortLabel(monthKey))}</a>
        </li>
      `).join('')}
    </ul>
  `;
}

function wireInteractions(container: HTMLElement, props: StatementViewProps): void {
  container.querySelectorAll<HTMLAnchorElement>('.index-item').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const monthKey = link.dataset['monthKey'];
      if (monthKey) {
        props.onSelectMonth(monthKey);
      }
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="add-transaction"]').forEach((button) => {
    button.addEventListener('click', () => {
      props.onAddTransaction(props.selectedMonthKey, props.categoryFilter ?? undefined);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="retry-load"]').forEach((button) => {
    button.addEventListener('click', () => {
      props.onRetryLoad();
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="set-filter"]').forEach((button) => {
    button.addEventListener('click', () => {
      const categoryId = button.dataset['categoryId'] as CategoryId | undefined;
      if (categoryId) {
        props.onSetCategoryFilter(categoryId);
      }
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="clear-filter"]').forEach((button) => {
    button.addEventListener('click', () => {
      props.onClearCategoryFilter();
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="edit-transaction"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset['txId'];
      if (id) props.onEditTransaction(id);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="request-delete"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset['txId'];
      if (id) props.onRequestDelete(id);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="cancel-delete"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset['txId'];
      if (id) props.onCancelDelete(id);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="confirm-delete"]').forEach((button) => {
    button.addEventListener('click', () => {
      const id = button.dataset['txId'];
      if (id) props.onConfirmDelete(id);
    });
  });
}
