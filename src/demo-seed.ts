// 【無効化済み】この処理は main.ts から呼び出していない（投入済みのため二度と動かさない）
// 成績画面の見栄えのためのダミー成績データ
// 各ブラウザで一度だけ、成績が 1件もない試験に 10件のランダムな成績を入れる
// 入れたことは記録しておくので、利用者が削除しても再び入ることはない
import { z } from "zod";
import * as storage from "./storage";
import { HistorySchema, type Exam, type HistoryRecord } from "./schema";

const SEED_COUNT = 10;
const DAY = 24 * 60 * 60 * 1000;

const randInt = (min: number, max: number) => Math.floor(Math.random() * (max - min + 1)) + min;
const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

// 1回分のダミー成績を作る。分野ごとの出題数は本番の配分どおりにする
function makeRecord(ex: Exam, at: Date): HistoryRecord {
  const baseRate = randInt(50, 95) / 100; // その回の全体の出来（50〜95%）
  const fields: HistoryRecord["fields"] = {};
  let correct = 0;
  for (const [no, f] of Object.entries(ex.fields)) {
    if (f.weight === 0) continue;
    // 分野ごとに ±20% のばらつきを付ける
    const c = clamp(Math.round(f.weight * (baseRate + (Math.random() - 0.5) * 0.4)), 0, f.weight);
    fields[no] = { c, t: f.weight };
    correct += c;
  }
  // 所要時間は制限時間の 55〜100% の範囲
  const elapsed = randInt(Math.round(ex.minutes * 60 * 0.55), ex.minutes * 60);
  return { at: at.toISOString(), correct, total: ex.count, elapsed, fields };
}

// 過去 30日ほどの間に、古い順で 10回分の受験日時を作る
function makeDates(): Date[] {
  const now = Date.now();
  return Array.from({ length: SEED_COUNT }, () => {
    const d = new Date(now - randInt(1, 30) * DAY);
    d.setHours(randInt(9, 21), randInt(0, 59), 0, 0);
    return d;
  }).sort((a, b) => a.getTime() - b.getTime());
}

// 起動時に呼ぶ。まだ入れていない試験だけに入れる
export function seedDemoHistory(exams: Exam[]): void {
  for (const ex of exams) {
    if (storage.load(ex.key, "demoSeeded", z.boolean(), false)) continue;
    const history = storage.load(ex.key, "history", HistorySchema, []);
    if (history.length === 0) {
      const records = makeDates().map((d) => makeRecord(ex, d));
      if (!storage.save(ex.key, "history", HistorySchema.parse(records))) continue; // 保存できない環境では何もしない
    }
    // 本物の成績がある場合も含め、二度と入れないよう記録する
    storage.save(ex.key, "demoSeeded", true);
  }
}
