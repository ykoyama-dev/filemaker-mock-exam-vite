// 試験の定義（TOP 画面で選択する試験ごとの設定）
// 起動時に zod（ExamSchema）で検証し、問題データに誤りがあればその試験は受験できないようにする
import { z } from "zod";
import { ExamSchema, type Exam } from "../schema";
import { CFBD1_FIELDS, CFBD1_BASE_QUESTIONS } from "./cfbd1-base";
import { CFBD1_GB_QUESTIONS } from "./cfbd1-guidebook";
import { CFED3_FIELDS, CFED3_QUESTIONS } from "./cfed3";

const RAW_EXAMS: unknown[] = [
  {
    key: "cfbd1",
    code: "CFBD-1-2026",
    title: "Basic Developer",
    summary: "FileMaker の構成や基礎を理解し、身の回りや業務の課題を解決するカスタム App を作成できることを証明する試験です。",
    lead: "学習ガイド（CFBD1G202609）の学習目標と例題の出題形式に沿い、Claris FileMaker ガイドブック基礎編の内容も参考にして作成したオリジナル問題です。",
    minutes: 53,
    count: 40,
    fields: CFBD1_FIELDS,
    questions: [...CFBD1_BASE_QUESTIONS, ...CFBD1_GB_QUESTIONS],
    hasGuidebook: true,
  },
  {
    key: "cfed3",
    code: "CFED-3-2026",
    title: "Expert Developer",
    summary: "実務で多様な課題を解決してきた開発者向けに、効率的な開発と障害の回避・迅速な対処ができることを証明する試験です。",
    lead: "学習ガイド（CFED3G202609）の学習目標と例題の出題形式に沿って作成したオリジナル問題です。",
    minutes: 86,
    count: 50,
    fields: CFED3_FIELDS,
    questions: CFED3_QUESTIONS,
    hasGuidebook: false,
  },
];

export type ExamLoadResult =
  | { ok: true; exam: Exam }
  | { ok: false; key: string; code: string; error: string };

// 各試験を検証して読み込む。失敗した試験はエラー内容（日本語）を返す
export function loadExams(): ExamLoadResult[] {
  return RAW_EXAMS.map((raw) => {
    const result = ExamSchema.safeParse(raw);
    if (result.success) return { ok: true, exam: result.data };
    const r = raw as { key?: string; code?: string };
    return { ok: false, key: r.key ?? "?", code: r.code ?? "?", error: z.prettifyError(result.error) };
  });
}
