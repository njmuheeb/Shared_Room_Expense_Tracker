import { supabase } from './supabaseClient';

/**
 * Read-only connection diagnostic for the Supabase client.
 *
 * Guarantees:
 * - Never writes, creates, or mutates anything. Every request is a zero-row read.
 * - Never reads an environment-variable value into a string.
 * - Never returns credentials or a project URL; all output passes through
 *   `sanitizeForDisplay` first.
 *
 * Intended to be called from the dev-only entry `src/dev/supabaseCheck.ts`.
 */

export type CheckStatus = 'pass' | 'warn' | 'fail';

export interface HealthCheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

export interface HealthReport {
  overall: CheckStatus;
  checkedAt: string;
  results: HealthCheckResult[];
}

/** Objects the migration in supabase/migrations/ is expected to create. */
export const EXPECTED_OBJECTS = [
  'rooms',
  'members',
  'contributions',
  'expenses',
  'reimbursements',
  'room_fund_balance',
  'member_activity',
] as const;

/**
 * Strips anything that could be a credential or a project URL before a string
 * is displayed or logged, so a diagnostic can never leak configuration.
 */
export function sanitizeForDisplay(input: unknown): string {
  const text = typeof input === 'string' ? input : String(input ?? '');

  return text
    .replace(/https?:\/\/\S+/gi, '[redacted-url]')
    .replace(/eyJ[A-Za-z0-9._-]{8,}/g, '[redacted-jwt]')
    .replace(/sb_[A-Za-z]+_[A-Za-z0-9_-]{8,}/g, '[redacted-key]')
    .slice(0, 300);
}

function describeError(err: unknown): string {
  if (err instanceof Error) return sanitizeForDisplay(err.message);
  if (typeof err === 'string') return sanitizeForDisplay(err);
  return 'Unknown error';
}

/** PostgREST/Postgres codes meaning "this object does not exist". */
function isMissingObject(code: string, message: string): boolean {
  return code === 'PGRST205' || code === '42P01' || /does not exist/i.test(message);
}

/** Postgres 42501 — the object exists but this role has no privilege on it. */
function isAccessRestricted(code: string, message: string): boolean {
  return code === '42501' || /permission denied/i.test(message);
}

/** Configuration presence as booleans only. Values are never read. */
function checkConfiguration(): HealthCheckResult {
  const hasUrl = Boolean(import.meta.env.VITE_SUPABASE_URL);
  const hasKey = Boolean(import.meta.env.VITE_SUPABASE_ANON_KEY);

  if (hasUrl && hasKey) {
    return {
      name: 'Configuration',
      status: 'pass',
      detail:
        'Both required VITE_ variables are present (values intentionally not shown). ' +
        'The client module would have thrown on import if either were missing.',
    };
  }

  const missing = [
    !hasUrl ? 'VITE_SUPABASE_URL' : null,
    !hasKey ? 'VITE_SUPABASE_ANON_KEY' : null,
  ]
    .filter(Boolean)
    .join(', ');

  return { name: 'Configuration', status: 'fail', detail: `Missing: ${missing}` };
}

/** Local-only session read. Makes no network request. */
async function checkLocalSession(): Promise<HealthCheckResult> {
  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) {
      return {
        name: 'Local auth session',
        status: 'warn',
        detail: `Could not read the stored session: ${describeError(error.message)}`,
      };
    }

    return {
      name: 'Local auth session',
      status: 'pass',
      detail: data.session
        ? 'Client initialised and an active session is stored locally.'
        : 'Client initialised. No session stored yet (expected before sign-in).',
    };
  } catch (err) {
    return { name: 'Local auth session', status: 'fail', detail: describeError(err) };
  }
}

/** One harmless round trip: a zero-row read against PostgREST. */
async function checkRestReachability(): Promise<HealthCheckResult> {
  try {
    const { error } = await supabase.from('rooms').select('id').limit(0);

    if (!error) {
      return {
        name: 'REST reachability',
        status: 'pass',
        detail: 'Reached PostgREST and the "rooms" table responded.',
      };
    }

    const code = error.code ?? '';
    const message = error.message ?? '';

    if (isMissingObject(code, message)) {
      return {
        name: 'REST reachability',
        status: 'warn',
        detail:
          'Reached PostgREST and the project URL + key were accepted, but "rooms" ' +
          'does not exist yet, so the migration has not been applied.',
      };
    }

    if (isAccessRestricted(code, message)) {
      return {
        name: 'REST reachability',
        status: 'pass',
        detail:
          'Reached PostgREST, the key was accepted, and "rooms" exists. Access was ' +
          'denied to the anonymous role, which is the expected state before sign-in.',
      };
    }

    if (code === 'PGRST301' || /invalid api key|jwt/i.test(message)) {
      return {
        name: 'REST reachability',
        status: 'fail',
        detail:
          'Reached PostgREST but the key was rejected. Confirm ' +
          'VITE_SUPABASE_ANON_KEY holds the anon/publishable key for this project.',
      };
    }

    return {
      name: 'REST reachability',
      status: 'warn',
      detail: `PostgREST responded with an error: ${describeError(message)}${
        code ? ` [${code}]` : ''
      }`,
    };
  } catch (err) {
    return {
      name: 'REST reachability',
      status: 'fail',
      detail: `Could not reach PostgREST: ${describeError(err)}`,
    };
  }
}

/** Read-only inventory of the objects the migration should have created. */
async function checkObjectInventory(): Promise<HealthCheckResult> {
  const reachable: string[] = [];
  const restricted: string[] = [];
  const missing: string[] = [];
  const indeterminate: string[] = [];

  for (const name of EXPECTED_OBJECTS) {
    try {
      const { error } = await supabase.from(name).select('*').limit(0);

      if (!error) {
        reachable.push(name);
      } else if (isMissingObject(error.code ?? '', error.message ?? '')) {
        missing.push(name);
      } else if (isAccessRestricted(error.code ?? '', error.message ?? '')) {
        restricted.push(name);
      } else {
        indeterminate.push(name);
      }
    } catch {
      indeterminate.push(name);
    }
  }

  const parts: string[] = [];
  if (reachable.length) parts.push(`reachable: ${reachable.join(', ')}`);
  if (restricted.length) parts.push(`exists, denied to anon: ${restricted.join(', ')}`);
  if (missing.length) parts.push(`missing: ${missing.join(', ')}`);
  if (indeterminate.length) parts.push(`indeterminate: ${indeterminate.join(', ')}`);

  const bad = missing.length + indeterminate.length;

  return {
    name: 'Schema inventory',
    status: bad === 0 ? 'pass' : 'warn',
    detail:
      `${EXPECTED_OBJECTS.length - bad} of ${EXPECTED_OBJECTS.length} expected objects ` +
      `accounted for. ${parts.join('; ')}.` +
      (bad === 0 ? ' "Exists, denied to anon" is the correct state while unauthenticated.' : ''),
  };
}

/** Runs every check. Never throws; failures are reported as results. */
export async function checkSupabaseConnection(): Promise<HealthReport> {
  const results: HealthCheckResult[] = [
    checkConfiguration(),
    await checkLocalSession(),
    await checkRestReachability(),
    await checkObjectInventory(),
  ];

  const overall: CheckStatus = results.some((r) => r.status === 'fail')
    ? 'fail'
    : results.some((r) => r.status === 'warn')
      ? 'warn'
      : 'pass';

  return { overall, checkedAt: new Date().toISOString(), results };
}
