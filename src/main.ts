// FileMaker 技術者試験 模擬試験 画面制御
import "./style.css";
import { z } from "zod";
import { $, el } from "./dom";
import { loadExams } from "./data/exams";
import * as storage from "./storage";
// ダミー成績の自動投入は投入済みのため無効化（二度と動かさない）
// import { seedDemoHistory } from "./demo-seed";
import {
  HistorySchema, ListFilterSchema, ModeSchema, PracticeSettingsSchema, SeenSchema,
  type Exam, type HistoryRecord, type Mode, type Question,
} from "./schema";

const LETTERS = "ABCDEFGH";
const SCREENS = ["top", "start", "quiz", "result", "list", "detail", "scores"] as const;
type Screen = (typeof SCREENS)[number];

// ===== 状態 =====
const examResults = loadExams();
let cur: Exam | null = null; // 選択中の試験

// 選択中の試験を取得する（TOP 画面以外では必ず選択済み）
function exam(): Exam {
  if (!cur) throw new Error("試験が選択されていません");
  return cur;
}

// 出題画面の状態
const quiz = {
  mode: "exam" as Mode,
  list: [] as Question[],
  picks: [] as Set<number>[],   // 各問題で選んだ選択肢
  checked: [] as boolean[],     // 練習モードで回答済みか
  flags: [] as boolean[],       // 見直しフラグ
  current: 0,
  startedAt: 0,
  deadline: 0,
  timerId: 0,
};

// 一覧画面の状態
const browse = {
  filtered: [] as Question[],
  index: 0,
  picks: new Map<string, Set<number>>(),
  results: new Map<string, boolean>(),
  revealed: false,
};

// ===== 共通 =====
function showScreen(name: Screen): void {
  for (const s of SCREENS) $(`screen-${s}`).hidden = s !== name;
  window.scrollTo(0, 0);
}

// 正誤判定：選んだ選択肢の集合と正解の集合が完全に一致すれば正解
function isCorrect(q: Question, picked: Set<number>): boolean {
  return picked.size === q.answer.length && q.answer.every((i) => picked.has(i));
}

function shuffle<T>(arr: readonly T[]): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const fieldName = (q: Question) => `${q.field}. ${exam().fields[String(q.field)].name}`;
const typeLabel = (q: Question) => (q.type === "multi" ? "複数回答（正しいものをすべて選択）" : "単一回答");
const answerText = (q: Question) => q.answer.map((a) => LETTERS[a]).join("、");
const pct = (c: number, t: number) => (t ? Math.round((c / t) * 1000) / 10 : 0); // 小数第1位までの %
const pad = (n: number) => String(n).padStart(2, "0");
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const fmtTime = (sec: number) => `${Math.floor(sec / 60)}分${pad(sec % 60)}秒`;

// zod の検証エラーから、利用者向けの最初のメッセージを取り出す
const firstMessage = (error: z.ZodError) => error.issues[0]?.message ?? "入力内容を確認してください。";

// ===== TOP 画面（試験の選択） =====
function initTop(): void {
  const box = $("exam-cards");
  for (const r of examResults) {
    if (r.ok) {
      const ex = r.exam;
      box.append(el("button", {
        type: "button",
        class: "flex cursor-pointer flex-col gap-1.5 rounded-xl border border-slate-200 bg-white p-5 text-left hover:border-blue-600 focus-visible:outline-2 focus-visible:outline-blue-600 dark:border-slate-700 dark:bg-slate-900 dark:hover:border-blue-400",
        onclick: () => selectExam(ex),
      },
        el("span", { class: "text-2xl font-bold text-blue-700 dark:text-blue-300", text: ex.code }),
        el("span", { class: "font-bold", text: ex.title }),
        el("span", { class: "muted text-sm", text: ex.summary }),
        el("span", { class: "mt-auto border-t border-slate-200 pt-2 text-sm dark:border-slate-700", text: `本番 ${ex.count}問・${ex.minutes}分 ／ 問題数 ${ex.questions.length}問` })));
    } else {
      // 問題データの検証に失敗した試験は受験できないようにし、エラー内容を表示する
      box.append(el("div", { class: "rounded-xl border border-rose-600 bg-rose-50 p-5 dark:bg-rose-950" },
        el("div", { class: "text-2xl font-bold text-rose-700 dark:text-rose-300", text: r.code }),
        el("div", { class: "font-bold", text: "問題データに誤りがあるため受験できません" }),
        el("pre", { class: "mt-2 max-h-48 overflow-auto text-xs whitespace-pre-wrap", text: r.error })));
    }
  }
  $("btn-to-top").addEventListener("click", goTop);
}

