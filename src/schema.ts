// zod による入力チェックの定義
// 問題データ・試験設定・ブラウザに保存する成績・画面からの入力をスキーマで検証する
import { z } from "zod";

// zod の既定のエラーメッセージを日本語にする（個別に指定したメッセージはそちらが優先）
z.config(z.locales.ja());

// ===== 問題データ =====
export const QuestionSchema = z
  .object({
    id: z.string().min(1, "ID が空です"),
    field: z.number().int().positive(),
    oid: z.string().regex(/^FM26-\d\.\d+\.\d+$/, "OID は FM26-x.x.x の形式で指定してください"),
    type: z.enum(["single", "multi"]),
    q: z.string().min(1, "問題文が空です"),
    choices: z.array(z.string().min(1, "空の選択肢があります")).min(2, "選択肢は 2つ以上必要です").max(8, "選択肢は 8つまでです"),
    answer: z.array(z.number().int().nonnegative()).min(1, "正解が指定されていません"),
    explain: z.string().min(1, "解説が空です"),
    src: z.string().min(1).optional(),
    ref: z.url({ protocol: /^https$/ }).optional(),
  })
  .superRefine((q, ctx) => {
    // 正解の番号が選択肢の範囲内か
    if (q.answer.some((a) => a >= q.choices.length)) {
      ctx.addIssue({ code: "custom", path: ["answer"], message: `正解の番号が選択肢の範囲（0〜${q.choices.length - 1}）を超えています` });
    }
    // 正解の番号が重複していないか
    if (new Set(q.answer).size !== q.answer.length) {
      ctx.addIssue({ code: "custom", path: ["answer"], message: "正解の番号が重複しています" });
    }
    // 単一回答なら正解は 1つだけ
    if (q.type === "single" && q.answer.length !== 1) {
      ctx.addIssue({ code: "custom", path: ["answer"], message: "単一回答の問題は正解を 1つだけ指定してください" });
    }
  });

export type Question = z.infer<typeof QuestionSchema>;

// ===== 知識分野と試験 =====
export const FieldDefSchema = z.object({
  name: z.string().min(1),
  weight: z.number().int().nonnegative(), // 本番モードでの出題数
});

export const ExamSchema = z
  .object({
    key: z.string().regex(/^[a-z0-9]+$/),
    code: z.string().min(1),
    title: z.string().min(1),
    summary: z.string().min(1),
    lead: z.string().min(1),
    minutes: z.number().int().positive(),
    count: z.number().int().positive(),
    fields: z.record(z.string().regex(/^\d+$/), FieldDefSchema),
    questions: z.array(QuestionSchema).min(1),
    hasGuidebook: z.boolean(),
  })
  .superRefine((ex, ctx) => {
    // ID と問題文の重複
    const ids = new Set<string>();
    const texts = new Set<string>();
    ex.questions.forEach((q, i) => {
      if (ids.has(q.id)) ctx.addIssue({ code: "custom", path: ["questions", i, "id"], message: `ID「${q.id}」が重複しています` });
      if (texts.has(q.q)) ctx.addIssue({ code: "custom", path: ["questions", i, "q"], message: `問題文が重複しています（${q.id}）` });
      ids.add(q.id);
      texts.add(q.q);
      // 問題の分野が試験の分野に存在するか
      if (!ex.fields[String(q.field)]) {
        ctx.addIssue({ code: "custom", path: ["questions", i, "field"], message: `分野 ${q.field} は試験に定義されていません（${q.id}）` });
      }
    });
    // 配分の合計が本番の出題数と一致し、各分野の問題数が配分以上あるか
    const total = Object.values(ex.fields).reduce((a, f) => a + f.weight, 0);
    if (total !== ex.count) {
      ctx.addIssue({ code: "custom", path: ["fields"], message: `分野ごとの出題数の合計（${total}）が本番の出題数（${ex.count}）と一致しません` });
    }
    for (const [no, f] of Object.entries(ex.fields)) {
      const pool = ex.questions.filter((q) => String(q.field) === no).length;
      if (pool < f.weight) {
        ctx.addIssue({ code: "custom", path: ["fields", no], message: `分野 ${no} の問題数（${pool}）が本番の出題数（${f.weight}）より少なくなっています` });
      }
    }
  });

export type Exam = z.infer<typeof ExamSchema>;

// ===== ブラウザに保存する成績 =====
const FieldScoreSchema = z
  .object({ c: z.number().int().nonnegative(), t: z.number().int().positive() })
  .refine((f) => f.c <= f.t, "正解数が出題数を超えています");

export const HistoryRecordSchema = z
  .object({
    at: z.iso.datetime(),
    correct: z.number().int().nonnegative(),
    total: z.number().int().positive(),
    elapsed: z.number().int().nonnegative(),
    fields: z.record(z.string().regex(/^\d+$/), FieldScoreSchema),
  })
  .refine((h) => h.correct <= h.total, "正解数が出題数を超えています");

export type HistoryRecord = z.infer<typeof HistoryRecordSchema>;
export const HistorySchema = z.array(HistoryRecordSchema);

// 問題ID → 本番モードでの出題回数
export const SeenSchema = z.record(z.string(), z.number().int().nonnegative());
export type Seen = z.infer<typeof SeenSchema>;

// ===== 画面からの入力 =====
export const ModeSchema = z.enum(["exam", "practice"]);
export type Mode = z.infer<typeof ModeSchema>;

// 練習モードの設定（分野は 1つ以上、出題数は 10 / 20 / 0（すべて））
export const PracticeSettingsSchema = z.object({
  fields: z.array(z.coerce.number().int().positive()).min(1, "分野を 1つ以上選択してください。"),
  count: z.coerce.number().pipe(
    z.union([z.literal(0), z.literal(10), z.literal(20)], { error: "出題数は「10問」「20問」「選んだ分野のすべて」から選択してください。" }),
  ),
});

// 問題一覧の絞り込み条件
export const ListFilterSchema = z.object({
  field: z.union([z.literal(""), z.string().regex(/^\d+$/)]),
  type: z.enum(["", "single", "multi"]),
  source: z.enum(["", "base", "gb"]),
  keyword: z.string().trim().max(100, "キーワードは 100文字以内で入力してください。"),
});
export type ListFilter = z.infer<typeof ListFilterSchema>;
