const OPERATORS = new Set(["+", "-", "*", "/"]);
const MAX_LENGTH = 48;

export function initialCalculator() {
  return { expression: "", result: "0", error: "", justEvaluated: false };
}

export function evaluate(expression) {
  const tokens = tokenize(expression);
  if (tokens.length === 0) throw new Error("Введите выражение");

  let index = 0;
  const peek = () => tokens[index];
  const take = () => tokens[index++];

  function parseExpression() {
    let left = parseTerm();
    while (peek() && (peek().type === "+" || peek().type === "-")) {
      const operator = take().type;
      if (isPercentAddition()) {
        const percent = take().value;
        take();
        const factor = percent / 100;
        left = operator === "+" ? left * (1 + factor) : left * (1 - factor);
      } else {
        const right = parseTerm();
        left = operator === "+" ? left + right : left - right;
      }
    }
    return left;
  }

  function isPercentAddition() {
    const number = tokens[index];
    const percent = tokens[index + 1];
    const after = tokens[index + 2];
    return number?.type === "number"
      && percent?.type === "%"
      && (!after || after.type === "+" || after.type === "-" || after.type === ")");
  }

  function parseTerm() {
    let left = parseFactor();
    while (peek() && (peek().type === "*" || peek().type === "/")) {
      const operator = take().type;
      const right = parseFactor();
      if (operator === "/") {
        if (right === 0) throw new Error("Деление на ноль");
        left /= right;
      } else {
        left *= right;
      }
    }
    return left;
  }

  function parseFactor() {
    if (peek()?.type === "+") {
      take();
      return parseFactor();
    }
    if (peek()?.type === "-") {
      take();
      return -parseFactor();
    }
    return applyPercent(parsePrimary());
  }

  function applyPercent(value) {
    let result = value;
    while (peek()?.type === "%") {
      take();
      result /= 100;
    }
    return result;
  }

  function parsePrimary() {
    const token = peek();
    if (!token) throw new Error("Неполное выражение");
    if (token.type === "number") {
      take();
      return token.value;
    }
    if (token.type === "(") {
      take();
      const value = parseExpression();
      if (peek()?.type !== ")") throw new Error("Нет закрывающей скобки");
      take();
      return value;
    }
    throw new Error("Неполное выражение");
  }

  const result = parseExpression();
  if (index !== tokens.length) throw new Error("Неполное выражение");
  return finish(result);
}

export function applyInput(state, key) {
  if (key === "clear") return initialCalculator();

  if (key === "back") {
    const source = state.justEvaluated ? state.result : state.expression;
    const expression = source.slice(0, -1);
    return {
      expression,
      result: currentOperand(expression),
      error: "",
      justEvaluated: false,
    };
  }

  if (key === "=") {
    if (!state.expression) return initialCalculator();
    try {
      const result = formatResult(evaluate(state.expression));
      return {
        expression: state.expression,
        result,
        error: "",
        justEvaluated: true,
        historyEntry: { expression: state.expression, result },
      };
    } catch (error) {
      return {
        ...state,
        error: error instanceof Error ? error.message : "Ошибка вычисления",
        justEvaluated: false,
      };
    }
  }

  const base = state.justEvaluated ? continuationBase(state, key) : state.expression;
  const expression = append(base, key);
  if (expression === base) return { ...state, error: "" };
  if (expression.length > MAX_LENGTH) {
    return { ...state, error: "Слишком длинное выражение" };
  }

  return {
    expression,
    result: currentOperand(expression),
    error: "",
    justEvaluated: false,
  };
}

export function currentOperand(expression) {
  if (!expression) return "0";

  let index = expression.length - 1;
  while (index >= 0 && "+-*/%()".includes(expression[index])) index -= 1;
  const end = index;
  while (index >= 0 && isNumberChar(expression[index])) index -= 1;

  let start = index + 1;
  if (expression[index] === "-") {
    const previous = index === 0 ? "" : expression[index - 1];
    if (index === 0 || "+-*/(".includes(previous)) start = index;
  }
  if (start > end) return "0";

  let text = expression.slice(start, end + 1);
  if (text.startsWith(".")) text = `0${text}`;
  return text || "0";
}

export function formatResult(value) {
  const text = Number(value).toFixed(10).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
}

