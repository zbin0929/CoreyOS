/**
 * Tiny expression utilities used by the v0.3.0 `SchemaConfig`
 * template. Two surfaces:
 *
 *   - `evalShowIf(expr, ctx)` — boolean visibility predicate for
 *     `<field show_if: "...">`. Grammar:
 *
 *         expr      := orExpr
 *         orExpr    := andExpr ("||" andExpr)*
 *         andExpr   := notExpr ("&&" notExpr)*
 *         notExpr   := "!" notExpr | atom
 *         atom      := "(" expr ")" | comparison | ref
 *         comparison:= ref ("==" | "!=") ref
 *         ref       := identifier | literal
 *         literal   := "true" | "false" | "null" | number | "'string'"
 *
 *     Identifiers resolve against `ctx` via dotted path. Bare
 *     identifiers are truthy-tested. Malformed input fails-open
 *     (returns `true`) so a typo can't hide an input from the
 *     Pack author.
 *
 *   - `fillTemplate(tmpl, ctx)` — substitutes `{path}` placeholders
 *     in a string. Used for `preview` / computed-field rendering.
 *     Missing values render empty.
 *
 * No operator precedence beyond `!` > `&&` > `||`. No arithmetic.
 * No method calls. Pure functions, easy to unit test.
 */

export type Ctx = Record<string, unknown>;

type Node =
  | { kind: 'lit'; value: unknown }
  | { kind: 'ref'; path: string }
  | { kind: 'eq'; left: Node; right: Node }
  | { kind: 'neq'; left: Node; right: Node }
  | { kind: 'and'; left: Node; right: Node }
  | { kind: 'or'; left: Node; right: Node }
  | { kind: 'not'; child: Node };

/** Resolve a dotted path against `ctx`. Returns undefined on miss. */
export function resolvePath(ctx: Ctx, path: string): unknown {
  if (!path) return undefined;
  const parts = path.split('.');
  let cur: unknown = ctx;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      cur = (cur as Ctx)[p];
    } else {
      return undefined;
    }
  }
  return cur;
}

/** Substitute `{path}` placeholders. Unknown paths render empty. */
export function fillTemplate(tmpl: string, ctx: Ctx): string {
  if (!tmpl) return '';
  return tmpl.replace(/\{([^{}]+)\}/g, (_, raw: string) => {
    const v = resolvePath(ctx, raw.trim());
    if (v === undefined || v === null) return '';
    return String(v);
  });
}

/** Public predicate. Empty expression = always visible. */
export function evalShowIf(expr: string, ctx: Ctx): boolean {
  const trimmed = expr.trim();
  if (!trimmed) return true;
  try {
    const parser = new Parser(trimmed);
    const ast = parser.parseOr();
    parser.expectEnd();
    return toBool(evalNode(ast, ctx));
  } catch {
    return true;
  }
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v !== 0;
  if (typeof v === 'string') return v.length > 0;
  return v !== null && v !== undefined;
}

function evalNode(n: Node, ctx: Ctx): unknown {
  switch (n.kind) {
    case 'lit':
      return n.value;
    case 'ref':
      return resolvePath(ctx, n.path);
    case 'eq':
      return looseEq(evalNode(n.left, ctx), evalNode(n.right, ctx));
    case 'neq':
      return !looseEq(evalNode(n.left, ctx), evalNode(n.right, ctx));
    case 'and':
      return toBool(evalNode(n.left, ctx)) && toBool(evalNode(n.right, ctx));
    case 'or':
      return toBool(evalNode(n.left, ctx)) || toBool(evalNode(n.right, ctx));
    case 'not':
      return !toBool(evalNode(n.child, ctx));
  }
}

/** Loose equality so `1 == "1"` and `true == "true"` both match
 *  the way a Pack author would expect when typing YAML strings. */
function looseEq(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a === typeof b) return false;
  return String(a) === String(b);
}

class Parser {
  private i = 0;
  constructor(private readonly src: string) {}

  parseOr(): Node {
    let left = this.parseAnd();
    while (this.match('||')) {
      const right = this.parseAnd();
      left = { kind: 'or', left, right };
    }
    return left;
  }

  parseAnd(): Node {
    let left = this.parseNot();
    while (this.match('&&')) {
      const right = this.parseNot();
      left = { kind: 'and', left, right };
    }
    return left;
  }

  parseNot(): Node {
    if (this.match('!')) return { kind: 'not', child: this.parseNot() };
    return this.parseAtom();
  }

  parseAtom(): Node {
    this.skipWs();
    let node: Node;
    if (this.peek() === '(') {
      this.i++;
      node = this.parseOr();
      this.skipWs();
      if (this.peek() !== ')') throw new Error('expected )');
      this.i++;
    } else {
      node = this.readRef();
    }
    this.skipWs();
    const op = this.peekTwo();
    if (op === '==' || op === '!=') {
      this.i += 2;
      const right = this.readRef();
      return op === '==' ? { kind: 'eq', left: node, right } : { kind: 'neq', left: node, right };
    }
    return node;
  }

  expectEnd(): void {
    this.skipWs();
    if (this.i < this.src.length) throw new Error('unexpected trailing chars');
  }

  private readRef(): Node {
    this.skipWs();
    const ch = this.peek();
    if (ch === "'") {
      this.i++;
      const start = this.i;
      while (this.i < this.src.length && this.src[this.i] !== "'") this.i++;
      const s = this.src.slice(start, this.i);
      if (this.peek() !== "'") throw new Error('unterminated string');
      this.i++;
      return { kind: 'lit', value: s };
    }
    if (ch === '-' || (ch !== undefined && /[0-9]/.test(ch))) {
      const start = this.i;
      if (ch === '-') this.i++;
      while (this.i < this.src.length && /[0-9.]/.test(this.src[this.i] ?? '')) this.i++;
      return { kind: 'lit', value: Number(this.src.slice(start, this.i)) };
    }
    const start = this.i;
    while (this.i < this.src.length && /[A-Za-z0-9_.]/.test(this.src[this.i] ?? '')) this.i++;
    const word = this.src.slice(start, this.i);
    if (!word) throw new Error('expected identifier');
    if (word === 'true') return { kind: 'lit', value: true };
    if (word === 'false') return { kind: 'lit', value: false };
    if (word === 'null') return { kind: 'lit', value: null };
    return { kind: 'ref', path: word };
  }

  private match(tok: string): boolean {
    this.skipWs();
    if (this.src.startsWith(tok, this.i)) {
      this.i += tok.length;
      return true;
    }
    return false;
  }

  private peek(): string | undefined {
    return this.src[this.i];
  }
  private peekTwo(): string {
    return this.src.slice(this.i, this.i + 2);
  }
  private skipWs(): void {
    while (this.i < this.src.length && /\s/.test(this.src[this.i] ?? '')) this.i++;
  }
}
