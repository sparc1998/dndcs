// Pure rendering and data-manipulation utilities, exported as an ES module.
// No DOM access — safe to import in Node.js for unit tests.

// Escapes <, >, &, and " so raw user text can be safely injected as innerHTML.
export function escHtml(s) {
  return s.replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c]));
}

// Strips {comment} blocks from a formula string before evaluation.
export function stripFormulaComments(raw) {
  return raw.replace(/\{[^}]*\}/g, "");
}

// Evaluates a numeric formula (supports + - * / and parentheses).
// Returns the numeric result as a string, or the raw escaped text on error.
export function renderFormula(raw) {
  const expr = stripFormulaComments(raw).trim();
  if (!expr) return "";
  if (!/^[\d\s+\-*/().]+$/.test(expr)) return escHtml(raw);
  try {
    // eslint-disable-next-line no-new-func
    const result = new Function("return (" + expr + ")")();
    if (typeof result !== "number" || !isFinite(result)) return escHtml(raw);
    return String(result % 1 === 0 ? result : parseFloat(result.toFixed(10)));
  } catch {
    return escHtml(raw);
  }
}

// Renders inline markup: [label](url) links, **bold**, and _italic_.
// Text outside any markup is HTML-escaped.
export function renderInline(raw) {
  const re = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)|\*\*([^*]+)\*\*|_([^_]+)_/g;
  let result = "";
  let last = 0;
  let m;
  while ((m = re.exec(raw)) !== null) {
    result += escHtml(raw.slice(last, m.index));
    if (m[1] !== undefined) {
      result += `<a href="${escHtml(m[2])}" target="_blank" rel="noopener noreferrer">${renderInline(m[1])}</a>`;
    } else if (m[3] !== undefined) {
      result += `<strong>${renderInline(m[3])}</strong>`;
    } else {
      result += `<em>${renderInline(m[4])}</em>`;
    }
    last = m.index + m[0].length;
  }
  result += escHtml(raw.slice(last));
  return result;
}

// Renders raw text with link, bullet-point, and numbered-list formatting.
// Lines starting with "* " become <ul><li> elements.
// Lines starting with "<digits>) " become <ol><li> elements (any number works).
// Consecutive lines of the same list type are grouped together.
// <br> is only inserted between two non-block parts so lists don't add extra
// whitespace; use a blank line in the source to get intentional extra spacing.
export function renderFormatted(raw) {
  const lines = raw.split('\n');
  const parts = [];
  let listItems = [];
  let listType = null;

  const flushList = () => {
    if (listItems.length) {
      parts.push(`<${listType}>` + listItems.map(t => `<li>${t}</li>`).join('') + `</${listType}>`);
      listItems = [];
      listType = null;
    }
  };

  for (const line of lines) {
    if (line.startsWith('* ')) {
      if (listType !== 'ul') flushList();
      listType = 'ul';
      listItems.push(renderInline(line.slice(2)));
    } else if (/^\d+\) /.test(line)) {
      if (listType !== 'ol') flushList();
      listType = 'ol';
      listItems.push(renderInline(line.replace(/^\d+\) /, '')));
    } else {
      flushList();
      parts.push(renderInline(line));
    }
  }
  flushList();

  const isBlock = s => s.startsWith('<ul>') || s.startsWith('<ol>');
  let html = '';
  for (let i = 0; i < parts.length; i++) {
    if (i > 0 && !isBlock(parts[i - 1]) && !isBlock(parts[i])) html += '<br>';
    html += parts[i];
  }
  return html;
}

const _isSeparator = line => /^-{3,}\s*$/.test(line);

// Splits raw text into two columns at the "---"-or-more line closest to the
// character midpoint. All separator lines are stripped from both halves.
// Falls back to a single column if no separator is present.
export function render2Col(raw) {
  if (!raw.trim()) return '';
  const lines = raw.split('\n');
  const mid = raw.length / 2;
  let splitIdx = -1;
  let bestDist = Infinity;
  let charOffset = 0;
  for (let i = 0; i < lines.length; i++) {
    if (_isSeparator(lines[i])) {
      const dist = Math.abs(charOffset + lines[i].length / 2 - mid);
      if (dist < bestDist) { bestDist = dist; splitIdx = i; }
    }
    charOffset += lines[i].length + 1;
  }
  const renderHalf = arr => {
    const lines = [...arr];
    while (lines.length && (lines[lines.length - 1] === '' || _isSeparator(lines[lines.length - 1]))) lines.pop();
    const segments = [];
    let cur = [];
    for (const line of lines) {
      if (_isSeparator(line)) { segments.push(cur); cur = []; }
      else cur.push(line);
    }
    segments.push(cur);
    return segments.map(s => renderFormatted(s.join('\n'))).join('<hr class="col-rule">');
  };
  if (splitIdx === -1) {
    return `<div class="two-col-single">${renderHalf(lines)}</div>`;
  }
  return `<div class="two-col-left">${renderHalf(lines.slice(0, splitIdx))}</div>` +
    `<div class="two-col-right">${renderHalf(lines.slice(splitIdx + 1))}</div>`;
}

// Moves the item at fromIdx to a new position relative to targetIdx.
// isAbove=true inserts before targetIdx; false inserts after.
// Returns a new array; does not mutate the input.
export function reorderItem(arr, fromIdx, targetIdx, isAbove) {
  if (fromIdx === targetIdx) return [...arr];
  const result = [...arr];
  const [moved] = result.splice(fromIdx, 1);
  const insertAt = isAbove
    ? (fromIdx < targetIdx ? targetIdx - 1 : targetIdx)
    : (fromIdx < targetIdx ? targetIdx : targetIdx + 1);
  result.splice(insertAt, 0, moved);
  return result;
}
