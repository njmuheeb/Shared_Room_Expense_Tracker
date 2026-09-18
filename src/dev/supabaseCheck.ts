/**
 * Dev-only diagnostic entry for supabase-check.html.
 *
 * Not part of the application bundle: `vite build` only compiles index.html,
 * so nothing here reaches production. Delete alongside supabase-check.html
 * once the schema is verified.
 */

type CheckStatus = 'pass' | 'warn' | 'fail';

const STATUS_ICON: Record<CheckStatus, string> = {
  pass: '\u2705',
  warn: '\u26A0\uFE0F',
  fail: '\u274C',
};

function truncate(text: string, max = 220): string {
  return text.length > max ? `${text.slice(0, max)}\u2026` : text;
}

function setOutput(lines: string[], status: CheckStatus | null): void {
  const output = document.getElementById('output');
  if (!output) return;

  output.textContent = lines.join('\n');

  if (status) {
    output.setAttribute('data-status', status);
  } else {
    output.removeAttribute('data-status');
  }
}

function renderFatal(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);

  setOutput(
    [
      'Overall: \u274C FAIL',
      '',
      `\u274C Client module failed to load: ${truncate(message)}`,
      '',
      'If this mentions a missing VITE_ variable, the dev server was started',
      'before .env existed. Stop it and run `npm run dev` again.',
    ],
    'fail'
  );
}

async function run(): Promise<void> {
  setOutput(['Running checks\u2026'], null);

  try {
    // Dynamic import so a module-scope failure in supabaseClient.ts
    // (missing env vars) is reported here instead of breaking the page.
    const { checkSupabaseConnection, sanitizeForDisplay } = await import(
      '../lib/supabaseHealthcheck'
    );

    const report = await checkSupabaseConnection();

    setOutput(
      [
        `Overall: ${STATUS_ICON[report.overall]} ${report.overall.toUpperCase()}`,
        `Checked at: ${report.checkedAt}`,
        '',
        ...report.results.map(
          (r) => `${STATUS_ICON[r.status]} ${r.name}: ${sanitizeForDisplay(r.detail)}`
        ),
      ],
      report.overall
    );
  } catch (err) {
    renderFatal(err);
  }
}

void run();

document.getElementById('rerun')?.addEventListener('click', () => {
  void run();
});
