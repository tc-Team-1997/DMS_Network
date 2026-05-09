/**
 * SetPasswordPage — anonymous route at /set-password?token=…
 * Validates the magic-link token and lets a new user set their first password.
 * No session required; no plaintext passwords transmitted to admins.
 */

import { useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { KeyRound, CheckCircle, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui';
import { setPassword } from '@/modules/users/api';
import { HttpError } from '@/lib/http';

type PageState = 'idle' | 'pending' | 'success' | 'error';

const ERROR_MESSAGES: Record<string, string> = {
  invalid_token:      'Invalid or malformed token.',
  token_already_used: 'This link has already been used. Contact your administrator for a new invite.',
  token_expired:      'This invite link has expired. Contact your administrator for a new invite.',
  token_not_found:    'Link not found. It may have been revoked.',
  password_too_short: 'Password does not meet the minimum length requirement.',
};

export function SetPasswordPage() {
  const [params]   = useSearchParams();
  const navigate   = useNavigate();
  const token      = params.get('token') ?? '';

  const [password,  setPasswordValue]  = useState('');
  const [confirm,   setConfirm]         = useState('');
  const [pageState, setPageState]       = useState<PageState>('idle');
  const [errorMsg,  setErrorMsg]        = useState('');

  if (!token) {
    return (
      <CenteredCard>
        <AlertCircle size={24} className="text-danger mx-auto" />
        <h1 className="text-lg font-semibold text-ink text-center">Missing token</h1>
        <p className="text-sm text-muted text-center">
          This link is missing its token parameter. Please use the full link from your invitation email.
        </p>
      </CenteredCard>
    );
  }

  const mismatch = password !== confirm && confirm.length > 0;

  const submit = async () => {
    if (password !== confirm) { setErrorMsg('Passwords do not match.'); return; }
    if (password.length < 8)  { setErrorMsg('Password must be at least 8 characters.'); return; }

    setPageState('pending');
    setErrorMsg('');

    try {
      await setPassword({ token, password });
      setPageState('success');
    } catch (e) {
      const errKey =
        e instanceof HttpError && typeof e.data === 'object' && e.data !== null && 'error' in e.data
          ? String((e.data as { error: unknown }).error)
          : '';
      setErrorMsg(ERROR_MESSAGES[errKey] ?? (e instanceof Error ? e.message : 'An error occurred.'));
      setPageState('error');
    }
  };

  if (pageState === 'success') {
    return (
      <CenteredCard>
        <CheckCircle size={32} className="text-success mx-auto" />
        <h1 className="text-xl font-semibold text-ink text-center">Password set!</h1>
        <p className="text-sm text-muted text-center">
          Your account is now active. You can log in with your email and the password you just created.
        </p>
        <Button
          size="sm"
          onClick={() => navigate('/login')}
          className="w-full justify-center"
        >
          Go to login
        </Button>
      </CenteredCard>
    );
  }

  return (
    <CenteredCard>
      <div className="flex items-center gap-3 mb-2">
        <KeyRound size={20} className="text-brand-blue" />
        <h1 className="text-lg font-semibold text-ink">Set your password</h1>
      </div>
      <p className="text-sm text-muted mb-6">
        Choose a strong password to activate your account.
      </p>

      <div className="space-y-4">
        <label className="flex flex-col gap-1 text-sm text-ink-sub">
          New password
          <input
            type="password"
            value={password}
            onChange={(e) => setPasswordValue(e.target.value)}
            placeholder="At least 8 characters"
            className="input"
            data-testid="set-password-field"
            autoComplete="new-password"
          />
        </label>

        <label className="flex flex-col gap-1 text-sm text-ink-sub">
          Confirm password
          <input
            type="password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            placeholder="Repeat password"
            className={`input ${mismatch ? 'border-danger focus:border-danger' : ''}`}
            data-testid="set-password-confirm"
            autoComplete="new-password"
          />
          {mismatch && <span className="text-xs text-danger">Passwords do not match</span>}
        </label>

        {errorMsg && (
          <p className="text-sm text-danger" data-testid="set-password-error">{errorMsg}</p>
        )}

        <Button
          size="sm"
          onClick={() => { void submit(); }}
          loading={pageState === 'pending'}
          disabled={!password || !confirm || mismatch}
          className="w-full justify-center"
          data-testid="set-password-submit"
        >
          Set password &amp; activate account
        </Button>
      </div>
    </CenteredCard>
  );
}

function CenteredCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-card border border-divider bg-surface p-8 shadow-card space-y-4">
        {children}
      </div>
    </div>
  );
}