function goTop(): void {
  cur = null;
  $("app-title").textContent = "Claris FileMaker 技術者試験 模擬試験";
  document.title = "FileMaker 模擬試験";
  showScreen("top");
}

function selectExam(ex: Exam): void {
  cur = ex;
  $("app-title").textContent = `${ex.code} 模擬試験`;
  document.title = `${ex.code} 模擬試験`;
  $("start-title").textContent = `${ex.code} ${ex.title} 模擬試験`;
  $("start-lead").textContent = ex.lead;
  $("pool-count").textContent = String(ex.questions.length);
  $("exam-count").textContent = String(ex.count);
  $("exam-minutes").textContent = String(ex.minutes);

  // 練習モードの分野チェックボックス
  const list = $("field-list");
  list.replaceChildren();
  for (const [no, f] of Object.entries(ex.fields)) {
    const count = ex.questions.filter((q) => String(q.field) === no).length;
    list.append(el("label", { class: "inline-flex items-center gap-2" },
      el("input", { type: "checkbox", value: no, checked: true }),
      `${no}. ${f.name}（${count}問）`));
  }

  // 一覧の絞り込み条件を初期化
  const fieldSel = $<HTMLSelectElement>("list-field");
  fieldSel.replaceChildren(el("option", { value: "", text: "すべて" }));
  for (const [no, f] of Object.entries(ex.fields)) fieldSel.append(el("option", { value: no, text: `${no}. ${f.name}` }));
  $<HTMLSelectElement>("list-type").value = "";
  $<HTMLSelectElement>("list-source").value = "";
  $<HTMLInputElement>("list-keyword").value = "";
  $("list-source-label").hidden = !ex.hasGuidebook;
  browse.picks.clear();
  browse.results.clear();

  document.querySelector<HTMLInputElement>('input[name="mode"][value="exam"]')!.checked = true;
  $("practice-options").hidden = true;
  $("start-error").hidden = true;
  showScreen("start");
}

// ===== スタート画面 =====
function initStart(): void {
  document.querySelectorAll<HTMLInputElement>('input[name="mode"]').forEach((r) =>
    r.addEventListener("change", () => {
      $("practice-options").hidden = !(r.value === "practice" && r.checked);
    }));

  $("btn-start").addEventListener("click", () => {
    const errorBox = $("start-error");
    errorBox.hidden = true;
    const mode = ModeSchema.parse(document.querySelector<HTMLInputElement>('input[name="mode"]:checked')?.value);
    if (mode === "exam") {
      startQuiz("exam", buildExamSet());
      return;
    }
    // 練習モードの設定を zod で検証する
    const settings = PracticeSettingsSchema.safeParse({
      fields: [...$("field-list").querySelectorAll<HTMLInputElement>("input:checked")].map((c) => c.value),
      count: $<HTMLSelectElement>("practice-count").value,
    });
    if (!settings.success) {
      errorBox.textContent = firstMessage(settings.error);
      errorBox.hidden = false;
      return;
    }
    let pool = shuffle(exam().questions.filter((q) => settings.data.fields.includes(q.field)));
    if (settings.data.count > 0) pool = pool.slice(0, settings.data.count);
    startQuiz("practice", pool);
  });
}

// 本番モード：分野ごとの出題数は配分どおり。各分野の中では、過去の本番で出題された回数が
// 少ない問題を優先して選ぶ（回数が同じ問題はランダム）。出題順もシャッフルする
function buildExamSet(): Question[] {
  const ex = exam();
  const seen = storage.load(ex.key, "seen", SeenSchema, {});
  const set: Question[] = [];
  for (const [no, f] of Object.entries(ex.fields)) {
    const pool = shuffle(ex.questions.filter((q) => String(q.field) === no))
      .sort((a, b) => (seen[a.id] ?? 0) - (seen[b.id] ?? 0)); // 安定ソートなので同回数内はランダム順のまま
    set.push(...pool.slice(0, f.weight));
  }
  return shuffle(set);
}

