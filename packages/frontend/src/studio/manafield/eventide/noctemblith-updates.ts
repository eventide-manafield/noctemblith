/*
 * SPDX-FileCopyrightText: Noctemblith contributors
 * SPDX-License-Identifier: AGPL-3.0-only
 *
 * Noctemblith's administrator update viewer. This deliberately NEVER executes
 * shell commands, writes Docker configuration, or handles host credentials.
 * Namespace: studio.manafield.eventide
 */

export const REPOSITORY = 'eventide-manafield/noctemblith';
export const UPDATE_WORKFLOW = 'docker.yml';
export const RELEASE_CHANNEL = 'noctemblith/release/latest' as const;
export const DEV_CHANNEL = 'noctemblith/dev' as const;
export type UpdateChannel = typeof RELEASE_CHANNEL | typeof DEV_CHANNEL;

export function parseSubscription(value: unknown): UpdateChannel {
	return value === DEV_CHANNEL ? DEV_CHANNEL : RELEASE_CHANNEL;
}

export const WORKFLOW_PAGE = `https://github.com/${REPOSITORY}/actions/workflows/${UPDATE_WORKFLOW}`;

const SHA_RE = /^[0-9a-f]{40}$/i;
const CHANNEL_RE = /^noctemblith\/[a-z0-9._/-]+$/i;
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

export type BuildMetadata = {
	sha: string;
	channel: string;
};

export type UpdateCandidate = {
	sha: string;
	channel: string;
	workflowUrl: string;
};

type GithubRun = {
	head_sha?: unknown;
	head_branch?: unknown;
	conclusion?: unknown;
	html_url?: unknown;
};

export type UpdateCheck =
	| { state: 'available'; current: BuildMetadata; candidate: UpdateCandidate }
	| { state: 'current' | 'untracked' | 'error'; current: BuildMetadata | null; message: string };

export type UpdateDecision = {
	skippedSha?: string;
	snoozedSha?: string;
	snoozedUntil?: number;
};

export function isBuildMetadata(value: unknown): value is BuildMetadata {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return typeof v.sha === 'string' && SHA_RE.test(v.sha) &&
		typeof v.channel === 'string' && CHANNEL_RE.test(v.channel);
}

export function parseLatestSuccessfulRun(body: unknown, channel: string): UpdateCandidate | null {
	if (!body || typeof body !== 'object') return null;
	const runs = (body as { workflow_runs?: unknown }).workflow_runs;
	if (!Array.isArray(runs)) return null;
	for (const value of runs) {
		if (!value || typeof value !== 'object') continue;
		const run = value as GithubRun;
		if (run.conclusion !== 'success' || run.head_branch !== channel) continue;
		if (typeof run.head_sha !== 'string' || !SHA_RE.test(run.head_sha)) continue;
		if (typeof run.html_url !== 'string' || !run.html_url.startsWith(`https://github.com/${REPOSITORY}/actions/runs/`)) continue;
		return { sha: run.head_sha, channel, workflowUrl: run.html_url };
	}
	return null;
}

export function shouldNotify(candidate: UpdateCandidate, decision: UpdateDecision, now = Date.now()): boolean {
	if (decision.skippedSha === candidate.sha) return false;
	if (decision.snoozedSha === candidate.sha && typeof decision.snoozedUntil === 'number' && Number.isFinite(decision.snoozedUntil) &&
		(decision.snoozedUntil ?? 0) > now) return false;
	return true;
}

export function chooseUpdate(decision: UpdateDecision, sha: string, action: 'skip' | 'snooze', now = Date.now()): UpdateDecision {
	if (!SHA_RE.test(sha)) throw new Error('Invalid build revision');
	if (action === 'skip') return { ...decision, skippedSha: sha, snoozedSha: undefined, snoozedUntil: undefined };
	return { ...decision, snoozedSha: sha, snoozedUntil: now + SNOOZE_MS };
}

export function readDecision(adminId: string): UpdateDecision {
	try {
		const raw = localStorage.getItem(`studio.manafield.eventide:noctemblith-update:${adminId}`);
		if (!raw) return {};
		const parsed: unknown = JSON.parse(raw);
		return parsed && typeof parsed === 'object' ? parsed as UpdateDecision : {};
	} catch {
		return {};
	}
}

export function saveDecision(adminId: string, decision: UpdateDecision): void {
	localStorage.setItem(`studio.manafield.eventide:noctemblith-update:${adminId}`, JSON.stringify(decision));
	// Synchronize the compact admin notice and the full update center in this tab.
	if (typeof window !== 'undefined') window.dispatchEvent(new Event('noctemblith-update-decision'));
}

async function fetchJson(url: string, sameOrigin = false): Promise<unknown> {
	const response = await globalThis.fetch(url, {
		cache: 'no-store',
		headers: { Accept: 'application/json' },
		credentials: sameOrigin ? 'same-origin' : 'omit',
	});
	if (!response.ok) throw new Error(`HTTP ${response.status}`);
	return await response.json() as unknown;
}

export async function checkForUpdates(channel: UpdateChannel = RELEASE_CHANNEL): Promise<UpdateCheck> {
	let current: BuildMetadata | null = null;
	try {
		const metadata = await fetchJson('/noctemblith-build.json', true).catch(() => null);
		if (!isBuildMetadata(metadata)) {
			return { state: 'untracked', current: null, message: '현재 실행 중인 Noctemblith 이미지의 빌드 정보를 확인할 수 없습니다. 새로운 GHCR 이미지를 배포한 뒤 다시 확인해 주세요.' };
		}
		current = metadata;
		const params = new URLSearchParams({
			branch: channel,
			event: 'workflow_dispatch',
			status: 'success',
			per_page: '20',
		});
		const url = `https://api.github.com/repos/${REPOSITORY}/actions/workflows/${UPDATE_WORKFLOW}/runs?${params}`;
		const candidate = parseLatestSuccessfulRun(await fetchJson(url), channel);
		if (!candidate || candidate.sha === current.sha) {
			return { state: 'current', current, message: candidate ? '현재 최신 검증 빌드를 사용 중입니다.' : '선택한 채널에서 성공한 배포 이미지를 아직 찾지 못했습니다.' };
		}

		// A successfully published image can be older than this deployment.
		// Never suggest an implicit downgrade based solely on run timestamps.
		const compareUrl = `https://api.github.com/repos/${REPOSITORY}/compare/${current.sha}...${candidate.sha}`;
		const compare = await fetchJson(compareUrl) as { status?: unknown };
		if (compare.status !== 'ahead') {
			return { state: 'current', current, message: '현재 빌드보다 새로운 검증 이미지는 없습니다.' };
		}
		return { state: 'available', current, candidate };
	} catch {
		return { state: 'error', current, message: '업데이트 정보를 가져오지 못했습니다. GitHub 연결 상태 또는 API 요청 제한을 확인해 주세요.' };
	}
}
