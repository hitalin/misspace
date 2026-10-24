import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { parseSession } from '$lib/auth';

interface FederationInstance {
	host: string;
	usersCount?: number;
	notesCount?: number;
	isBlocked?: boolean;
	isSuspended?: boolean;
}

export const POST: RequestHandler = async ({ request, cookies }) => {
	const body = (await request.json()) as { seedServer?: string };
	const { seedServer } = body;

	// セッションから認証情報を取得
	const session = parseSession(cookies.get('misspace_session'));
	// ユーザーが自分のサーバーにリクエストする場合のみトークンを使用（大文字小文字無視）
	const authToken =
		session && session.host.toLowerCase() === seedServer?.toLowerCase()
			? session.token
			: null;

	// デバッグログ
	console.log('[Federation API] seedServer:', seedServer);
	console.log('[Federation API] session host:', session?.host);
	console.log('[Federation API] authToken exists:', !!authToken);

	if (!seedServer || typeof seedServer !== 'string') {
		return json({ error: 'seedServer is required' }, { status: 400 });
	}

	try {
		// ページネーションで複数回取得（最大300件）
		const allInstances: FederationInstance[] = [];
		let offset = 0;
		const limit = 30; // Misskey APIの最大値
		const maxFetches = 10; // 最大10回 = 300件

		for (let i = 0; i < maxFetches; i++) {
			// 認証トークンがある場合は含める
			const requestBody = authToken
				? { i: authToken, limit, offset, sort: '+pubSub' }
				: { limit, offset, sort: '+pubSub' };

			const res = await fetch(`https://${seedServer}/api/federation/instances`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': 'misspace/1.0 (Fediverse Map)'
				},
				body: JSON.stringify(requestBody)
			});

			if (!res.ok) {
				const errorText = await res.text();
				let errorData: { error?: { code?: string; message?: string } } = {};
				try {
					errorData = JSON.parse(errorText);
				} catch {
					// ignore parse error
				}

				// デバッグログ
				console.log('[Federation API] Error response:', res.status, errorData);
				console.log('[Federation API] Was authenticated:', !!authToken);

				if (errorData?.error?.code === 'CREDENTIAL_REQUIRED') {
					// 認証トークンを送ったのにまだCREDENTIAL_REQUIREDなら、権限不足
					const message = authToken
						? `${seedServer} の連合情報を閲覧する権限がありません（管理者権限が必要な場合があります）`
						: `${seedServer} は連合情報を公開していません（認証が必要）`;
					return json(
						{
							error: 'CREDENTIAL_REQUIRED',
							message,
							authenticated: !!authToken
						},
						{ status: 403 }
					);
				}

				if (errorData?.error?.code === 'PERMISSION_DENIED') {
					// アプリの権限不足 → 再認証を促す
					return json(
						{
							error: 'PERMISSION_DENIED',
							message: `アプリの権限が不足しています。一度ログアウトして再度ログインしてください。`,
							authenticated: !!authToken
						},
						{ status: 403 }
					);
				}
				// 最初のリクエストで失敗したらエラーを返す
				if (i === 0) {
					return json(
						{
							error: 'FETCH_FAILED',
							message: `${seedServer} から連合情報を取得できませんでした (${res.status})`
						},
						{ status: res.status }
					);
				}
				break;
			}

			const instances = (await res.json()) as FederationInstance[];
			allInstances.push(...instances);

			// 取得件数がlimit未満なら終了
			if (instances.length < limit) {
				break;
			}
			offset += limit;
		}

		// 正常な連合関係
		const normalFederations = allInstances
			.filter((inst) => !inst.isBlocked && !inst.isSuspended)
			.map((inst) => ({
				sourceHost: seedServer,
				targetHost: inst.host,
				usersCount: inst.usersCount ?? 0,
				notesCount: inst.notesCount ?? 0,
				isBlocked: false,
				isSuspended: false
			}));

		// ブロック関係も取得
		let blockedFederations: Array<{
			sourceHost: string;
			targetHost: string;
			usersCount: number;
			notesCount: number;
			isBlocked: boolean;
			isSuspended: boolean;
		}> = [];

		try {
			// ブロック情報も認証トークンがあれば含める
			const blockedRequestBody = authToken
				? { i: authToken, limit: 30, blocked: true }
				: { limit: 30, blocked: true };

			const blockedRes = await fetch(`https://${seedServer}/api/federation/instances`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'User-Agent': 'misspace/1.0 (Fediverse Map)'
				},
				body: JSON.stringify(blockedRequestBody)
			});

			if (blockedRes.ok) {
				const blockedInstances = (await blockedRes.json()) as FederationInstance[];
				blockedFederations = blockedInstances.map((inst) => ({
					sourceHost: seedServer,
					targetHost: inst.host,
					usersCount: inst.usersCount ?? 0,
					notesCount: inst.notesCount ?? 0,
					isBlocked: inst.isBlocked ?? true,
					isSuspended: inst.isSuspended ?? false
				}));
			}
		} catch {
			// ブロック情報取得に失敗しても続行
		}

		return json({
			federations: [...normalFederations, ...blockedFederations],
			authenticated: !!authToken // 認証付きで取得したかどうか
		});
	} catch (e) {
		console.error(`Failed to fetch federations from ${seedServer}:`, e);
		return json(
			{
				error: 'CONNECTION_FAILED',
				message: `${seedServer} への接続に失敗しました`
			},
			{ status: 500 }
		);
	}
};