// ===== 出題 =====
function startQuiz(mode: Mode, list: Question[]): void {
  Object.assign(quiz, {
    mode, list,
    picks: list.map(() => new Set<number>()),
    checked: list.map(() => false),
    flags: list.map(() => false),
    current: 0,
    startedAt: Date.now(),
  });
  const isExam = mode === "exam";
  $("btn-check").hidden = isExam;
  $("btn-flag").hidden = !isExam;
  $("btn-finish").textContent = isExam ? "採点する" : "終了して結果を見る";

  window.clearInterval(quiz.timerId);
  $("timer").hidden = !isExam;
  if (isExam) {
    quiz.deadline = quiz.startedAt + exam().minutes * 60 * 1000;
    tick();
    quiz.timerId = window.setInterval(tick, 1000);
  }
  showScreen("quiz");
  renderQuestion();
}

// タイマー表示の更新。時間切れで自動採点
function tick(): void {
  const remain = Math.max(0, quiz.deadline - Date.now());
  const t = $("timer");
  t.textContent = `残り ${pad(Math.floor(remain / 60000))}:${pad(Math.floor((remain % 60000) / 1000))}`;
  t.classList.toggle("text-rose-600", remain < 5 * 60 * 1000);
  if (remain === 0) {
    window.clearInterval(quiz.timerId);
    alert("制限時間になりました。採点します。");
    finish();
  }
}

// 選択肢の行を描画する（出題画面・詳細画面で共用）
function renderChoices(box: HTMLElement, q: Question, picked: Set<number>, locked: boolean, name: string, onChange: () => void): void {
  box.replaceChildren();
  q.choices.forEach((text, idx) => {
    const input = el("input", { type: q.type === "multi" ? "checkbox" : "radio", name, value: String(idx), class: "mt-1.5" });
    input.checked = picked.has(idx);
    input.disabled = locked;
    input.addEventListener("change", () => {
      if (q.type === "single") picked.clear();
      if (input.checked) picked.add(idx); else picked.delete(idx);
      onChange();
    });
    const row = el("label", { class: "choice" }, input,
      el("span", { class: "min-w-[1.4em] font-bold", text: `${LETTERS[idx]}.` }),
      el("span", { text }));
    let state = picked.has(idx) ? "selected" : "";
    if (locked) state = q.answer.includes(idx) ? "correct" : picked.has(idx) ? "wrong" : "";
    if (state) row.dataset.state = state;
    box.append(row);
  });
}

// 出典（ガイドブックの節）と参考リンク（ある場合のみ）
function sourceNodes(q: Question): HTMLElement[] {
  const nodes: HTMLElement[] = [];
  if (q.src) nodes.push(el("div", { text: `出典：${q.src}` }));
  if (q.ref) nodes.push(el("div", {}, "参考：", el("a", { href: q.ref, target: "_blank", rel: "noopener", text: q.ref })));
  return nodes;
}

function feedbackNodes(q: Question, ok: boolean): HTMLElement[] {
  return [
    el("div", { class: "font-bold", text: ok ? "○ 正解です" : `× 不正解です（正解：${answerText(q)}）` }),
    el("div", { text: q.explain }),
    ...sourceNodes(q),
  ];
}

function showFeedback(box: HTMLElement, result: "ok" | "ng" | "", nodes: HTMLElement[]): void {
  if (result) box.dataset.result = result; else delete box.dataset.result;
  box.replaceChildren(...nodes);
  box.hidden = false;
}

function renderQuestion(): void {
  const i = quiz.current;
  const q = quiz.list[i];
  const picked = quiz.picks[i];
  const locked = quiz.mode === "practice" && quiz.checked[i];

  $("q-progress").textContent = `第 ${i + 1} 問 / 全 ${quiz.list.length} 問`;
  $("q-field").textContent = fieldName(q);
  $("q-type").textContent = typeLabel(q);
  $("q-text").textContent = q.q;
  renderChoices($("q-choices"), q, picked, locked, "choice", renderQuestion);

  const fb = $("q-feedback");
  if (locked) {
    const ok = isCorrect(q, picked);
    showFeedback(fb, ok ? "ok" : "ng", feedbackNodes(q, ok));
  } else {
    fb.hidden = true;
  }

  $<HTMLButtonElement>("btn-prev").disabled = i === 0;
  $<HTMLButtonElement>("btn-next").disabled = i === quiz.list.length - 1;
  $<HTMLButtonElement>("btn-check").disabled = locked || picked.size === 0;
  const flag = $("btn-flag");
  flag.dataset.flagged = String(quiz.flags[i]);
  flag.textContent = quiz.flags[i] ? "見直しを解除" : "見直し";
  renderNav();
}

