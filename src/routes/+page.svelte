<script lang="ts">
	import '../app.css';
	import type { PageData } from './$types';
	import FilterPanel from '$lib/components/FilterPanel.svelte';
	import SettingsPanel from '$lib/components/SettingsPanel.svelte';
	import FederationGraph from '$lib/components/FederationGraph.svelte';
	import ServerInfoPopup from '$lib/components/ServerInfoPopup.svelte';
	import SearchPanel from '$lib/components/SearchPanel.svelte';
	import FederatedSoftwarePanel from '$lib/components/FederatedSoftwarePanel.svelte';
	import LoginModal from '$lib/components/LoginModal.svelte';
	import {
		DEFAULT_FILTER,
		DEFAULT_SETTINGS,
		DEFAULT_EDGE_VISIBILITY,
		type ServerFilter,
		type ServerScale,
		type UserSettings,
		type RegistrationStatus,
		type EmailRequirement,
		type AgeRestriction,
		type EdgeVisibility,
		type VersionTrack
	} from '$lib/types';
	import { getServerScale, getVersionTrack, type ServerInfo } from '$lib/collector';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { getAuthState, initAuth } from '$lib/stores/auth.svelte';

	// リポジトリURLの短縮形マッピング
	const REPO_SHORTCUTS: Record<string, string> = {
		'misskey': 'https://github.com/misskey-dev/misskey',
		'sharkey': 'https://activitypub.software/TransFem-org/Sharkey',
		'firefish': 'https://git.joinfirefish.org/firefish/firefish',
		'cherrypick': 'https://github.com/kokonect-link/cherrypick',
		'catodon': 'https://codeberg.org/catodon/catodon',
		'iceshrimp': 'https://iceshrimp.dev/iceshrimp/iceshrimp',
		'meisskey': 'https://github.com/mei23/misskey',
		'foundkey': 'https://akkoma.dev/FoundKeyGang/FoundKey'
	};

	// 逆マッピング（URL → 短縮形）
	const REPO_URL_TO_SHORTCUT = Object.fromEntries(
		Object.entries(REPO_SHORTCUTS).map(([k, v]) => [v, k])
	);

	// バージョン追従度の短縮形（URL → 内部値）
	const VERSION_TRACK_FROM_SHORTCUT: Record<string, VersionTrack> = {
		'v12': 'v12-',
		'v13': 'v13',
		'2023': 'cal2023',
		'2024': 'cal2024',
		'2025': 'cal2025',
		'2026': 'cal2026',
		'?': 'unknown'
	};

	// バージョン追従度の短縮形（内部値 → URL）
	const VERSION_TRACK_TO_SHORTCUT: Record<VersionTrack, string> = {
		'v12-': 'v12',
		'v13': 'v13',
		'cal2023': '2023',
		'cal2024': '2024',
		'cal2025': '2025',
		'cal2026': '2026',
		'unknown': '?'
	};

	// URLクエリパラメータからフィルター状態を読み込む
	function parseFilterFromQuery(params: URLSearchParams): Partial<ServerFilter> {
		const filter: Partial<ServerFilter> = {};

		// 登録状態（~区切り）
		const regStatus = params.get('reg');
		if (regStatus) {
			const statuses = regStatus.split('~').filter(s =>
				['open', 'approval', 'invite', 'closed'].includes(s)
			) as RegistrationStatus[];
			if (statuses.length > 0) filter.registrationStatus = statuses;
		}

		// メールアドレス要件（yes/no形式）
		const email = params.get('email');
		if (email === 'yes') {
			filter.emailRequirement = 'required';
		} else if (email === 'no') {
			filter.emailRequirement = 'notRequired';
		}

		// 年齢制限
		const age = params.get('age');
		if (age === '13' || age === '13+') {
			filter.ageRestriction = '13+';
		} else if (age === '18' || age === '18+') {
			filter.ageRestriction = '18+';
		}

		// 規模（~区切り、L/M/S短縮形も対応）
		const scale = params.get('size');
		if (scale) {
			const scaleMap: Record<string, ServerScale> = {
				'large': 'large', 'L': 'large',
				'medium': 'medium', 'M': 'medium',
				'small': 'small', 'S': 'small'
			};
			const scales = scale.split('~')
				.map(s => scaleMap[s])
				.filter((s): s is ServerScale => s !== undefined);
			if (scales.length > 0) filter.scale = scales;
		}

		// リポジトリURL（短縮形対応、~区切り）
		const repo = params.get('soft');
		if (repo) {
			filter.repositoryUrls = repo.split('~').map(r => {
				// 短縮形ならフルURLに変換
				return REPO_SHORTCUTS[r.toLowerCase()] || decodeURIComponent(r);
			});
		}

		// バージョン追従度（短縮形、~区切り）
		const ver = params.get('ver');
		if (ver) {
			const tracks = ver.split('~')
				.map(v => VERSION_TRACK_FROM_SHORTCUT[v])
				.filter((t): t is VersionTrack => t !== undefined);
			if (tracks.length > 0) filter.versionTracks = tracks;
		}

		// エッジ表示設定（短縮形: fed/blk/sus/cok/cng、~区切り、非表示のもののみ指定）
		const hideEdges = params.get('hide');
		if (hideEdges) {
			const edgeVisibility: EdgeVisibility = { ...DEFAULT_EDGE_VISIBILITY };
			const hideList = hideEdges.split('~');
			if (hideList.includes('fed')) edgeVisibility.showFederation = false;
			if (hideList.includes('blk')) edgeVisibility.showBlocked = false;
			if (hideList.includes('sus')) edgeVisibility.showSuspended = false;
			if (hideList.includes('cok')) edgeVisibility.showConnectivityOk = false;
			if (hideList.includes('cng')) edgeVisibility.showConnectivityNg = false;
			filter.edgeVisibility = edgeVisibility;
		}

		return filter;
	}

	// URLクエリパラメータから視点サーバーを読み込む（複数のfromパラメータ）
	function parseViewpointsFromQuery(params: URLSearchParams): string[] | null {
		const viewpoints = params.getAll('from');
		if (viewpoints.length > 0) {
			return viewpoints.map(s => s.trim()).filter(s => s.length > 0);
		}
		return null;
	}

	// URLクエリパラメータからフォーカスホストを読み込む
	function parseFocusFromQuery(params: URLSearchParams): string | null {
		return params.get('focus');
	}

	// URLクエリパラメータから選択状態を読み込む
	// サーバー: "host.example"
	// エッジ: "hostA..hostB" (2つのホストを..で区切り)
	function parseSelectFromQuery(params: URLSearchParams): { type: 'node' | 'edge'; value: string } | null {
		const select = params.get('select');
		if (!select) return null;

		// ".."を含む場合はエッジ
		if (select.includes('..')) {
			return { type: 'edge', value: select };
		}
		return { type: 'node', value: select };
	}

	// フィルター状態をURLクエリパラメータに変換（人間が読みやすい形式）
	function filterToQuery(
		filter: ServerFilter,
		viewpointServers: string[],
		defaultViewpoints: string[],
		focus: string | null,
		select: string | null
	): URLSearchParams {
		const params = new URLSearchParams();

		// 登録状態（~区切り）
		if (filter.registrationStatus.length > 0) {
			params.set('reg', filter.registrationStatus.join('~'));
		}

		// メールアドレス要件（yes/no形式）
		if (filter.emailRequirement === 'required') {
			params.set('email', 'yes');
		} else if (filter.emailRequirement === 'notRequired') {
			params.set('email', 'no');
		}

		// 年齢制限（数字のみ）
		if (filter.ageRestriction === '13+') {
			params.set('age', '13');
		} else if (filter.ageRestriction === '18+') {
			params.set('age', '18');
		}

		// 規模（L/M/S短縮形、~区切り）
		if (filter.scale.length > 0) {
			const shortScale = filter.scale.map(s => {
				if (s === 'large') return 'L';
				if (s === 'medium') return 'M';
				return 'S';
			});
			params.set('size', shortScale.join('~'));
		}

		// リポジトリURL（短縮形、~区切り）
		if (filter.repositoryUrls.length > 0) {
			const shortRepos = filter.repositoryUrls.map(url => {
				// 短縮形があればそれを使用
				return REPO_URL_TO_SHORTCUT[url] || encodeURIComponent(url);
			});
			params.set('soft', shortRepos.join('~'));
		}

		// バージョン追従度（短縮形、~区切り）
		if (filter.versionTracks.length > 0) {
			const shortTracks = filter.versionTracks.map(t => VERSION_TRACK_TO_SHORTCUT[t]);
			params.set('ver', shortTracks.join('~'));
		}

		// 視点サーバー（複数のfromパラメータ、デフォルトと異なる場合のみ）
		const vpSorted = [...viewpointServers].sort();
		const defaultSorted = [...defaultViewpoints].sort();
		const isDefault = vpSorted.length === defaultSorted.length &&
			vpSorted.every((v, i) => v === defaultSorted[i]);
		if (!isDefault && viewpointServers.length > 0) {
			for (const vp of viewpointServers) {
				params.append('from', vp);
			}
		}

		// フォーカスホスト
		if (focus) {
			params.set('focus', focus);
		}

		// 選択中サーバー
		if (select) {
			params.set('select', select);
		}

		// エッジ表示設定（非表示のもののみを短縮形で指定）
		const hiddenEdges: string[] = [];
		if (!filter.edgeVisibility.showFederation) hiddenEdges.push('fed');
		if (!filter.edgeVisibility.showBlocked) hiddenEdges.push('blk');
		if (!filter.edgeVisibility.showSuspended) hiddenEdges.push('sus');
		if (!filter.edgeVisibility.showConnectivityOk) hiddenEdges.push('cok');
		if (!filter.edgeVisibility.showConnectivityNg) hiddenEdges.push('cng');
		if (hiddenEdges.length > 0) {
			params.set('hide', hiddenEdges.join('~'));
		}

		return params;
	}

	// URLを更新（履歴にプッシュせずに置換）
	function updateUrl(
		filter: ServerFilter,
		viewpointServers: string[],
		defaultViewpoints: string[],
		focus: string | null = null,
		select: string | null = null
	) {
		if (!browser) return;
		const params = filterToQuery(filter, viewpointServers, defaultViewpoints, focus, select);
		const queryString = params.toString();
		const newUrl = queryString ? `?${queryString}` : window.location.pathname;
		// 現在のURLと同じなら更新しない
		if (window.location.search === (queryString ? `?${queryString}` : '')) return;
		goto(newUrl, { replaceState: true, keepFocus: true, noScroll: true });
	}

	let { data }: { data: PageData } = $props();

	// モバイル判定
	let isMobile = $state(false);

	// ブラウザ環境でモバイル判定
	$effect(() => {
		if (browser) {
			const checkMobile = () => {
				isMobile = window.innerWidth <= 768;
			};
			checkMobile();
			window.addEventListener('resize', checkMobile);
			return () => window.removeEventListener('resize', checkMobile);
		}
	});

	interface FederationInfo {
		sourceHost: string;
		targetHost: string;
		usersCount: number;
		notesCount: number;
		isBlocked: boolean;
		isSuspended: boolean;
	}

	let filter: ServerFilter = $state({ ...DEFAULT_FILTER });
	let settings: UserSettings = $state({ ...DEFAULT_SETTINGS });
	let isLoading = $state(false);
	let loadingProgress = $state(0); // ローディング進捗（0-100）
	let additionalFederations = $state<FederationInfo[]>([]); // 追加取得した連合情報
	let privateServers = $state<Set<string>>(new Set()); // 連合情報を公開していないサーバー
	let initialized = $state(false);
	let focusHost = $state(''); // グラフ上でフォーカスするホスト（一時的）

	// 認証関連
	let authState = $derived(getAuthState());
	let showLoginModal = $state(false);
	let loginError = $state<string | null>(null); // MiAuth の戻り先で失敗したとき（?login_error=）
	// 選択状態（URL連動）: サーバーの場合は "host.example"、エッジの場合は "hostA..hostB"
	let selectedItem = $state<{ type: 'node' | 'edge'; value: string } | null>(null);

	// SSRで取得済みの視点サーバーリスト
	let ssrViewpoints = $derived(() => {
		const hosts = new Set<string>();
		for (const fed of data.federations as FederationInfo[]) {
			hosts.add(fed.sourceHost);
		}
		return Array.from(hosts);
	});

	// SSRで事前計算されたトップ候補を取得
	function getPrecomputedTopServers(criteria: import('$lib/types').ViewpointCriteria): string[] {
		if (criteria === 'dru15' && (data.topByDru15 as string[] | undefined)) {
			return (data.topByDru15 as string[]).slice(0, 3);
		}
		if (criteria === 'npd15' && (data.topByNpd15 as string[] | undefined)) {
			return (data.topByNpd15 as string[]).slice(0, 3);
		}
		if (criteria === 'users' && (data.topByUsers as string[] | undefined)) {
			return (data.topByUsers as string[]).slice(0, 3);
		}
		// フォールバック: SSRデータがない場合のみクライアント側で計算
		return calculateTopServers(criteria, data.servers as ServerInfo[], 3);
	}

	// 各指標ごとのトップサーバーを計算（フォールバック用）
	function calculateTopServers(criteria: import('$lib/types').ViewpointCriteria, servers: ServerInfo[], count: number = 3): string[] {
		const sorted = servers.filter(s => {
			if (criteria === 'dru15') return (s.dru15 ?? 0) > 0;
			if (criteria === 'npd15') return (s.npd15 ?? 0) > 0;
			if (criteria === 'users') return (s.usersCount ?? 0) > 0;
			return false;
		}).sort((a, b) => {
			if (criteria === 'dru15') return (b.dru15 ?? 0) - (a.dru15 ?? 0);
			if (criteria === 'npd15') return (b.npd15 ?? 0) - (a.npd15 ?? 0);
			if (criteria === 'users') return (b.usersCount ?? 0) - (a.usersCount ?? 0);
			return 0;
		});

		return sorted.slice(0, count).map(s => s.host);
	}

	// 現在の選定基準に基づくデフォルト視点サーバー
	let computedDefaultViewpoints = $derived(() => {
		// SSRで事前計算された値を使用（連合情報は全て取得済み）
		return getPrecomputedTopServers(settings.viewpointCriteria);
	});

	// SSRから取得したデフォルト視点サーバー（互換性のため）
	let defaultViewpoints = $derived(() => {
		return computedDefaultViewpoints();
	});

	// エッジ表示設定（変更検知のため明示的に新しいオブジェクトを生成）
	let edgeVisibility = $derived(() => ({
		showFederation: filter.edgeVisibility.showFederation,
		showBlocked: filter.edgeVisibility.showBlocked,
		showSuspended: filter.edgeVisibility.showSuspended,
		showConnectivityOk: filter.edgeVisibility.showConnectivityOk,
		showConnectivityNg: filter.edgeVisibility.showConnectivityNg
	}));

	// ブラウザ環境で設定を読み込み
	$effect(() => {
		if (browser && !initialized) {
			initialized = true;

			// 認証状態を初期化
			initAuth();

			// URLクエリパラメータを優先して読み込み
			const urlParams = new URLSearchParams(window.location.search);
			loginError = urlParams.get('login_error');
			const queryFilter = parseFilterFromQuery(urlParams);
			const queryViewpoints = parseViewpointsFromQuery(urlParams);
			const queryFocus = parseFocusFromQuery(urlParams);
			const querySelect = parseSelectFromQuery(urlParams);

			// URLクエリからフィルターを適用
			if (Object.keys(queryFilter).length > 0) {
				filter = { ...DEFAULT_FILTER, ...queryFilter };
			}

			// URLクエリからフォーカスホストを適用
			if (queryFocus) {
				focusHost = queryFocus;
			}

			// URLクエリから選択状態を適用
			if (querySelect) {
				selectedItem = querySelect;
				// 選択中のノードがあればフォーカスも設定
				if (!queryFocus && querySelect.type === 'node') {
					focusHost = querySelect.value;
				}
			}

			// URLクエリから視点サーバーを適用（ある場合のみ）
			if (queryViewpoints && queryViewpoints.length > 0) {
				settings.viewpointServers = queryViewpoints;
			} else {
				// URLクエリがなければローカルストレージを読み込み
				const saved = localStorage.getItem('misspace_settings');
				if (saved) {
					try {
						const parsed = JSON.parse(saved);
						// 古い形式からの移行: viewpointServersがなければ作成
						if (!parsed.viewpointServers) {
							parsed.viewpointServers = [parsed.seedServer || 'misskey.io'];
						}
						// viewModeは廃止されたので、viewpointServersのみ使用
						settings = {
						viewpointServers: parsed.viewpointServers,
						viewpointCriteria: parsed.viewpointCriteria || 'dru15',
						bookmarks: parsed.bookmarks || []
					};
					} catch {
						// ignore
					}
				} else if (defaultViewpoints().length > 0) {
					// ローカルストレージに設定がない場合、SSRのデフォルト視点サーバーを使用
					settings.viewpointServers = defaultViewpoints();
				}
			}

			// 視点サーバーリストにあるがSSRデータにないサーバーから連合情報を取得（エラーは表示しない）
			const ssrHosts = new Set(ssrViewpoints());
			for (const host of settings.viewpointServers) {
				if (!ssrHosts.has(host)) {
					fetchSeedFederations(host, false).then((feds) => {
						const existingKeys = new Set(additionalFederations.map(f => `${f.sourceHost}-${f.targetHost}`));
						const newFeds = feds.filter(f => !existingKeys.has(`${f.sourceHost}-${f.targetHost}`));
						if (newFeds.length > 0) {
							additionalFederations = [...additionalFederations, ...newFeds];
						}
					});
				}
			}
		}
	});

	// 認証状態が変わった時に自動で視点サーバーを追加
	$effect(() => {
		if (browser && initialized && authState.isLoggedIn && authState.user) {
			const userHost = authState.user.host;
			// 視点サーバーに追加されていなければ追加
			if (!settings.viewpointServers.includes(userHost)) {
				settings.viewpointServers = [userHost, ...settings.viewpointServers];
			}

			// プライベートサーバーだった場合、認証付きで再取得
			if (privateServers.has(userHost)) {
				fetchSeedFederations(userHost, false).then((feds) => {
					if (feds.length > 0) {
						const existingKeys = new Set(additionalFederations.map(f => `${f.sourceHost}-${f.targetHost}`));
						const newFeds = feds.filter(f => !existingKeys.has(`${f.sourceHost}-${f.targetHost}`));
						if (newFeds.length > 0) {
							additionalFederations = [...additionalFederations, ...newFeds];
						}
					}
				});
			} else {
				// 連合情報を取得
				handleAddViewpoint(userHost);
			}
		}
	});

	// SSRデータと追加取得データをマージした連合情報
	let allFederations = $derived(() => {
		const ssrFeds = data.federations as FederationInfo[];
		// 重複を除去してマージ
		const fedMap = new Map<string, FederationInfo>();
		for (const fed of ssrFeds) {
			const key = `${fed.sourceHost}-${fed.targetHost}`;
			fedMap.set(key, fed);
		}
		for (const fed of additionalFederations) {
			const key = `${fed.sourceHost}-${fed.targetHost}`;
			if (!fedMap.has(key)) {
				fedMap.set(key, fed);
			}
		}
		return Array.from(fedMap.values());
	});

	let displayFederations = $derived(() => {
		return allFederations().filter(f => settings.viewpointServers.includes(f.sourceHost));
	});

	// 設定変更を監視して保存
	$effect(() => {
		// settingsへの明示的な参照で依存関係を作成
		const currentSettings = JSON.stringify(settings);
		if (browser && initialized) {
			localStorage.setItem('misspace_settings', currentSettings);
		}
	});

	// フィルター、視点サーバー、フォーカスホスト、選択状態の変更時にURLを更新
	$effect(() => {
		// filter, settings.viewpointServers, focusHost, selectedItem への依存関係を作成
		const filterStr = JSON.stringify(filter);
		const vpStr = JSON.stringify(settings.viewpointServers);
		const currentFocus = focusHost;
		const currentSelect = selectedItem?.value ?? null;
		if (browser && initialized) {
			updateUrl(filter, settings.viewpointServers, defaultViewpoints(), currentFocus || null, currentSelect);
		}
	});

	let federationError = $state<string | null>(null);
	// バナーに出すエラー（連合取得の失敗かログインの失敗）
	let bannerError = $derived(federationError ?? loginError);

	// 種サーバーから連合情報を取得（サーバーサイドAPI経由でCORSを回避）
	async function fetchSeedFederations(seedHost: string, showError: boolean = true): Promise<FederationInfo[]> {
		if (showError) {
			federationError = null;
		}
		try {
			const res = await fetch('/api/federation', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ seedServer: seedHost })
			});

			if (!res.ok) {
				const errorData = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
				// 認証が必要なサーバーをマーク
				if (errorData.error === 'CREDENTIAL_REQUIRED') {
					privateServers = new Set([...privateServers, seedHost]);
				}
				if (showError) {
					federationError = errorData.message ?? `${seedHost} から連合情報を取得できませんでした`;
				}
				return [];
			}

			const result = (await res.json()) as { federations: FederationInfo[]; authenticated?: boolean };

			// 認証付きで取得成功した場合、プライベートサーバーのマークを解除
			if (result.authenticated && privateServers.has(seedHost)) {
				const newPrivateServers = new Set(privateServers);
				newPrivateServers.delete(seedHost);
				privateServers = newPrivateServers;
			}

			return result.federations;
		} catch {
			if (showError) {
				federationError = `${seedHost} への接続に失敗しました`;
			}
			return [];
		}
	}

	// 視点サーバーにフォーカス
	function handleFocusViewpoint(host: string) {
		focusHost = host;
	}

	// 選定基準変更時の処理（SSRで全データ取得済みのため即時切り替え）
	function handleCriteriaChange(criteria: import('$lib/types').ViewpointCriteria) {
		// SSRで事前計算されたトップ候補を取得（連合情報も全て取得済み）
		const topServers = getPrecomputedTopServers(criteria);

		// 即座に切り替え（API呼び出し不要、ローディング不要、グラフ再描画なし）
		settings.viewpointServers = topServers;
	}

	// 視点サーバー追加時の処理
	async function handleAddViewpoint(host: string) {
		// 既に連合情報がある場合はスキップ
		const existingHosts = new Set([...ssrViewpoints(), ...additionalFederations.map(f => f.sourceHost)]);
		if (existingHosts.has(host)) {
			return;
		}

		isLoading = true;
		loadingProgress = 0;
		try {
			loadingProgress = 30;
			const federations = await fetchSeedFederations(host);
			loadingProgress = 70;
			// 追加データとしてマージ（既存を保持しつつ追加）
			const existingKeys = new Set(additionalFederations.map(f => `${f.sourceHost}-${f.targetHost}`));
			const newFeds = federations.filter(f => !existingKeys.has(`${f.sourceHost}-${f.targetHost}`));
			if (newFeds.length > 0) {
				additionalFederations = [...additionalFederations, ...newFeds];
			}
			loadingProgress = 100;
		} catch (e) {
			console.error('Failed to fetch federations:', e);
		} finally {
			// フェードアウト用の遅延
			setTimeout(() => {
				isLoading = false;
				loadingProgress = 0;
			}, 200);
		}
	}

	// グラフから視点サーバーをトグル
	async function handleToggleViewpoint(host: string, add: boolean) {
		if (add) {
			// 追加: 既に存在する場合は何もしない
			if (settings.viewpointServers.includes(host)) return;
			settings.viewpointServers = [...settings.viewpointServers, host];
			// 連合情報を取得
			await handleAddViewpoint(host);
		} else {
			// 削除: 最低1つは残す
			if (settings.viewpointServers.length <= 1) return;
			settings.viewpointServers = settings.viewpointServers.filter(h => h !== host);
		}
	}

	// お気に入りサーバーをトグル
	function handleToggleBookmark(host: string, add: boolean) {
		if (add) {
			if (!settings.bookmarks.includes(host)) {
				settings.bookmarks = [...settings.bookmarks, host];
			}
		} else {
			settings.bookmarks = settings.bookmarks.filter(h => h !== host);
		}
	}

	// お気に入りから削除（SettingsPanel用）
	function handleRemoveBookmark(host: string) {
		settings.bookmarks = settings.bookmarks.filter(h => h !== host);
	}

	// グラフ画像エクスポート機能
	let exportGraphFn = $state<(() => Promise<string | null>) | null>(null);

	function handleGraphReady(exportFn: () => Promise<string | null>) {
		exportGraphFn = exportFn;
	}

	// Misskeyへ共有（投稿画面を開く）
	let isSharing = $state(false);
	let shareError = $state<string | null>(null);
	let shareSuccess = $state<{ message: string } | null>(null);

	async function handleShareToMisskey() {
		if (!authState.isLoggedIn || !authState.user) {
			shareError = 'ログインが必要です';
			return;
		}

		if (!exportGraphFn) {
			shareError = 'マップの読み込みを待っています...';
			setTimeout(() => { shareError = null; }, 2000);
			return;
		}

		isSharing = true;
		shareError = null;
		shareSuccess = null;

		try {
			// グラフを画像としてエクスポート
			const imageBase64 = await exportGraphFn();

			// 共有テキストを作成
			// 視点サーバーはURLとして記載（Misskeyでリンクになる）
			const viewpointUrls = settings.viewpointServers.map(host => `https://${host}`);
			const viewpointText = viewpointUrls.length > 0
				? `視点: ${viewpointUrls.join(', ')}`
				: '';
			// マップURLも視点サーバー付きで構築
			const mapUrl = new URL(browser ? window.location.origin : 'https://misspace.pages.dev');
			for (const vp of settings.viewpointServers) {
				mapUrl.searchParams.append('from', vp);
			}
			const text = `🗺️ Misspace - Misskey連合マップ\n\n${viewpointText}\n\n${mapUrl.toString()}\n\n#Misspace #Fediverse`;

			// APIを通じて直接投稿（画像付き）
			const res = await fetch('/api/share', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					text,
					imageBase64
				})
			});

			if (!res.ok) {
				const errorData = await res.json();
				throw new Error(errorData.error || '投稿に失敗しました');
			}

			const result = await res.json();
			if (result.noteUrl) {
				shareSuccess = { message: '投稿しました！' };
				// 投稿を新しいタブで開く
				window.open(result.noteUrl, '_blank', 'noopener,noreferrer');
			} else {
				shareSuccess = { message: '投稿しました' };
			}
			setTimeout(() => {
				shareSuccess = null;
			}, 5000);
		} catch (error) {
			shareError = error instanceof Error ? error.message : '共有に失敗しました';
			setTimeout(() => {
				shareError = null;
			}, 5000);
		} finally {
			isSharing = false;
		}
	}

	// グラフでサーバーを選択した時のポップアップ表示用
	let selectedServerInfo = $state<ServerInfo | null>(null);
	let popupPosition = $state<{ x: number; y: number } | null>(null);

	function handleSelectServer(server: ServerInfo | null, position: { x: number; y: number } | null) {
		selectedServerInfo = server;
		popupPosition = position;
		// URLパラメータに選択状態を反映（ノード選択）
		selectedItem = server ? { type: 'node', value: server.host } : null;
	}

	// エッジ選択時のハンドラー
	function handleSelectEdge(sourceHost: string, targetHost: string) {
		// エッジ選択時はポップアップは閉じる
		selectedServerInfo = null;
		popupPosition = null;
		// アルファベット順でソートしてURLに保存（一貫性のため）
		const [hostA, hostB] = sourceHost < targetHost
			? [sourceHost, targetHost]
			: [targetHost, sourceHost];
		selectedItem = { type: 'edge', value: `${hostA}..${hostB}` };
	}

	// 選択解除のハンドラー
	function handleClearSelection() {
		selectedServerInfo = null;
		popupPosition = null;
		selectedItem = null;
	}

	function handleClosePopup() {
		selectedServerInfo = null;
		popupPosition = null;
	}

	// 認証関連ハンドラー
	function handleOpenLogin() {
		loginError = null;
		showLoginModal = true;
	}

	function handleCloseLogin() {
		showLoginModal = false;
	}

	// 表示するサーバー一覧（SSRで取得したデータを使用）
	let displayServers = $derived(() => {
		return data.servers as ServerInfo[];
	});


	// サーバーの登録状態を判定
	function getRegistrationStatus(server: ServerInfo): 'open' | 'approval' | 'invite' | 'closed' {
		// registrationOpen = false の場合
		if (!server.registrationOpen) {
			// 招待制（inviteOnlyフラグがある場合）
			if (server.inviteOnly) {
				return 'invite';
			}
			// それ以外は停止中
			return 'closed';
		}
		// registrationOpen = true の場合
		if (server.approvalRequired) {
			return 'approval';
		}
		return 'open';
	}


	// フィルター適用後のサーバー一覧
	let filteredServers = $derived(() => {
		return displayServers().filter((server: ServerInfo) => {
			// 新規登録フィルター
			if (filter.registrationStatus.length > 0) {
				const status = getRegistrationStatus(server);
				if (!filter.registrationStatus.includes(status)) return false;
			}

			// メールアドレス要件
			if (filter.emailRequirement !== null) {
				if (filter.emailRequirement === 'required' && !server.emailRequired) return false;
				if (filter.emailRequirement === 'notRequired' && server.emailRequired) return false;
			}

			// 年齢制限（階層的にフィルタリング）
			// 13+を選択 → 13+と18+のサーバーを表示（小学生不可以上）
			// 18+を選択 → 18+のサーバーのみ表示（未成年不可）
			if (filter.ageRestriction) {
				if (filter.ageRestriction === '13+') {
					// 13+以上: 13+ または 18+ を表示
					if (server.ageRestriction !== '13+' && server.ageRestriction !== '18+') return false;
				} else if (filter.ageRestriction === '18+') {
					// 18+のみ
					if (server.ageRestriction !== '18+') return false;
				}
			}

			// リポジトリURL
			if (filter.repositoryUrls.length > 0) {
				if (!server.repositoryUrl || !filter.repositoryUrls.includes(server.repositoryUrl)) {
					return false;
				}
			}

			// 規模
			if (filter.scale.length > 0) {
				const scale: ServerScale = getServerScale(server.usersCount);
				if (!filter.scale.includes(scale)) return false;
			}

			// バージョン追従度
			if (filter.versionTracks.length > 0) {
				const track = getVersionTrack(server.softwareVersion);
				if (!filter.versionTracks.includes(track)) return false;
			}

			return true;
		});
	});