export function formatExpression(expression) {
  return expression
    .replaceAll("*", "×")
    .replaceAll("/", "÷")
    .replaceAll(".", ",");
}

export function formatScreen(value) {
  if (!value) return "0";
  const negative = value.startsWith("-");
  const body = negative ? value.slice(1) : value;
  const [whole, fraction] = body.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
  const text = fraction !== undefined ? `${grouped},${fraction}` : grouped;
  return negative ? `-${text}` : text;
}

function continuationBase(state, key) {
  if (/^[0-9.]$/.test(key) || key === "(") return "";
  if ("+-*/%)".includes(key)) return state.result;
  return state.expression;
}

function append(expression, key) {
  if (/^[0-9]$/.test(key)) return appendDigit(expression, key);
  if (key === ".") return appendDot(expression);
  if (OPERATORS.has(key)) return appendOperator(expression, key);
  if (key === "%") return appendPercent(expression);
  if (key === "(") return appendOpen(expression);
  if (key === ")") return appendClose(expression);
  return expression;
}

function appendDigit(expression, digit) {
  let next = expression;
  if (/[)%]$/.test(next)) next += "*";
  if (/(?:^|[+\-*/(])0$/.test(next)) return next.slice(0, -1) + digit;
  const current = trailingNumber(next).replace(".", "");
  if (current.length >= 12) return expression;
  return next + digit;
}

function appendDot(expression) {
  let next = expression;
  if (/[)%]$/.test(next)) next += "*";
  const current = trailingNumber(next);
  if (current.includes(".")) return expression;
  return current === "" ? `${next}0.` : `${next}.`;
}

function appendOperator(expression, operator) {
  if (!expression) return operator === "-" ? "-" : expression;
  if (expression === "-") return expression;

  let next = expression;
  if (next.endsWith(".")) next += "0";
  if (next.endsWith("(")) return operator === "-" ? `${next}-` : expression;
  if (/[+\-*/]$/.test(next)) {
    if (operator === "-" && /[*/]$/.test(next)) return `${next}-`;
    return next.slice(0, -1) + operator;
  }
  return next + operator;
}

function appendPercent(expression) {
  if (!/[0-9)]$/.test(expression)) return expression;
  if (expression.endsWith("%")) return expression;
  const next = expression.endsWith(".") ? `${expression}0` : expression;
  return `${next}%`;
}

function appendOpen(expression) {
  if (!expression || /[+\-*/(]$/.test(expression)) return `${expression}(`;
  if (/[0-9)%]$/.test(expression)) return `${expression}*(`;
  return expression;
}

function appendClose(expression) {
  if (!expression || /[+\-*/(.]$/.test(expression)) return expression;
  const open = count(expression, "(");
  const close = count(expression, ")");
  if (close >= open) return expression;
  return `${expression})`;
}

function trailingNumber(expression) {
  const match = expression.match(/(\d*\.?\d*)$/);
  return match ? match[1] : "";
}

function tokenize(input) {
  const source = String(input).replace(/\s+/g, "");
  if (!source) return [];
  if (!/^[0-9+\-*/%().]+$/.test(source)) throw new Error("Недопустимый символ");

  const tokens = [];
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if ((char >= "0" && char <= "9") || char === ".") {
      let end = index + 1;
      let dots = char === "." ? 1 : 0;
      while (end < source.length && (isDigit(source[end]) || source[end] === ".")) {
        if (source[end] === ".") dots += 1;
        end += 1;
      }
      if (dots > 1) throw new Error("Некорректное число");
      const raw = source.slice(index, end);
      if (raw === ".") throw new Error("Некорректное число");
      const value = Number(raw);
      if (!Number.isFinite(value)) throw new Error("Некорректное число");
      tokens.push({ type: "number", value });
      index = end - 1;
      continue;
    }
    tokens.push({ type: char });
  }
  return tokens;
}

function finish(value) {
  if (!Number.isFinite(value)) throw new Error("Некорректный результат");
  if (Math.abs(value) > 1e15) throw new Error("Слишком большое число");
  return Number(value.toFixed(10));
}

function count(text, symbol) {
  let total = 0;
  for (const char of text) if (char === symbol) total += 1;
  return total;
}

function isDigit(char) {
  return char >= "0" && char <= "9";
}

function isNumberChar(char) {
  return isDigit(char) || char === ".";
}
