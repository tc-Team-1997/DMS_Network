// data-testid inventory (§6.4):
//   reset-submit — submit button

import { useId, useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Input } from '@/components/ui';
import { post } from '@/lib/http';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';

const Resp = z.object({ ok: z.literal(true) });

export default function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tokenValid, setTokenValid] = useState<boolean | null>(null);
  const errId = useId();

  useEffect(() => {
    if (!token) {
      setErr(t('auth.reset_missing_token'));
      setTokenValid(false);
      return;
    }
    fetch(`/spa/api/auth/reset-password/${encodeURIComponent(token)}/validate`)
      .then((r) => {
        if (!r.ok) {
          setErr(t('auth.reset_invalid_token'));
          setTokenValid(false);
        } else {
          setTokenValid(true);
        }
      })
      .catch(() => {
        setErr(t('auth.reset_invalid_token'));
        setTokenValid(false);
      });
  }, [token, t]);

  return (
    <main id="main" className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          if (pw !== pw2) {
            setErr(t('auth.reset_mismatch'));
            return;
          }
          setBusy(true);
          try {
            await post('/spa/api/auth/reset-password', { token, password: pw }, Resp);
            navigate('/login');
          } catch (caught: unknown) {
            const msg =
              caught instanceof Error
                ? caught.message
                : t('auth.reset_failed');
            setErr(msg);
          } finally {
            setBusy(false);
          }
        }}
        className="w-full max-w-sm space-y-3"
        aria-describedby={err !== null ? errId : undefined}
      >
        <h1 className="text-lg font-semibold">{t('auth.reset_title')}</h1>
        <Input
          label={t('auth.new_password')}
          type="password"
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          disabled={tokenValid === false}
          required
        />
        <Input
          label={t('auth.confirm_password')}
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          disabled={tokenValid === false}
          required
        />
        {err !== null && (
          <p id={errId} role="alert" className="text-2xs text-danger-on-light">
            {err}
          </p>
        )}
        <Button
          type="submit"
          data-testid="reset-submit"
          disabled={busy || !pw || !pw2 || tokenValid === false}
        >
          {t('auth.reset_submit')}
        </Button>
      </form>
    </main>
  );
}
