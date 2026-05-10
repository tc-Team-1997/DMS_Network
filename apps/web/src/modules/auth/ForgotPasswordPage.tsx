// data-testid inventory (§6.4):
//   forgot-submit   — submit button
//   forgot-success  — success message paragraph

import { useId, useState } from 'react';
import { Button, Input } from '@/components/ui';
import { post } from '@/lib/http';
import { z } from 'zod';
import { useTranslation } from 'react-i18next';

const Resp = z.object({ ok: z.literal(true) });

export default function ForgotPasswordPage() {
  const { t } = useTranslation();
  const [username, setUsername] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputId = useId();

  return (
    <main id="main" className="min-h-screen flex items-center justify-center p-4">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            await post('/spa/api/auth/forgot-password', { username }, Resp);
          } catch {
            // Always show success-ish message — user-enumeration-safe.
          }
          setBusy(false);
          setDone(true);
        }}
        className="w-full max-w-sm space-y-3"
      >
        <h1 className="text-lg font-semibold">{t('auth.forgot_title')}</h1>
        {done ? (
          <p data-testid="forgot-success" className="text-2xs text-success-on-light">
            {t('auth.forgot_done')}
          </p>
        ) : (
          <>
            <Input
              id={inputId}
              label={t('auth.username_or_email')}
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              autoFocus
              required
            />
            <Button type="submit" data-testid="forgot-submit" disabled={busy || !username}>
              {t('auth.send_reset_link')}
            </Button>
          </>
        )}
      </form>
    </main>
  );
}