// 問題番号の一覧（クリックでその問題へ移動）
function renderNav(): void {
  const nav = $("q-nav");
  nav.replaceChildren();
  quiz.list.forEach((q, i) => {
    const b = el("button", { type: "button", class: "nav-btn", text: String(i + 1), title: `第 ${i + 1} 問` });
    b.dataset.answered = String(quiz.picks[i].size > 0);
    b.dataset.flagged = String(quiz.flags[i]);
    b.dataset.current = String(i === quiz.current);
    if (quiz.mode === "practice" && quiz.checked[i]) b.dataset.result = isCorrect(q, quiz.picks[i]) ? "ok" : "ng";
    b.addEventListener("click", () => { quiz.current = i; renderQuestion(); });
    nav.append(b);
  });
}

function initQuizButtons(): void {
  $("btn-prev").addEventListener("click", () => { quiz.current--; renderQuestion(); });
  $("btn-next").addEventListener("click", () => { quiz.current++; renderQuestion(); });
  $("btn-flag").addEventListener("click", () => {
    quiz.flags[quiz.current] = !quiz.flags[quiz.current];
    renderQuestion();
  });
  $("btn-check").addEventListener("click", () => {
    quiz.checked[quiz.current] = true;
    renderQuestion();
  });
  $("btn-finish").addEventListener("click", () => {
    const unanswered = quiz.picks.filter((p) => p.size === 0).length;
    const flagged = quiz.flags.filter(Boolean).length;
    let msg = "採点しますか？";
    if (unanswered) msg += `\n未回答：${unanswered}問`;
    if (flagged) msg += `\n見直し中：${flagged}問`;
    if (confirm(msg)) finish();
  });
}

// ===== 結果 =====
type Result = { q: Question; picked: Set<number>; ok: boolean };

function finish(): void {
  const ex = exam();
  window.clearInterval(quiz.timerId);
  $("timer").hidden = true;

  const results: Result[] = quiz.list.map((q, i) => ({ q, picked: quiz.picks[i], ok: isCorrect(q, quiz.picks[i]) }));
  const correct = results.filter((r) => r.ok).length;
  const total = results.length;
  const elapsed = Math.round((Date.now() - quiz.startedAt) / 1000);

  $("r-rate").textContent = String(total ? Math.round((correct / total) * 100) : 0);
  $("r-detail").replaceChildren(
    el("div", { text: `${ex.code}　正解 ${correct} / ${total} 問` }),
    el("div", { text: `所要時間 ${fmtTime(elapsed)}` }),
    el("div", { text: quiz.mode === "exam" ? "本番モード" : "練習モード" }));

  // 分野別の集計
  const tbody = $("r-fields");
  tbody.replaceChildren();
  for (const [no, f] of Object.entries(ex.fields)) {
    const rs = results.filter((r) => String(r.q.field) === no);
    if (rs.length === 0) continue;
    const c = rs.filter((r) => r.ok).length;
    tbody.append(el("tr", {},
      el("td", { text: `${no}. ${f.name}` }),
      el("td", { text: `${c} / ${rs.length}` }),
      el("td", { text: `${pct(c, rs.length)}%` })));
  }

  // 問題ごとの見直し
  const review = $("r-review");
  review.replaceChildren();
  results.forEach((r, i) => {
    const yours = [...r.picked].sort((a, b) => a - b).map((a) => LETTERS[a]).join("、") || "未回答";
    const ol = el("ol", { class: "my-2 list-[upper-alpha] pl-6" });
    r.q.choices.forEach((c, idx) => {
      const cls = r.q.answer.includes(idx) ? "font-bold text-emerald-700 dark:text-emerald-300"
        : r.picked.has(idx) ? "text-rose-700 line-through dark:text-rose-300" : "";
      ol.append(el("li", { class: cls, text: c }));
    });
    review.append(el("div", {
      class: `card review border-l-4 ${r.ok ? "border-l-emerald-600" : "border-l-rose-600"}`,
      "data-ok": r.ok ? "1" : "0",
    },
      el("div", { class: "muted flex flex-wrap justify-between gap-2 text-sm" },
        el("span", { class: `font-bold ${r.ok ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300"}`, text: `第 ${i + 1} 問　${r.ok ? "○ 正解" : "× 不正解"}` }),
        el("span", { text: `${r.q.oid} / ${ex.fields[String(r.q.field)].name}` })),
      el("p", { class: "mt-1 whitespace-pre-wrap", text: r.q.q }),
      ol,
      el("div", { text: `あなたの回答：${yours}　／　正解：${answerText(r.q)}` }),
      el("div", { class: "mt-2 text-[.95rem]", text: r.q.explain }),
      ...sourceNodes(r.q)));
  });
  $<HTMLInputElement>("only-wrong").checked = false;

  const wrong = results.filter((r) => !r.ok).map((r) => r.q);
  const retry = $<HTMLButtonElement>("btn-retry-wrong");
  retry.disabled = wrong.length === 0;
  retry.onclick = () => startQuiz("practice", shuffle(wrong));

  // 本番モードの結果だけを成績として保存し、出題回数も更新する
  const saved = $("r-saved");
  if (quiz.mode === "exam") {
    saved.textContent = saveExamResult(results, elapsed)
      ? "この結果を成績に保存しました。「成績を見る」で履歴と分野別の正答率を確認できます。"
      : "ブラウザの設定により成績を保存できませんでした。";
    saved.hidden = false;
  } else {
    saved.hidden = true;
  }
  showScreen("result");
}

