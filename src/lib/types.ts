export type AgeRestriction = 'all' | '13+' | '18+' | 'unknown';
export type ServerScale = 'large' | 'medium' | 'small';

// Misskey本家バージョンの追従度
// v12-: v12以前のセマンティックバージョニング
// v13: v13系セマンティックバージョニング
// cal{YYYY}: カレンダーバージョニング（YYYY.MM.patch）
// unknown: 判定不能
export type VersionTrack =
	| 'v12-'
	| 'v13'
	| 'cal2023'
	| 'cal2024'
	| 'cal2025'
	| 'cal2026'
	| 'unknown';

// 新規登録の状態（複数選択可能）
export type RegistrationStatus = 'open' | 'approval' | 'invite' | 'closed';

// メールアドレスの要件
export type EmailRequirement = 'required' | 'notRequired' | null;

// エッジ（関係線）の表示設定
export interface EdgeVisibility {
	showFederation: boolean;      // 通常の連合関係を表示
	showBlocked: boolean;         // ブロック関係を表示
	showSuspended: boolean;       // 配信停止関係を表示
	showConnectivityOk: boolean;  // 疎通OK関係を表示
	showConnectivityNg: boolean;  // 疎通NG関係を表示
}

export const DEFAULT_EDGE_VISIBILITY: EdgeVisibility = {
	showFederation: true,
	showBlocked: true,
	showSuspended: true,
	showConnectivityOk: true,
	showConnectivityNg: true
};

export interface ServerFilter {
	// 新規登録（複数選択可能）
	registrationStatus: RegistrationStatus[];

	// メールアドレス要件
	emailRequirement: EmailRequirement;

	// 年齢制限
	ageRestriction: AgeRestriction | null;

	// リポジトリURL（複数選択可能）
	repositoryUrls: string[];

	// 規模
	scale: ServerScale[];

	// バージョン追従度（複数選択可能）
	versionTracks: VersionTrack[];

	// エッジ表示設定
	edgeVisibility: EdgeVisibility;
}

export const DEFAULT_FILTER: ServerFilter = {
	registrationStatus: [],
	emailRequirement: null,
	ageRestriction: null,
	repositoryUrls: [],
	scale: [],
	versionTracks: [],
	edgeVisibility: { ...DEFAULT_EDGE_VISIBILITY }
};

// 視点サーバーの選定基準
export type ViewpointCriteria = 'dru15' | 'npd15' | 'users';

export interface UserSettings {
	viewpointServers: string[]; // 視点サーバーのリスト
	viewpointCriteria: ViewpointCriteria; // デフォルト視点の選定基準
	bookmarks: string[]; // お気に入りサーバーのリスト
}

export const DEFAULT_SETTINGS: UserSettings = {
	viewpointServers: ['misskey.io'],
	viewpointCriteria: 'dru15',
	bookmarks: []
};

// ========== 認証関連 ==========

// ログイン中のユーザー情報
export interface AuthUser {
	host: string;
	username: string;
	displayName?: string;
	avatarUrl?: string;
}

// 認証状態
export interface AuthState {
	isLoggedIn: boolean;
	user: AuthUser | null;
	isLoading: boolean;
}

// 永続化するユーザー設定
export interface PersistedSettings {
	viewpointServers: string[];
	viewpointCriteria: ViewpointCriteria;
	edgeVisibility: EdgeVisibility;
	bookmarks: string[];
}