</script>

<svelte:head>
	<title>みすぺーす</title>
	<meta name="description" content="Misskeyサーバーの連合関係を視覚的に表示するインタラクティブマップ" />
</svelte:head>

<div class="page">
	<!-- GitHub Corner -->
	<a href="https://github.com/hitalin/misspace" target="_blank" rel="noopener noreferrer" class="github-corner" aria-label="View source on GitHub">
		<svg width="80" height="80" viewBox="0 0 250 250" aria-hidden="true">
			<path d="M0,0 L115,115 L130,115 L142,142 L250,250 L250,0 Z" />
			<path d="M128.3,109.0 C113.8,99.7 119.0,89.6 119.0,89.6 C122.0,82.7 120.5,78.6 120.5,78.6 C119.2,72.0 123.4,76.3 123.4,76.3 C127.3,80.9 125.5,87.3 125.5,87.3 C122.9,97.6 130.6,101.9 134.4,103.2" fill="currentColor" class="octo-arm" />
			<path d="M115.0,115.0 C114.9,115.1 118.7,116.5 119.8,115.4 L133.7,101.6 C136.9,99.2 139.9,98.4 142.2,98.6 C133.8,88.0 127.5,74.4 143.8,58.0 C148.5,53.4 154.0,51.2 159.7,51.0 C160.3,49.4 163.2,43.6 171.4,40.1 C171.4,40.1 176.1,42.5 178.8,56.2 C183.1,58.6 187.2,61.8 190.9,65.4 C194.5,69.0 197.7,73.2 200.1,77.6 C213.8,80.2 216.3,84.9 216.3,84.9 C212.7,93.1 206.9,96.0 205.4,96.6 C205.1,102.4 203.0,107.8 198.3,112.5 C181.9,128.9 168.3,122.5 157.7,114.1 C157.9,116.9 156.7,120.9 152.7,124.9 L141.0,136.5 C139.8,137.7 141.6,141.9 141.8,141.8 Z" fill="currentColor" class="octo-body" />
		</svg>
	</a>

	<!-- モバイル: スクロールコンテナ -->
	{#if isMobile}
		<div class="mobile-scroll-container">
			<div class="mobile-panels">
				<SettingsPanel bind:settings onAddViewpoint={handleAddViewpoint} onFocusViewpoint={handleFocusViewpoint} onCriteriaChange={handleCriteriaChange} onRemoveBookmark={handleRemoveBookmark} onShareToMisskey={handleShareToMisskey} ssrViewpoints={ssrViewpoints()} defaultViewpoints={defaultViewpoints()} {isMobile} defaultOpen={false} {authState} onOpenLogin={handleOpenLogin} {isSharing} {shareError} {shareSuccess} />
				<SearchPanel
					servers={filteredServers()}
					onFocusServer={handleFocusViewpoint}
					{isMobile}
					defaultOpen={false}
				/>
				<FilterPanel bind:filter {isMobile} defaultOpen={false} />
				<FederatedSoftwarePanel
					servers={displayServers()}
					federations={displayFederations()}
					viewpointServers={settings.viewpointServers}
					bind:selectedRepositoryUrls={filter.repositoryUrls}
					{isMobile}
					defaultOpen={false}
				/>
			</div>
			<!-- モバイル: グラフ -->
			<div class="mobile-graph">
				{#if bannerError}
					<div class="error-banner">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="error-icon">
							<circle cx="12" cy="12" r="10" />
							<line x1="12" y1="8" x2="12" y2="12" />
							<line x1="12" y1="16" x2="12.01" y2="16" />
						</svg>
						<span>{bannerError}</span>
					</div>
				{/if}
				{#if isLoading}
					<div class="graph-placeholder loading">
						<div class="loading-progress">
							<div class="spinner"></div>
							<div class="progress-bar">
								<div class="progress-fill" style="width: {loadingProgress}%"></div>
							</div>
							<span class="loading-text">連合情報を取得中... {loadingProgress}%</span>
						</div>
					</div>
				{:else if filteredServers().length > 0}
					<div class="graph-container">
						<FederationGraph
							servers={filteredServers()}
							federations={displayFederations()}
							focusHost={focusHost}
							viewpointServers={settings.viewpointServers}
							{privateServers}
							userHost={authState.user?.host ?? ''}
							edgeVisibility={edgeVisibility()}
							initialSelection={selectedItem}
							onSelectServer={handleSelectServer}
							onSelectEdge={handleSelectEdge}
							onClearSelection={handleClearSelection}
							onReady={handleGraphReady}
						/>
					</div>
				{:else}
					<div class="graph-placeholder empty">
						<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="empty-icon">
							<circle cx="12" cy="12" r="10" />
							<path d="M8 15s1.5-2 4-2 4 2 4 2" />
							<line x1="9" y1="9" x2="9.01" y2="9" />
							<line x1="15" y1="9" x2="15.01" y2="9" />
						</svg>
						<span>条件に一致するサーバーがありません</span>
						<button class="reset-btn" onclick={() => filter = { ...DEFAULT_FILTER }}>
							フィルターをリセット
						</button>
					</div>
				{/if}
			</div>
		</div>
	{/if}

	<div class="layout" class:hidden-mobile={isMobile}>
		<!-- デスクトップ: サイドバー -->
		{#if !isMobile}
			<aside class="sidebar">
				<SettingsPanel bind:settings onAddViewpoint={handleAddViewpoint} onFocusViewpoint={handleFocusViewpoint} onCriteriaChange={handleCriteriaChange} onRemoveBookmark={handleRemoveBookmark} onShareToMisskey={handleShareToMisskey} ssrViewpoints={ssrViewpoints()} defaultViewpoints={defaultViewpoints()} {authState} onOpenLogin={handleOpenLogin} {isSharing} {shareError} {shareSuccess} />
				<SearchPanel
					servers={filteredServers()}
					onFocusServer={handleFocusViewpoint}
				/>
				<FilterPanel bind:filter />
				<FederatedSoftwarePanel
					servers={displayServers()}
					federations={displayFederations()}
					viewpointServers={settings.viewpointServers}
					bind:selectedRepositoryUrls={filter.repositoryUrls}
				/>
			</aside>
		{/if}


		<main>
			{#if bannerError}
				<div class="error-banner">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" class="error-icon">
						<circle cx="12" cy="12" r="10" />
						<line x1="12" y1="8" x2="12" y2="12" />
						<line x1="12" y1="16" x2="12.01" y2="16" />
					</svg>
					<span>{bannerError}</span>
				</div>
			{/if}
			{#if isLoading}
				<div class="graph-placeholder loading">
					<div class="loading-progress">
						<div class="spinner"></div>
						<div class="progress-bar">
							<div class="progress-fill" style="width: {loadingProgress}%"></div>
						</div>
						<span class="loading-text">連合情報を取得中... {loadingProgress}%</span>
					</div>
				</div>
			{:else if filteredServers().length > 0}
				<div class="graph-container">
					<FederationGraph
						servers={filteredServers()}
						federations={displayFederations()}
						focusHost={focusHost}
						viewpointServers={settings.viewpointServers}
						{privateServers}
						userHost={authState.user?.host ?? ''}
						edgeVisibility={edgeVisibility()}
						initialSelection={selectedItem}
						onSelectServer={handleSelectServer}
						onSelectEdge={handleSelectEdge}
						onClearSelection={handleClearSelection}
						onReady={handleGraphReady}
					/>
				</div>
			{:else}
				<div class="graph-placeholder empty">
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="empty-icon">
						<circle cx="12" cy="12" r="10" />
						<path d="M8 15s1.5-2 4-2 4 2 4 2" />
						<line x1="9" y1="9" x2="9.01" y2="9" />
						<line x1="15" y1="9" x2="15.01" y2="9" />
					</svg>
					<span>条件に一致するサーバーがありません</span>
					<button class="reset-btn" onclick={() => filter = { ...DEFAULT_FILTER }}>
						フィルターをリセット
					</button>
				</div>
			{/if}
		</main>
	</div>
</div>

<!-- Server Info Popup -->
<ServerInfoPopup
	server={selectedServerInfo}
	position={popupPosition}
	onClose={handleClosePopup}
	isViewpoint={selectedServerInfo ? settings.viewpointServers.includes(selectedServerInfo.host) : false}
	isBookmarked={selectedServerInfo ? settings.bookmarks.includes(selectedServerInfo.host) : false}
	onToggleViewpoint={handleToggleViewpoint}
	onToggleBookmark={handleToggleBookmark}
	viewpointServers={settings.viewpointServers}
/>

<!-- Login Modal -->
<LoginModal isOpen={showLoginModal} onClose={handleCloseLogin} />

<style>
	.page {
		min-height: 100vh;
		background: var(--bg-primary);
	}

	/* Layout */
	.layout {
		display: flex;
		gap: 1rem;
		max-width: 1600px;
		margin: 0 auto;
		padding: 0.75rem 1rem;
		height: 100vh;
	}

	/* Sidebar */
	.sidebar {
		width: 260px;
		flex-shrink: 0;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		overflow-y: auto;
	}

	.sidebar :global(.filter-panel),
	.sidebar :global(.settings-panel),
	.sidebar :global(.search-panel),
	.sidebar :global(.active-federations-panel),
	.sidebar :global(.federated-software-panel) {
		background: var(--glass-bg);
		backdrop-filter: blur(var(--glass-blur-lg));
		-webkit-backdrop-filter: blur(var(--glass-blur-lg));
		border: 1px solid var(--border-color);
		border-radius: var(--radius-lg);
		color: var(--fg-primary);
		box-shadow: var(--shadow-sm), inset 0 1px 0 var(--glass-border);
		transition: all var(--transition-normal);
	}

	.sidebar :global(.filter-panel:hover),
	.sidebar :global(.settings-panel:hover),
	.sidebar :global(.search-panel:hover),
	.sidebar :global(.active-federations-panel:hover),
	.sidebar :global(.federated-software-panel:hover) {
		border-color: var(--border-color-hover);
		box-shadow: var(--shadow-md), inset 0 1px 0 var(--glass-border);
		transform: translateY(-1px);
	}

	.sidebar :global(h3),
	.sidebar :global(h4) {
		color: var(--fg-primary);
	}

	.sidebar :global(label) {
		color: var(--fg-secondary);
	}

	.sidebar :global(.description) {
		color: var(--fg-muted);
	}

	/* Main */
	main {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
	}

	/* Error Banner */
	.error-banner {
		display: flex;
		align-items: center;
		gap: 0.875rem;
		background: rgba(248, 113, 113, 0.12);
		backdrop-filter: blur(var(--glass-blur-sm));
		-webkit-backdrop-filter: blur(var(--glass-blur-sm));
		border: 1px solid rgba(248, 113, 113, 0.25);
		border-radius: var(--radius-lg);
		padding: 1rem 1.25rem;
		margin-bottom: 1rem;
		color: #fca5a5;
		font-size: 0.875rem;
		font-weight: 500;
		animation: fadeIn 0.3s var(--ease-out-expo);
		box-shadow: 0 0 16px rgba(248, 113, 113, 0.15);
	}

	.error-icon {
		width: 22px;
		height: 22px;
		flex-shrink: 0;
		opacity: 0.9;
	}

	/* Graph Container */
	.graph-container {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: var(--glass-bg-strong);
		backdrop-filter: blur(var(--glass-blur-lg));
		-webkit-backdrop-filter: blur(var(--glass-blur-lg));
		border: 1px solid var(--border-color);
		border-radius: var(--radius-lg);
		overflow: hidden;
		box-shadow: var(--shadow-lg), inset 0 1px 0 var(--glass-border), var(--shadow-inset);
		animation: fadeInScale 0.4s var(--ease-out-expo);
	}

	.graph-container :global(.graph-wrapper) {
		flex: 1;
		min-height: 0;
	}

	/* Placeholder states */
	.graph-placeholder {
		flex: 1;
		min-height: 0;
		background: var(--glass-bg);
		backdrop-filter: blur(var(--glass-blur-md));
		-webkit-backdrop-filter: blur(var(--glass-blur-md));
		border: 1px solid var(--border-color);
		border-radius: var(--radius-lg);
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 1.25rem;
		color: var(--fg-muted);
	}

	.graph-placeholder.loading {
		background: linear-gradient(135deg, rgba(134, 179, 0, 0.08), rgba(134, 179, 0, 0.02));
		border-color: rgba(134, 179, 0, 0.25);
		box-shadow: var(--shadow-glow);
	}

	.graph-placeholder.empty {
		background: var(--glass-bg-subtle);
	}

	.loading-progress {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1.25rem;
	}

	.spinner {
		width: 44px;
		height: 44px;
		border: 3px solid rgba(134, 179, 0, 0.15);
		border-top-color: var(--accent-500);
		border-radius: 50%;
		animation: spin 0.8s cubic-bezier(0.4, 0, 0.2, 1) infinite;
		box-shadow: 0 0 16px rgba(134, 179, 0, 0.2);
	}

	.progress-bar {
		width: 220px;
		height: 6px;
		background: rgba(134, 179, 0, 0.15);
		border-radius: var(--radius-full);
		overflow: hidden;
		box-shadow: var(--shadow-inset);
	}

	.progress-fill {
		height: 100%;
		background: linear-gradient(90deg, var(--accent-600), var(--accent-400));
		border-radius: var(--radius-full);
		transition: width 0.4s var(--ease-out-expo);
		box-shadow: 0 0 8px rgba(134, 179, 0, 0.4);
	}

	.loading-text {
		color: var(--fg-secondary);
		font-size: 0.9rem;
		font-weight: 500;
		letter-spacing: -0.01em;
	}

	.empty-icon {
		width: 72px;
		height: 72px;
		color: var(--fg-muted);
		opacity: 0.4;
	}

	.reset-btn {
		margin-top: 0.75rem;
		padding: 0.75rem 1.5rem;
		background: linear-gradient(135deg, var(--accent-600), var(--accent-500));
		color: white;
		border: none;
		border-radius: var(--radius-full);
		font-size: 0.875rem;
		font-weight: 600;
		cursor: pointer;
		transition: all var(--transition-bounce);
		box-shadow: var(--shadow-sm), 0 0 0 0 rgba(134, 179, 0, 0);
	}

	.reset-btn:hover {
		transform: translateY(-2px);
		box-shadow: var(--shadow-md), 0 0 20px rgba(134, 179, 0, 0.3);
	}

	.reset-btn:active {
		transform: translateY(0);
	}

	/* タブレット対応（768px - 1024px） */
	@media (min-width: 769px) and (max-width: 1024px) {
		.layout {
			padding: 0.5rem 0.75rem;
		}

		.sidebar {
			width: 200px;
		}

		.graph-legend {
			font-size: 0.6rem;
			padding: 0.5rem;
		}

		.graph-legend .legend-item {
			gap: 0.25rem;
		}
	}

	@media (max-width: 1024px) {
		.layout {
			padding: 0.5rem 0.75rem;
		}

		.sidebar {
			width: 220px;
		}
	}

	/* モバイル スクロールコンテナ */
	.mobile-scroll-container {
		height: 100vh;
		overflow-y: auto;
		overflow-x: hidden;
	}

	/* Mobile panels - ヘッダー下に配置 */
	.mobile-panels {
		display: flex;
		flex-direction: column;
		gap: 0;
		padding: 0 1rem;
		background: var(--bg-primary);
	}

	/* モバイル グラフ */
	.mobile-graph {
		height: 70vh;
		padding: 0.25rem;
	}

	.mobile-graph .graph-container {
		height: 100%;
	}

	.mobile-graph .graph-placeholder {
		height: 100%;
	}

	/* デスクトップでは hidden-mobile を非表示にしない */
	.layout.hidden-mobile {
		display: none;
	}

	.mobile-panels :global(.settings-panel),
	.mobile-panels :global(.filter-panel),
	.mobile-panels :global(.search-panel) {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 0;
		margin: 0 -1rem;
		border-left: none;
		border-right: none;
	}

	.mobile-panels :global(.settings-panel),
	.mobile-panels :global(.filter-panel),
	.mobile-panels :global(.search-panel) {
		border-bottom: none;
	}

	.mobile-panels :global(.active-federations-panel),
	.mobile-panels :global(.federated-software-panel) {
		background: var(--bg-card);
		border: 1px solid var(--border-color);
		border-radius: 0;
		margin: 0 -1rem;
		border-left: none;
		border-right: none;
		border-bottom: none;
	}

	/* モバイルでパネルヘッダーをスティッキーに積み上げ */
	.mobile-panels :global(.panel-header-toggle) {
		position: sticky;
		z-index: 10;
		background: var(--bg-card);
		padding: 0.5rem 0;
		margin: 0 0 0.375rem;
		border-bottom: 1px solid var(--border-color);
	}

	/* 各パネルのヘッダーを順番に積み上げ（ヘッダー高さ約32px） */
	.mobile-panels :global(.settings-panel .panel-header-toggle) {
		top: 0;
		z-index: 15;
	}
	.mobile-panels :global(.search-panel .panel-header-toggle) {
		top: 32px;
		z-index: 14;
	}
	.mobile-panels :global(.filter-panel .panel-header-toggle) {
		top: 64px;
		z-index: 13;
	}
	.mobile-panels :global(.federated-software-panel .panel-header-toggle) {
		top: 96px;
		z-index: 12;
	}
	.mobile-panels :global(.active-federations-panel .panel-header-toggle) {
		top: 128px;
		z-index: 11;
	}

	@media (max-width: 768px) {
		.page {
			height: 100vh;
			overflow: hidden;
		}

		.layout {
			display: flex;
			flex-direction: column;
			padding: 0.25rem;
		}

		.sidebar {
			display: none;
		}

		main {
			/* 固定高さでスクロール可能に */
			height: 60vh;
			flex-shrink: 0;
		}

		.graph-container {
			height: 100%;
		}

		.graph-placeholder {
			height: 100%;
		}

		.github-corner {
			display: none;
		}
	}

	/* GitHub Corner */
	.github-corner {
		position: fixed;
		top: 0;
		right: 0;
		z-index: 100;
	}

	.github-corner svg {
		fill: var(--accent-600);
		color: var(--bg-primary);
	}

	.github-corner:hover .octo-arm {
		animation: octocat-wave 560ms ease-in-out;
	}

	.github-corner .octo-arm {
		transform-origin: 130px 106px;
	}

	@keyframes octocat-wave {
		0%, 100% { transform: rotate(0); }
		20%, 60% { transform: rotate(-25deg); }
		40%, 80% { transform: rotate(10deg); }
	}

	@media (max-width: 500px) {
		.github-corner:hover .octo-arm {
			animation: none;
		}
		.github-corner .octo-arm {
			animation: octocat-wave 560ms ease-in-out;
		}
	}

</style>
