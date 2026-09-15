import { CATEGORIES, getCategoryLabel } from './categories.js';
import { getMonthKeyFromDate } from './dates.js';
import { formatAmountUYU } from './format-amount.js';
import { getSignedAmount } from './transactions.js';
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
  readonly onSelectMonth: (monthKey: string) => void;
  readonly onAddTransaction: (originMonthKey: string) => void;
  readonly onRetryLoad: () => void;
}

function formatSignedAmount(transaction: Transaction): string {
  const prefix = transaction.type === 'expense' ? '–$U ' : '+$U ';
  return `${prefix}${formatAmountUYU(transaction.amount)}`;
}

function computeGlobalBalance(transactions: readonly Transaction[]): number {
  return transactions.reduce((sum, t) => sum + getSignedAmount(t), 0);
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
      signedTotal: matching.reduce((sum, t) => sum + getSignedAmount(t), 0),
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
  } else {
    const groups = groupByDayDescending(monthTransactions);
    mainContentHtml = `
      <div class="statement-body" aria-live="polite">
        ${groups.map(renderDayGroup).join('')}
      </div>
    `;
  }

  const categorySummary = isFuture ? [] : computeCategorySummary(monthTransactions);
  const categorySummaryHtml = renderCategorySummary(categorySummary, isFirstEverEmpty);
  const monthIndexHtml = renderMonthIndex(props.transactions, monthKey);

  return `
    <div class="layout">
      <main class="statement">
        <div class="month-header">
          <h1 class="month-title">${escapeHtml(monthTitle)}</h1>
          ${showPersistentAddAction ? '<button type="button" class="action-link action-link--add" data-action="add-transaction">Agregar movimiento</button>' : ''}
        </div>
        ${mainContentHtml}
      </main>

      <aside class="index-nav" aria-label="Índice de meses y categorías">
        ${monthIndexHtml}
        ${categorySummaryHtml}
      </aside>
    </div>
  `;
}

function renderDayGroup(group: DayGroup): string {
  return `
    <section class="day-group">
      <h2 class="day-heading">${escapeHtml(formatDayHeading(group.date))}</h2>
      <ul class="tx-list">
        ${group.transactions.map(renderTransactionRow).join('')}
      </ul>
    </section>
  `;
}

function renderTransactionRow(transaction: Transaction): string {
  const amountClass = transaction.type === 'income' ? 'income' : 'expense';
  return `
    <li class="tx-row">
      <div class="tx-info">
        <p class="tx-desc">${escapeHtml(transaction.description)}</p>
        <p class="tx-category">${escapeHtml(getCategoryLabel(transaction.category))}</p>
      </div>
      <span class="tx-amount ${amountClass}">${formatSignedAmount(transaction)}</span>
    </li>
  `;
}

function renderCategorySummary(rows: CategorySummaryRow[], isFirstEverEmpty: boolean): string {
  let bodyHtml: string;
  if (rows.length > 0) {
    bodyHtml = `
      <ul class="category-list">
        ${rows.map(
          (row) => `
            <li class="category-row">
              <span class="category-name">${escapeHtml(row.label)}</span>
              <span class="category-amount ${row.signedTotal < 0 ? 'expense' : 'income'}">${formatSignedTotal(row.signedTotal)}</span>
            </li>
          `,
        ).join('')}
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
            data-month-key="${monthKey}"
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
      props.onAddTransaction(props.selectedMonthKey);
    });
  });

  container.querySelectorAll<HTMLButtonElement>('[data-action="retry-load"]').forEach((button) => {
    button.addEventListener('click', () => {
      props.onRetryLoad();
    });
  });
}
