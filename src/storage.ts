// ブラウザ（localStorage）への保存と読み込み
// 読み込み時は zod で形式を検証し、壊れたデータや古い形式のデータは使わずに既定値へ戻す
import type { z } from "zod";

const PREFIX = "fmmock";

const keyOf = (examKey: string, name: string) => `${PREFIX}:${examKey}:${name}`;

export function load<T extends z.ZodType>(examKey: string, name: string, schema: T, fallback: z.infer<T>): z.infer<T> {
  let raw: string | null;
  try {
    raw = localStorage.getItem(keyOf(examKey, name));
  } catch {
    return fallback; // プライベートブラウズなどで保存領域が使えない場合
  }
  if (raw === null) return fallback;

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    console.warn(`保存データ ${keyOf(examKey, name)} が JSON として読み込めないため破棄しました`);
    return fallback;
  }
  const result = schema.safeParse(json);
  if (!result.success) {
    console.warn(`保存データ ${keyOf(examKey, name)} の形式が正しくないため破棄しました`, result.error.issues);
    return fallback;
  }
  return result.data;
}

export function save(examKey: string, name: string, value: unknown): boolean {
  try {
    localStorage.setItem(keyOf(examKey, name), JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function remove(examKey: string, name: string): void {
  try {
    localStorage.removeItem(keyOf(examKey, name));
  } catch {
    // 保存領域が使えない場合は何もしない
  }
}
