import type { AuthUser, AuthState } from '$lib/types';

// 認証状態（Svelte 5 runes）
let authState = $state<AuthState>({
	isLoggedIn: false,
	user: null,
	isLoading: true
});

// 認証状態を取得
export function getAuthState(): AuthState {
	return authState;
}

// 初期化（ページロード時に呼び出し）
export async function initAuth(): Promise<void> {
	authState.isLoading = true;

	try {
		const res = await fetch('/api/auth/me');
		const data = await res.json();

		if (data.user) {
			authState.isLoggedIn = true;
			authState.user = data.user;
		} else {
			authState.isLoggedIn = false;
			authState.user = null;
		}
	} catch {
		authState.isLoggedIn = false;
		authState.user = null;
	} finally {
		authState.isLoading = false;
	}
}

// ログイン開始
export async function startLogin(host: string): Promise<{ success: boolean; url?: string; error?: string }> {
	try {
		const res = await fetch('/api/auth/login', {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify({ host })
		});

		const data = await res.json();

		if (!res.ok) {
			return { success: false, error: data.error };
		}

		return { success: true, url: data.url };
	} catch {
		return { success: false, error: '通信エラーが発生しました' };
	}
}

// ログアウト
export async function logout(): Promise<void> {
	try {
		await fetch('/api/auth/logout', { method: 'POST' });
	} catch {
		// エラーは無視
	}

	authState.isLoggedIn = false;
	authState.user = null;
}

// ユーザー情報を更新
export function setUser(user: AuthUser | null): void {
	if (user) {
		authState.isLoggedIn = true;
		authState.user = user;
	} else {
		authState.isLoggedIn = false;
		authState.user = null;
	}
	authState.isLoading = false;
}
