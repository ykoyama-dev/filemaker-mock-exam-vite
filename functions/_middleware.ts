// Cloudflare Pages Functions のミドルウェア：サイト全体に Basic 認証をかける
// ユーザー名とパスワードはコードに書かず、Cloudflare の環境変数（シークレット）から読み込む
//   BASIC_AUTH_USER     … ユーザー名
//   BASIC_AUTH_PASSWORD … パスワード
// どちらかが未設定（空欄）の場合は、誤って無防備に公開しないよう、サイトを表示しない

interface Env {
  BASIC_AUTH_USER?: string;
  BASIC_AUTH_PASSWORD?: string;
}

// Pages Functions から渡される引数のうち、ここで使うものだけを定義する
interface PagesContext {
  request: Request;
  env: Env;
  next: () => Promise<Response>;
}

const REALM = "FileMaker Mock Exam";

// 認証に失敗したときの応答（ブラウザにユーザー名・パスワードの入力画面を出させる）
function unauthorized(): Response {
  return new Response("認証が必要です。ユーザー名とパスワードを入力してください。", {
    status: 401,
    headers: {
      "WWW-Authenticate": `Basic realm="${REALM}", charset="UTF-8"`,
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

// Authorization ヘッダー（"Basic base64(ユーザー名:パスワード)"）を解析する
function parseBasicAuth(header: string | null): { user: string; password: string } | null {
  if (!header) return null;
  const [scheme, encoded] = header.split(" ");
  if (!scheme || scheme.toLowerCase() !== "basic" || !encoded) return null;
  let decoded: string;
  try {
    // 日本語などを含む場合に備え、UTF-8 として復号する
    const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
    decoded = new TextDecoder().decode(bytes);
  } catch {
    return null;
  }
  const sep = decoded.indexOf(":");
  if (sep < 0) return null;
  return { user: decoded.slice(0, sep), password: decoded.slice(sep + 1) };
}

// 文字列を比較する。比較にかかる時間から内容を推測されないよう、
// 両方を SHA-256 にしてから全バイトを比べる
async function safeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const va = new Uint8Array(ha);
  const vb = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < va.length; i++) diff |= va[i] ^ vb[i];
  return diff === 0;
}

export const onRequest = async ({ request, env, next }: PagesContext): Promise<Response> => {
  const expectedUser = env.BASIC_AUTH_USER ?? "";
  const expectedPassword = env.BASIC_AUTH_PASSWORD ?? "";

  // 認証情報が未設定の場合はサイトを表示しない（設定漏れによる公開を防ぐ）
  if (!expectedUser || !expectedPassword) {
    return new Response("Basic 認証のユーザー名・パスワードが設定されていません。Cloudflare の環境変数 BASIC_AUTH_USER と BASIC_AUTH_PASSWORD を設定してください。", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const credentials = parseBasicAuth(request.headers.get("Authorization"));
  if (!credentials) return unauthorized();

  // ユーザー名とパスワードの両方を必ず比較する（片方だけで判定を終えない）
  const [userOk, passwordOk] = await Promise.all([
    safeEqual(credentials.user, expectedUser),
    safeEqual(credentials.password, expectedPassword),
  ]);
  if (!userOk || !passwordOk) return unauthorized();

  return next();
};
