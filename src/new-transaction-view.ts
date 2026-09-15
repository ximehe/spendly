import { CATEGORIES, DEFAULT_CATEGORY_ID } from './categories.js';
import { getTodayISODate, resolveDateForMonth } from './dates.js';
import { parseAmountInput, formatAmountUYU, sanitizeAmountInputChars } from './format-amount.js';
import { validateNewTransactionForm } from './validation.js';
import type { Transaction, TransactionType, CategoryId } from './types';

/**
 * Nota sobre imports: este archivo sí importa valores en tiempo de
 * ejecución (CATEGORIES, getTodayISODate, etc.), a diferencia de la
 * Etapa 1 donde todos los imports cruzados eran `import type` y se
 * borraban al compilar. Por eso acá los imports relativos llevan
 * extensión '.js' explícita: es lo que permite que el JS compilado se
 * cargue como módulo nativo en el navegador sin bundler. Los imports
 * `import type` (como el de abajo) no la necesitan porque desaparecen
 * del JS emitido.
 */

export interface NewTransactionViewOptions {
  /**
   * Mes de origen desde el que se abre el formulario, ej. '2026-08'.
   * Si no se indica, se asume que se abrió desde el mes actual y la
   * fecha inicial es hoy. Si se indica un mes pasado, la fecha inicial
   * se resuelve con `resolveDateForMonth` (mismo día del mes si existe,
   * si no el último día válido).
   */
  readonly originMonthKey?: string;

  /** Se llama cuando el usuario cancela. Sin confirmación. */
  readonly onCancel: () => void;

  /**
   * Punto de integración con la persistencia real (Etapa 3). Se llama con
   * un objeto ya completo y compatible con `Transaction` cuando el
   * formulario es válido.
   *
   * Devuelve `true` si el guardado se resolvió con éxito (en ese caso
   * quien llama es responsable de desmontar/reemplazar esta vista y
   * navegar; esta vista no hace nada más). Devuelve `false` si falló el
   * guardado (por ejemplo, un `StorageWriteError`): en ese caso la vista
   * permanece montada, con todos los datos intactos, y muestra el
   * mensaje de error general ya definido.
   */
  readonly onSubmit: (draft: Transaction) => boolean;
}

function createTransactionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback defensivo; no debería ejecutarse en navegadores modernos.
  return `tmp-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Monta la vista "Nuevo movimiento" dentro de `container`, reemplazando
 * su contenido. No hace nada con `localStorage` ni con navegación real:
 * ambas quedan delegadas a los callbacks de `options`.
 */
export function mountNewTransactionView(
  container: HTMLElement,
  options: NewTransactionViewOptions,
): void {
  const today = getTodayISODate();
  const initialDate = options.originMonthKey
    ? resolveDateForMonth(today, options.originMonthKey)
    : today;

  const categoryOptionsHtml = CATEGORIES.map(
    (category) =>
      `<option value="${category.id}"${category.id === DEFAULT_CATEGORY_ID ? ' selected' : ''}>${category.label}</option>`,
  ).join('');

  container.innerHTML = `
    <div class="new-tx">
      <h1 class="new-tx__title">Nuevo movimiento</h1>

      <form class="new-tx__form" novalidate>
        <fieldset class="field field--type">
          <legend class="field__label">Tipo</legend>
          <div class="type-options">
            <label class="type-option">
              <input type="radio" name="type" value="income" />
              <span>Ingreso</span>
            </label>
            <label class="type-option">
              <input type="radio" name="type" value="expense" checked />
              <span>Gasto</span>
            </label>
          </div>
        </fieldset>

        <div class="field field--amount">
          <label class="field__label" for="tx-amount">Monto</label>
          <div class="amount-input">
            <span class="amount-input__prefix" aria-hidden="true">$U</span>
            <input
              id="tx-amount"
              type="text"
              inputmode="decimal"
              placeholder="0,00"
              autocomplete="off"
              aria-label="Monto en pesos uruguayos"
              aria-describedby="tx-amount-error"
            />
          </div>
          <p class="field__error" id="tx-amount-error" role="alert" hidden></p>
        </div>

        <div class="field field--description">
          <label class="field__label" for="tx-description">Descripción</label>
          <input
            id="tx-description"
            type="text"
            placeholder="Supermercado, sueldo, factura de UTE…"
            maxlength="160"
            aria-describedby="tx-description-error"
          />
          <p class="field__error" id="tx-description-error" role="alert" hidden></p>
        </div>

        <div class="field field--category">
          <label class="field__label" for="tx-category">Categoría</label>
          <select id="tx-category">
            ${categoryOptionsHtml}
          </select>
        </div>

        <div class="field field--date">
          <label class="field__label" for="tx-date">Fecha</label>
          <input
            id="tx-date"
            type="date"
            value="${initialDate}"
            max="${today}"
            aria-describedby="tx-date-error"
          />
          <p class="field__error" id="tx-date-error" role="alert" hidden></p>
        </div>

        <div class="new-tx__actions">
          <button type="button" class="action-link action-link--cancel">Cancelar</button>
          <button type="submit" class="action-link action-link--save">Guardar</button>
        </div>

        <p class="new-tx__save-error" id="tx-save-error" aria-live="polite" hidden></p>
      </form>
    </div>
  `;

  const form = container.querySelector<HTMLFormElement>('.new-tx__form');
  const amountInput = container.querySelector<HTMLInputElement>('#tx-amount');
  const amountError = container.querySelector<HTMLParagraphElement>('#tx-amount-error');
  const descriptionInput = container.querySelector<HTMLInputElement>('#tx-description');
  const descriptionError = container.querySelector<HTMLParagraphElement>('#tx-description-error');
  const categorySelect = container.querySelector<HTMLSelectElement>('#tx-category');
  const dateInput = container.querySelector<HTMLInputElement>('#tx-date');
  const dateError = container.querySelector<HTMLParagraphElement>('#tx-date-error');
  const cancelButton = container.querySelector<HTMLButtonElement>('.action-link--cancel');
  const saveError = container.querySelector<HTMLParagraphElement>('#tx-save-error');
  const typeRadios = Array.from(
    container.querySelectorAll<HTMLInputElement>('input[type="radio"]'),
  );

  if (
    !form || !amountInput || !amountError || !descriptionInput || !descriptionError ||
    !categorySelect || !dateInput || !dateError || !cancelButton || !saveError
  ) {
    // No debería ocurrir: el markup de arriba es fijo. Se deja como
    // guarda defensiva para que TypeScript no obligue a usar '!' en cada línea.
    throw new Error('No se pudo inicializar la vista "Nuevo movimiento".');
  }

  function getSelectedType(): TransactionType {
    const checked = typeRadios.find((radio) => radio.checked);
    return checked?.value === 'income' ? 'income' : 'expense';
  }

  // El texto crudo que el usuario escribe vive únicamente en
  // amountInput.value. Mientras se tipea, solo se descartan caracteres
  // inválidos (letras, signo menos, etc.) — nunca se reemplaza por el
  // número parseado ni se reformatea en cada tecla, para no interrumpir
  // la edición. El valor parseado (number | null) se calcula on-demand
  // a partir de ese texto recién en el blur y en el submit.
  amountInput.addEventListener('input', () => {
    const cursorAtEnd = amountInput.selectionStart === amountInput.value.length;
    const sanitized = sanitizeAmountInputChars(amountInput.value);
    if (sanitized !== amountInput.value) {
      amountInput.value = sanitized;
      if (cursorAtEnd) {
        amountInput.setSelectionRange(sanitized.length, sanitized.length);
      }
    }
    // Limpia solo el error de este campo al volver a editarlo. No revalida
    // de nuevo (podría seguir siendo inválido); simplemente deja de mostrar
    // el mensaje viejo hasta el próximo submit.
    clearFieldError(amountInput, amountError);
  });

  // Recién acá se normaliza la presentación al formato uruguayo, y solo
  // si el texto escrito es interpretable como un número.
  amountInput.addEventListener('blur', () => {
    const parsed = parseAmountInput(amountInput.value);
    if (parsed !== null) {
      amountInput.value = formatAmountUYU(parsed);
    }
  });

  // Mismo criterio para Descripción y Fecha: limpiar solo el error propio
  // de ese campo al empezar a editarlo, sin revalidar todo el formulario.
  descriptionInput.addEventListener('input', () => {
    clearFieldError(descriptionInput, descriptionError);
  });

  dateInput.addEventListener('input', () => {
    clearFieldError(dateInput, dateError);
  });

  function clearFieldError(input: HTMLInputElement, errorEl: HTMLParagraphElement): void {
    input.removeAttribute('aria-invalid');
    errorEl.hidden = true;
    errorEl.textContent = '';
    if (input === amountInput) {
      amountInput.closest('.amount-input')?.classList.remove('is-invalid');
    }
  }

  function setFieldError(
    input: HTMLInputElement,
    errorEl: HTMLParagraphElement,
    message: string,
  ): void {
    input.setAttribute('aria-invalid', 'true');
    errorEl.hidden = false;
    errorEl.textContent = message;
    if (input === amountInput) {
      amountInput.closest('.amount-input')?.classList.add('is-invalid');
    }
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();

    // Un nuevo intento de guardado limpia el error general anterior,
    // sin esperar a que se edite un campo puntual.
    saveError.hidden = true;
    saveError.textContent = '';

    const rawAmount = amountInput.value;
    const parsedAmount = parseAmountInput(rawAmount);
    const description = descriptionInput.value;
    const date = dateInput.value;
    const category = categorySelect.value as CategoryId;

    const errors = validateNewTransactionForm(
      { type: getSelectedType(), description, category, date },
      parsedAmount,
      today,
    );

    clearFieldError(amountInput, amountError);
    clearFieldError(descriptionInput, descriptionError);
    clearFieldError(dateInput, dateError);

    let firstInvalid: HTMLInputElement | null = null;

    if (errors.amount) {
      setFieldError(amountInput, amountError, errors.amount);
      firstInvalid = firstInvalid ?? amountInput;
    }
    if (errors.description) {
      setFieldError(descriptionInput, descriptionError, errors.description);
      firstInvalid = firstInvalid ?? descriptionInput;
    }
    if (errors.date) {
      setFieldError(dateInput, dateError, errors.date);
      firstInvalid = firstInvalid ?? dateInput;
    }

    if (firstInvalid) {
      // Los datos ingresados no se tocan: solo se marcan los campos
      // inválidos y se mueve el foco al primero, en orden de campos.
      firstInvalid.focus();
      return;
    }

    // A esta altura parsedAmount es un número > 0 garantizado por la validación.
    const draft: Transaction = {
      id: createTransactionId(),
      type: getSelectedType(),
      amount: parsedAmount as number,
      description: description.trim(),
      category,
      date,
      createdAt: new Date().toISOString(),
    };

    // Punto de integración con la persistencia real: si options.onSubmit
    // devuelve false, el guardado falló y esta vista se queda tal cual,
    // mostrando el motivo, sin perder nada de lo ya escrito.
    const saved = options.onSubmit(draft);
    if (!saved) {
      saveError.hidden = false;
      saveError.textContent =
        'No se pudo guardar el movimiento. Revisá los datos e intentá de nuevo.';
    }
  });

  cancelButton.addEventListener('click', () => {
    options.onCancel();
  });
}
