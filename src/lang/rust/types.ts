import type { Expr } from "../ir/model.js";
import { field, named, type SyntaxNode } from "../tree-sitter.js";
import { posOf, type RustState } from "./names.js";
import { pathExpr, segmentsOf } from "./paths.js";

/**
 * Types as expressions: `reqwest::Client` -> the path, `&Client` / `Arc<Mutex<Option<Client>>>` -> `Client` (smart
 * pointers, locks and options stand for what they hold), `Vec<T>` -> `[][T]` and `HashMap<K, V>` -> `map[V]`, as the
 * engine's type shapes read Go's containers (`ir/types.ts`).
 */

const HOLDERS = new Set(["Arc", "Rc", "Box", "Option", "Mutex", "RwLock", "RefCell", "Cell", "Cow", "Pin", "Lazy", "LazyLock", "OnceLock", "OnceCell", "Weak"]);
const SEQUENCES = new Set(["Vec", "VecDeque", "HashSet", "BTreeSet", "IndexSet", "LinkedList"]);
const MAPS = new Set(["HashMap", "BTreeMap", "IndexMap"]);

const typeArgs = (n: SyntaxNode): SyntaxNode[] => {
  const args = field(n, "type_arguments");
  return args ? named(args).filter((c) => !c.type.endsWith("comment") && c.type !== "lifetime") : [];
};

function container(name: string, inner: Expr | undefined, n: SyntaxNode): Expr {
  return { k: "index", obj: { k: "name", name, pos: posOf(n) }, key: inner ?? { k: "unknown", text: "T" } };
}

function genericType(n: SyntaxNode, st: RustState): Expr | undefined {
  const base = field(n, "type");
  const name = segmentsOf(base)?.at(-1);
  const args = typeArgs(n);
  if (name && HOLDERS.has(name)) return lowerType(args[0], st);
  if (name && SEQUENCES.has(name)) return container("[]", lowerType(args[0], st), n);
  if (name && MAPS.has(name)) return container("map", lowerType(args[1], st), n);
  // `Client<AzureConfig>`: a client the type alone does not place (its host is the config's), read from its callers
  if (args.some((a) => segmentsOf(a)?.at(-1) === "AzureConfig")) return undefined;
  return lowerType(base, st);
}

export function lowerType(n: SyntaxNode | undefined, st: RustState): Expr | undefined {
  if (!n) return undefined;
  switch (n.type) {
    case "type_identifier":
      return n.text === "Self" ? st.selfType : { k: "name", name: n.text, pos: posOf(n) };
    case "primitive_type":
      return { k: "name", name: n.text, pos: posOf(n) };
    case "scoped_type_identifier": {
      const segs = segmentsOf(n);
      return segs ? pathExpr(segs, n, st) : undefined;
    }
    case "reference_type":
    case "pointer_type":
      return lowerType(field(n, "type"), st);
    case "generic_type":
      return genericType(n, st);
    case "array_type":
      return container("[]", lowerType(field(n, "element"), st), n);
    default:
      return undefined;
  }
}
