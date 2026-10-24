import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { dev } from '$app/environment';
import { FETCH_TIMEOUT_MS, miauthUrl, normalizeHost, PENDING_COOKIE, USER_AGENT } from '$lib/auth';

const PENDING_SECONDS = 60 * 10;

// インスタンスがMisskey系かどうかを確認
async function isMisskeyInstance(host: string): Promise<{ isMisskey: boolean; error?: string }> {
	try {
		const res = await fetch(`https://${host}/api/meta`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				'User-Agent': USER_AGENT
			},
			body: JSON.stringify({}),
			signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
		});

		if (!res.ok) {
			console.log(`[Login] /api/meta returned ${res.status} for ${host}`);
			return { isMisskey: false, error: `サーバーからエラー応答 (${res.status})` };
		}

		const data = await res.json();
		// Misskey系ならversionが存在する
		if (data.version) {
			console.log(`[Login] Detected Misskey ${data.version} on ${host}`);
			return { isMisskey: true };
		}

		return { isMisskey: false, error: 'Misskey APIが見つかりません' };
	} catch (e) {
		const error = e as Error;
		if (error.name === 'TimeoutError') {
			console.log(`[Login] Timeout checking ${host}`);
			return { isMisskey: false, error: 'サーバーへの接続がタイムアウトしました' };
		}
		console.log(`[Login] Error checking ${host}:`, error.message);
		return { isMisskey: false, error: `接続エラー: ${error.message}` };
	}
}

// MiAuth を開始する。戻り先で照合するため、セッション id とホストを短命の Cookie に残す
export const POST: RequestHandler = async ({ request, url, cookies }) => {
	let data: { host?: unknown };

	try {
		data = await request.json();
	} catch {
		return json({ error: 'Invalid request body' }, { status: 400 });
	}

	const host = typeof data.host === 'string' ? normalizeHost(data.host) : null;

	if (!host) {
		return json({ error: 'Host is required' }, { status: 400 });
	}

	// Misskey系インスタンスかチェック
	const checkResult = await isMisskeyInstance(host);
	if (!checkResult.isMisskey) {
		return json(
			{ error: checkResult.error || 'このサーバーはMisskey系ではないようです' },
			{ status: 400 }
		);
	}

	const session = crypto.randomUUID();
	cookies.set(PENDING_COOKIE, `${session}:${host}`, {
		path: '/',
		httpOnly: true,
		secure: !dev,
		sameSite: 'lax',
		maxAge: PENDING_SECONDS
	});

	return json({ url: miauthUrl(host, session, url.origin), host });
};
