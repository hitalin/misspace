import { redirect } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { FETCH_TIMEOUT_MS, parseCheck, PENDING_COOKIE, SESSION_COOKIE, USER_AGENT } from '$lib/auth';

const fail = (reason: string): never =>
	redirect(303, `/?login_error=${encodeURIComponent(reason)}`);

// Misskey で許可したあとの戻り先。セッション id を照合し、トークンを受け取ってログイン状態にする
export const GET: RequestHandler = async ({ url, cookies }) => {
	const session = url.searchParams.get('session');
	const pending = cookies.get(PENDING_COOKIE);
	cookies.delete(PENDING_COOKIE, { path: '/' });
	if (!session || !pending) {
		return fail('ログインの途中の情報が見つかりません。もう一度お試しください');
	}
	const sep = pending.indexOf(':');
	const [pendingSession, host] = [pending.slice(0, sep), pending.slice(sep + 1)];
	if (pendingSession !== session || !host) {
		return fail('ログインの照合に失敗しました。もう一度お試しください');
	}

	let data: unknown;
	try {
		const res = await fetch(`https://${host}/api/miauth/${encodeURIComponent(session)}/check`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': USER_AGENT
			},
			body: JSON.stringify({}),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});
		if (!res.ok) return fail(`${host} が認証を確認できませんでした`);
		data = await res.json();
	} catch {
		return fail(`${host} に接続できません`);
	}

	const sessionData = parseCheck(data, host);
	if (!sessionData) return fail('認証が許可されませんでした');

	// セッションCookieを設定（7日間有効）
	cookies.set(SESSION_COOKIE, JSON.stringify(sessionData), {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax',
		maxAge: 60 * 60 * 24 * 7
	});

	redirect(303, '/');
};
