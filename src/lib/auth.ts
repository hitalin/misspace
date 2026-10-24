// 認証関連のユーティリティ（MiAuth）

export const APP_NAME = 'misspace';
export const PERMISSIONS = ['read:account', 'read:federation', 'write:notes', 'write:drive'];
export const SESSION_COOKIE = 'misspace_session';
// ログイン開始から戻ってくるまでの照合用（MiAuth のセッション id とホスト）
export const PENDING_COOKIE = 'misspace_miauth';
export const USER_AGENT = 'misspace/1.0 (Fediverse Map)';
export const FETCH_TIMEOUT_MS = 10_000;

// 入力（ホスト名や URL）からホスト名だけを取り出す。ホストと言えなければ null
export function normalizeHost(input: string): string | null {
	const s = input.trim().toLowerCase();
	if (!s) return null;
	try {
		const host = new URL(s.includes('://') ? s : `https://${s}`).hostname;
		return host.includes('.') ? host : null;
	} catch {
		return null;
	}
}

// MiAuth の開始 URL。許可後に ${origin}/auth/callback?session=<session> へ戻ってくる
export function miauthUrl(host: string, session: string, origin: string): string {
	const u = new URL(`https://${host}/miauth/${session}`);
	u.searchParams.set('name', APP_NAME);
	u.searchParams.set('callback', `${origin}/auth/callback`);
	u.searchParams.set('permission', PERMISSIONS.join(','));
	return u.toString();
}

// セッションデータの型
export interface SessionData {
	host: string;
	username: string;
	displayName?: string;
	avatarUrl?: string;
	token: string;
}

// /api/miauth/{session}/check の応答をセッションデータに変換する
export function parseCheck(data: unknown, host: string): SessionData | null {
	if (!data || typeof data !== 'object') return null;
	const d = data as { ok?: unknown; token?: unknown; user?: unknown };
	if (d.ok !== true || typeof d.token !== 'string' || !d.user || typeof d.user !== 'object') {
		return null;
	}
	const u = d.user as { username?: unknown; name?: unknown; avatarUrl?: unknown };
	if (typeof u.username !== 'string') return null;
	return {
		host,
		username: u.username,
		displayName: typeof u.name === 'string' && u.name ? u.name : u.username,
		avatarUrl: typeof u.avatarUrl === 'string' ? u.avatarUrl : undefined,
		token: d.token
	};
}

// Cookieからセッションをパース
export function parseSession(cookieValue: string | undefined): SessionData | null {
	if (!cookieValue) return null;
	try {
		return JSON.parse(cookieValue);
	} catch {
		return null;
	}
}
