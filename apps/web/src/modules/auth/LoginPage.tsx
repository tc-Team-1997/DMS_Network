import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Navigate, useNavigate, useLocation } from 'react-router-dom';
import { FileText, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { HttpError } from '@/lib/http';
import { Button, Input } from '@/components/ui';
import { fetchTenantPublic, type Tenant } from '@/store/tenant';

const schema = z.object({
  username: z.string().min(1, 'Username required'),
  password: z.string().min(1, 'Password required'),
});
type FormData = z.infer<typeof schema>;

// ---------------------------------------------------------------------------
// Static hero panel — shows tenant branding from the anonymous endpoint
// ---------------------------------------------------------------------------

function StaticHeroPanel({ tenant }: { tenant: Tenant | null }) {
  const displayName = tenant?.display_name ?? '';
  const banner = tenant?.login_banner ?? 'Document operations that survive scrutiny.';

  return (
    <div className="relative h-full w-full overflow-hidden bg-brand-navy">
      <div
        className="absolute inset-0 opacity-[0.10] auth-grid"
        style={{
          backgroundImage: 'radial-gradient(circle, #ffffff 1px, transparent 1px)',
          backgroundSize: '18px 18px',
        }}
      />
      <div className="auth-blob-a absolute -top-24 -right-24 w-[460px] h-[460px] rounded-full bg-brand-blue/35 blur-3xl" />
      <div className="auth-blob-b absolute -bottom-32 -left-16 w-[380px] h-[380px] rounded-full bg-brand-sky/25 blur-3xl" />
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(135deg, rgba(255,255,255,0.04) 0%, rgba(255,255,255,0) 40%, rgba(255,255,255,0.03) 100%)',
        }}
      />

      <div className="relative h-full flex flex-col justify-between p-10">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-brand-blue rounded-lg flex items-center justify-center shadow-lg shadow-brand-blue/30">
            <FileText size={16} className="text-white" strokeWidth={2.25} />
          </div>
          <div>
            <p className="text-white text-[13px] font-semibold leading-tight">
              {displayName || 'DocManager'}
            </p>
            <p className="text-white/60 text-[10px] leading-tight">Enterprise Document Management</p>
          </div>
        </div>

        <div className="relative min-h-[220px] flex flex-col justify-center">
          <div className="w-14 h-14 rounded-2xl bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center mb-5 shadow-xl shadow-black/20">
            <FileText size={24} className="text-white" strokeWidth={1.75} />
          </div>
          <h2 className="text-white text-[26px] font-semibold leading-[1.15] tracking-tight mb-3 max-w-md">
            {displayName ? `Welcome to ${displayName}.` : 'Capture, classify, index.'}
          </h2>
          <p className="text-white/70 text-[13px] leading-relaxed max-w-md">
            {banner}
          </p>
        </div>

        <div />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Login page
// ---------------------------------------------------------------------------

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const login = useAuth((s) => s.login);
  const status = useAuth((s) => s.status);
  const [serverError, setServerError] = useState<string | null>(null);
  const [publicTenant, setPublicTenant] = useState<Tenant | null>(null);

  // Fetch public tenant branding — anonymous, before user is authenticated.
  // This powers the hero panel's display_name and login_banner.
  useEffect(() => {
    fetchTenantPublic()
      .then(setPublicTenant)
      .catch(() => {
        // Silently ignore — the panel falls back to generic copy.
      });
  }, []);

  // Parse the ?next= return URL set by the 401 interceptor or expiry redirect.
  const searchParams = new URLSearchParams(location.search);
  const nextParam = searchParams.get('next');
  const returnTo = nextParam && nextParam.startsWith('/') ? nextParam : '/';

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({ resolver: zodResolver(schema) });

  if (status === 'authenticated') return <Navigate to={returnTo} replace />;

  const onSubmit = handleSubmit(async ({ username, password }) => {
    setServerError(null);
    try {
      await login(username, password);
      navigate(returnTo, { replace: true });
    } catch (err) {
      if (err instanceof HttpError && err.status === 401) setServerError('Invalid credentials. Please try again.');
      else if (err instanceof HttpError && err.status === 403) setServerError('Account is locked. Contact your administrator.');
      else setServerError('Sign-in failed. Please try again.');
    }
  });

  const displayName = publicTenant?.display_name ?? '';

  return (
    <div className="min-h-screen flex bg-white">
      <div className="hidden lg:block lg:w-1/2">
        <StaticHeroPanel tenant={publicTenant} />
      </div>

      <div className="w-full lg:w-1/2 flex items-center justify-center px-6 py-4 relative bg-white overflow-hidden">
        <div
          className="absolute top-0 left-0 right-0 h-[46%] pointer-events-none opacity-60"
          style={{
            backgroundImage:
              'radial-gradient(circle, rgba(13,43,106,0.07) 1px, transparent 1px)',
            backgroundSize: '14px 14px',
            WebkitMaskImage:
              'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 40%, rgba(0,0,0,0) 100%)',
            maskImage:
              'linear-gradient(to bottom, rgba(0,0,0,1) 0%, rgba(0,0,0,0.9) 40%, rgba(0,0,0,0) 100%)',
          }}
        />

        <div className="w-full max-w-[360px] relative">
          <div className="flex items-center gap-2.5 mb-5 lg:hidden">
            <div className="w-8 h-8 bg-action rounded flex items-center justify-center">
              <FileText size={14} className="text-white" strokeWidth={2.25} />
            </div>
            <div>
              <p className="text-ink text-sm font-semibold leading-tight">
                {displayName || 'DocManager'}
              </p>
              <p className="text-muted text-[11px]">Enterprise Document Management</p>
            </div>
          </div>

          <div className="hidden lg:flex w-10 h-10 bg-brand-blue rounded-xl items-center justify-center mb-4 shadow-sm">
            <ShieldCheck size={18} className="text-white" strokeWidth={2} />
          </div>

          <h2 className="text-xl font-semibold text-ink mb-1 tracking-tight">Sign in</h2>
          <p className="text-[13px] text-sub mb-5">
            {displayName
              ? `${displayName} document operations for authorised staff only`
              : 'Document operations for authorised staff only'}
          </p>

          <form onSubmit={onSubmit} className="space-y-3" noValidate>
            <Input
              {...register('username')}
              label="Username"
              autoComplete="username"
              placeholder="your.username"
              error={errors.username?.message ?? ''}
              required
            />
            <Input
              {...register('password')}
              type="password"
              label="Password"
              autoComplete="current-password"
              placeholder="••••••••"
              error={errors.password?.message ?? ''}
              required
            />

            {serverError && (
              <p className="text-[11px] text-danger bg-danger-bg border border-danger/20 rounded px-3 py-1.5">
                {serverError}
              </p>
            )}

            <Button type="submit" className="w-full" loading={isSubmitting}>
              Sign in
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