function initResult(): void {
  $<HTMLInputElement>("only-wrong").addEventListener("change", (e) => {
    const only = (e.target as HTMLInputElement).checked;
    document.querySelectorAll<HTMLElement>("#r-review [data-ok]").forEach((n) => {
      n.hidden = only && n.dataset.ok === "1";
    });
  });
  $("btn-home").addEventListener("click", () => showScreen("start"));
}

// ===== 成績（本番モードの履歴） =====
const loadHistory = () => storage.load(exam().key, "history", HistorySchema, []);

function saveExamResult(results: Result[], elapsed: number): boolean {
  const ex = exam();
  const fields: HistoryRecord["fields"] = {};
  for (const r of results) {
    const f = (fields[String(r.q.field)] ??= { c: 0, t: 0 });
    f.t++;
    if (r.ok) f.c++;
  }
  const history = loadHistory();
  history.push({ at: new Date().toISOString(), correct: results.filter((r) => r.ok).length, total: results.length, elapsed, fields });

  const seen = storage.load(ex.key, "seen", SeenSchema, {});
  for (const r of results) seen[r.q.id] = (seen[r.q.id] ?? 0) + 1;

  // 保存前にも zod で検証し、不正な形のデータを書き込まない
  return storage.save(ex.key, "history", HistorySchema.parse(history)) && storage.save(ex.key, "seen", SeenSchema.parse(seen));
}

function renderScores(): void {
  const ex = exam();
  const history = loadHistory();
  const fieldNos = Object.keys(ex.fields);
  $("s-title").textContent = `${ex.code} 成績`;

  // 概要：受験回数、平均・最高・最新の正答率
  const rates = history.map((h) => pct(h.correct, h.total));
  const summary = $("s-summary");
  if (history.length === 0) {
    summary.replaceChildren(el("div", { class: "muted", text: "まだ本番モードの成績がありません。本番モードで採点すると、ここに記録されます。" }));
  } else {
    const avg = rates.reduce((a, b) => a + b, 0) / rates.length;
    summary.replaceChildren(
      el("div", { class: "text-5xl leading-none font-bold" }, String(Math.round(avg * 10) / 10), el("small", { class: "text-xl", text: "%" })),
      el("div", { class: "muted" },
        el("div", { text: `平均正答率（受験 ${history.length} 回）` }),
        el("div", { text: `最高 ${Math.max(...rates)}% ／ 最新 ${rates[rates.length - 1]}%` })));
  }

  // 分野別の正答率（全受験の累計）
  const tbody = $("s-fields");
  tbody.replaceChildren();
  for (const no of fieldNos) {
    let c = 0, t = 0;
    for (const h of history) { c += h.fields[no]?.c ?? 0; t += h.fields[no]?.t ?? 0; }
    tbody.append(el("tr", {},
      el("td", { text: `${no}. ${ex.fields[no].name}` }),
      el("td", { text: `${c} / ${t}` }),
      el("td", { text: t ? `${pct(c, t)}%` : "－" })));
  }

  // 受験履歴（新しい順）。分野ごとの正答率も列で表示
  $("s-history-head").replaceChildren(el("tr", {},
    el("th", { text: "受験日時" }), el("th", { text: "正答率" }), el("th", { text: "正解 / 出題" }), el("th", { text: "所要時間" }),
    ...fieldNos.map((no) => el("th", { text: `分野${no}`, title: ex.fields[no].name })),
    el("th", { text: "操作" })));
  const hb = $("s-history");
  hb.replaceChildren();
  // 新しい順に表示しつつ、削除用に保存配列での位置（idx）を保持する
  history.map((h, idx) => ({ h, idx })).reverse().forEach(({ h, idx }) => {
    hb.append(el("tr", {},
      el("td", { text: fmtDate(h.at) }),
      el("td", { text: `${pct(h.correct, h.total)}%` }),
      el("td", { text: `${h.correct} / ${h.total}` }),
      el("td", { text: fmtTime(h.elapsed) }),
      ...fieldNos.map((no) => el("td", { text: h.fields[no] ? `${pct(h.fields[no].c, h.fields[no].t)}%` : "－" })),
      el("td", {}, el("button", {
        type: "button", class: "btn btn-danger btn-sm", text: "削除",
        "aria-label": `${fmtDate(h.at)} の成績を削除`,
        onclick: () => deleteHistory(idx),
      }))));
  });

  $<HTMLButtonElement>("btn-csv").disabled = history.length === 0;
  $<HTMLButtonElement>("btn-clear-scores").disabled = history.length === 0;
}

