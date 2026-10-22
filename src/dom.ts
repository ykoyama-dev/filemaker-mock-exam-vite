// DOM 操作の小さなヘルパー

// ID で要素を取得する（見つからない場合は例外。HTML と TS の不整合をすぐ見つけるため）
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`要素 #${id} が見つかりません`);
  return node as T;
}

type Attrs = Record<string, string | boolean | ((ev: Event) => void) | undefined>;
type Child = Node | string | null | undefined | false;

// 要素を生成する。class / text / on〇〇（イベント）/ その他の属性を指定できる
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === "class") node.className = String(v);
    else if (k === "text") node.textContent = String(v);
    else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c) node.append(c);
  return node;
}
