import type { PlayerContract, PayrollSnapshot, TeamLink } from './types';
export const TEAM_CODES: Record<string, string>;
export function teamCode(team: Pick<TeamLink, 'name' | 'slug'>): string | null;
export function parsePayroll(html: string, options: { sourceUrl: string; fetchedAt?: string }): PayrollSnapshot;
export function matchContract(name: string, payroll: PayrollSnapshot): PlayerContract | null;
export function loadPayroll(team: TeamLink, options?: { cacheDir?: string }): Promise<PayrollSnapshot | null>;