// 受験履歴を 1件だけ削除する（累計・平均も再計算される）
function deleteHistory(idx: number): void {
  const ex = exam();
  const history = loadHistory();
  const h = history[idx];
  if (!h) return;
  if (!confirm(`${fmtDate(h.at)}（正答率 ${pct(h.correct, h.total)}%）の成績を削除します。元に戻せません。よろしいですか？`)) return;
  history.splice(idx, 1);
  if (history.length) storage.save(ex.key, "history", history); else storage.remove(ex.key, "history");
  renderScores();
}

// 成績履歴を CSV（Excel で開けるよう BOM 付き UTF-8）で書き出す
function exportCsv(): void {
  const ex = exam();
  const history = loadHistory();
  const fieldNos = Object.keys(ex.fields);
  const esc = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
  const header = ["受験日時", "試験", "正答率(%)", "正解数", "出題数", "所要時間(秒)",
    ...fieldNos.flatMap((no) => {
      const n = `${no}.${ex.fields[no].name}`;
      return [`${n} 正解数`, `${n} 出題数`, `${n} 正答率(%)`];
    })];
  type Cell = string | number;
  const rows: Cell[][] = history.map((h) => [fmtDate(h.at), ex.code, pct(h.correct, h.total), h.correct, h.total, h.elapsed,
    ...fieldNos.flatMap((no): Cell[] => {
      const f = h.fields[no];
      return f ? [f.c, f.t, pct(f.c, f.t)] : ["", "", ""];
    })]);
  const csv = "﻿" + [header, ...rows].map((r) => r.map(esc).join(",")).join("\r\n");

  const d = new Date();
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = el("a", { href: url, download: `${ex.code}_成績_${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv` });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function initScores(): void {
  const open = () => { renderScores(); showScreen("scores"); };
  $("btn-open-scores").addEventListener("click", open);
  $("btn-result-scores").addEventListener("click", open);
  $("btn-scores-home").addEventListener("click", () => showScreen("start"));
  $("btn-csv").addEventListener("click", exportCsv);
  $("btn-clear-scores").addEventListener("click", () => {
    const ex = exam();
    if (!confirm(`${ex.code} の成績履歴と出題回数の記録を削除します。元に戻せません。よろしいですか？`)) return;
    storage.remove(ex.key, "history");
    storage.remove(ex.key, "seen");
    renderScores();
  });
}

// ===== 問題一覧 =====
function initList(): void {
  for (const id of ["list-field", "list-type", "list-source"]) $(id).addEventListener("change", renderList);
  $("list-keyword").addEventListener("input", renderList);

  $("btn-open-list").addEventListener("click", () => { renderList(); showScreen("list"); });
  $("btn-list-home").addEventListener("click", () => showScreen("start"));
  $("d-back").addEventListener("click", () => { renderList(); showScreen("list"); });
  $("d-prev").addEventListener("click", () => openDetail(browse.index - 1));
  $("d-next").addEventListener("click", () => openDetail(browse.index + 1));
  $("d-check").addEventListener("click", () => {
    const q = browse.filtered[browse.index];
    browse.results.set(q.id, isCorrect(q, pickedOf(q)));
    renderDetail();
  });
  $("d-show").addEventListener("click", () => { browse.revealed = true; renderDetail(); });
}

function pickedOf(q: Question): Set<number> {
  let s = browse.picks.get(q.id);
  if (!s) browse.picks.set(q.id, (s = new Set()));
  return s;
}

// 絞り込み条件（zod で検証）に合う問題を一覧表示する
function renderList(): void {
  const ex = exam();
  const errorBox = $("list-error");
  const parsed = ListFilterSchema.safeParse({
    field: $<HTMLSelectElement>("list-field").value,
    type: $<HTMLSelectElement>("list-type").value,
    source: ex.hasGuidebook ? $<HTMLSelectElement>("list-source").value : "",
    keyword: $<HTMLInputElement>("list-keyword").value,
  });
  if (!parsed.success) {
    errorBox.textContent = firstMessage(parsed.error);
    errorBox.hidden = false;
    return;
  }
  errorBox.hidden = true;
  const { field, type, source, keyword } = parsed.data;
  const kw = keyword.toLowerCase();

  browse.filtered = ex.questions.filter((q) => {
    if (field && String(q.field) !== field) return false;
    if (type && q.type !== type) return false;
    if (source === "gb" && !q.src) return false;
    if (source === "base" && q.src) return false;
    if (kw && ![q.id, q.oid, q.q, ...q.choices].join("\n").toLowerCase().includes(kw)) return false;
    return true;
  });

  $("list-count").textContent = `${browse.filtered.length} 問を表示中（全 ${ex.questions.length} 問）`;
  const body = $("list-body");
  body.replaceChildren();
  browse.filtered.forEach((q, i) => {
    const done = browse.results.get(q.id);
    const row = el("button", { type: "button", class: "q-row", onclick: () => openDetail(i) },
      el("span", { class: "font-bold tabular-nums", text: q.id }),
      el("span", { class: "line-clamp-2", text: q.q }),
      el("span", {
        class: "muted col-start-2 text-sm",
        text: `${fieldName(q)} ／ ${q.oid} ／ ${q.type === "multi" ? "複数回答" : "単一回答"}` +
          (done === undefined ? "" : done ? " ／ ○ 正解済み" : " ／ × 不正解"),
      }));
    if (done !== undefined) row.dataset.result = done ? "ok" : "ng";
    body.append(row);
  });
}

function openDetail(i: number): void {
  browse.index = i;
  browse.revealed = false;
  // もう一度解き直せるよう、詳細を開くたびに回答状態をリセットする
  const q = browse.filtered[i];
  browse.picks.set(q.id, new Set());
  browse.results.delete(q.id);
  showScreen("detail");
  renderDetail();
}

function renderDetail(): void {
  const i = browse.index;
  const q = browse.filtered[i];
  const picked = pickedOf(q);
  const answered = browse.results.has(q.id);
  const locked = answered || browse.revealed;

  $("d-position").textContent = `${i + 1} / ${browse.filtered.length}（ID：${q.id}）`;
  $("d-meta").textContent = `${fieldName(q)} ／ ${q.oid}`;
  $("d-type").textContent = typeLabel(q);
  $("d-text").textContent = q.q;
  renderChoices($("d-choices"), q, picked, locked, "d-choice", renderDetail);

  const fb = $("d-feedback");
  if (answered) {
    const ok = browse.results.get(q.id) === true;
    showFeedback(fb, ok ? "ok" : "ng", feedbackNodes(q, ok));
  } else if (browse.revealed) {
    showFeedback(fb, "", [
      el("div", { class: "font-bold", text: `正解：${answerText(q)}` }),
      el("div", { text: q.explain }),
      ...sourceNodes(q),
    ]);
  } else {
    fb.hidden = true;
  }

  $<HTMLButtonElement>("d-prev").disabled = i === 0;
  $<HTMLButtonElement>("d-next").disabled = i === browse.filtered.length - 1;
  $<HTMLButtonElement>("d-check").disabled = locked || picked.size === 0;
  $<HTMLButtonElement>("d-show").disabled = locked;
}

// ===== 起動 =====
// ダミー成績の自動投入は無効化（二度と動かさない）
// seedDemoHistory(examResults.flatMap((r) => (r.ok ? [r.exam] : [])));
initTop();
initStart();
initQuizButtons();
initResult();
initList();
initScores();
goTop();
