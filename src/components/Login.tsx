import { useState } from 'react';
import type { FormEvent } from 'react';
import { auth, googleProvider, signInWithPopup } from '../data';
import { ArrowRight, AlertCircle, User, Lock, Eye, EyeOff } from 'lucide-react';
import { useAuth } from '../App';

function LoginLamp({ isOn }: { isOn: boolean }) {
  return (
    <div className="relative mx-auto h-64 w-64">
      <div
        className={`absolute left-1/2 top-10 h-32 w-32 -translate-x-1/2 rounded-full blur-3xl transition-all duration-500 ${
          isOn ? 'bg-amber-200/90 opacity-100 animate-pulse' : 'bg-indigo-200/30 opacity-45'
        }`}
      />
      <span
        className={`absolute left-1/2 top-0 h-10 w-1 -translate-x-1/2 rounded-full transition-all duration-500 ${
          isOn ? 'bg-amber-300 opacity-100' : 'bg-indigo-200/50 opacity-0'
        }`}
      />
      <span
        className={`absolute left-[26%] top-7 h-8 w-1 rounded-full transition-all duration-500 ${
          isOn ? 'bg-amber-300 opacity-100' : 'bg-indigo-200/50 opacity-0'
        }`}
        style={{ transform: 'rotate(-55deg)' }}
      />
      <span
        className={`absolute right-[26%] top-7 h-8 w-1 rounded-full transition-all duration-500 ${
          isOn ? 'bg-amber-300 opacity-100' : 'bg-indigo-200/50 opacity-0'
        }`}
        style={{ transform: 'rotate(55deg)' }}
      />
      <span
        className={`absolute left-[18%] top-[72px] h-7 w-1 rounded-full transition-all duration-500 ${
          isOn ? 'bg-amber-300 opacity-100' : 'bg-indigo-200/50 opacity-0'
        }`}
        style={{ transform: 'rotate(-88deg)' }}
      />
      <span
        className={`absolute right-[18%] top-[72px] h-7 w-1 rounded-full transition-all duration-500 ${
          isOn ? 'bg-amber-300 opacity-100' : 'bg-indigo-200/50 opacity-0'
        }`}
        style={{ transform: 'rotate(88deg)' }}
      />

      <div
        className={`absolute left-1/2 top-7 h-[120px] w-24 -translate-x-1/2 rounded-[46%_46%_40%_40%/58%_58%_34%_34%] border transition-all duration-500 ${
          isOn
            ? 'border-amber-100 bg-[radial-gradient(circle_at_50%_25%,rgba(255,255,255,0.98)_0%,rgba(254,240,138,0.96)_45%,rgba(251,191,36,0.82)_100%)] shadow-[0_0_32px_rgba(251,191,36,0.45)]'
            : 'border-indigo-100/70 bg-[radial-gradient(circle_at_50%_25%,rgba(255,255,255,0.92)_0%,rgba(224,231,255,0.96)_55%,rgba(129,140,248,0.4)_100%)]'
        }`}
      >
        <div className="absolute left-1/2 top-12 h-7 w-10 -translate-x-1/2 rounded-full border-2 border-indigo-950/60" />
        <div
          className={`absolute left-1/2 top-[76px] h-2.5 w-2.5 -translate-x-1/2 rounded-full transition-all duration-500 ${
            isOn ? 'bg-amber-950/80' : 'bg-indigo-500/50'
          }`}
        />
        <div
          className={`absolute left-1/2 top-[87px] h-5 w-1 -translate-x-1/2 rounded-full transition-all duration-500 ${
            isOn ? 'bg-amber-950/80' : 'bg-indigo-500/50'
          }`}
        />
      </div>

      <div className="absolute left-1/2 top-[144px] h-9 w-14 -translate-x-1/2 rounded-b-2xl rounded-t-md bg-indigo-950/85">
        <span className="absolute inset-x-2 top-2 h-px bg-white/30" />
        <span className="absolute inset-x-2 top-4 h-px bg-white/25" />
        <span className="absolute inset-x-2 top-6 h-px bg-white/20" />
      </div>
      <div className="absolute left-1/2 top-[180px] h-14 w-2 -translate-x-1/2 rounded-full bg-indigo-950/85" />
      <div className="absolute left-1/2 top-[228px] h-2 w-24 -translate-x-1/2 rounded-full bg-indigo-300/60" />
      <div className="absolute left-1/2 top-[238px] h-5 w-40 -translate-x-1/2 rounded-full bg-indigo-950 shadow-[0_20px_32px_rgba(49,46,129,0.24)]" />
    </div>
  );
}

export default function Login() {
  const { login } = useAuth()!;
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Google login failed');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await login(username, password);
    } catch (error: unknown) {
      setError(error instanceof Error ? error.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen overflow-hidden bg-[radial-gradient(circle_at_top,#6366f1_0%,#4338ca_32%,#312e81_68%,#1e1b4b_100%)] px-3 py-3 sm:px-5 sm:py-4">
      <div className="mx-auto flex min-h-[calc(100vh-24px)] max-w-5xl items-center justify-center">
        <div className="w-full max-h-[calc(100vh-24px)] overflow-auto rounded-[28px] border border-white/20 bg-white/96 shadow-[0_28px_80px_rgba(30,27,75,0.34)] backdrop-blur md:grid md:grid-cols-[0.94fr_1.06fr] md:overflow-hidden">
          <section className="relative hidden overflow-hidden border-r border-white/10 bg-[linear-gradient(180deg,#1e1b4b_0%,#312e81_42%,#4338ca_100%)] p-8 md:flex md:flex-col md:justify-between lg:p-10">
            <div className="relative z-10">
              <div className="inline-flex items-center rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[11px] font-semibold text-indigo-100 shadow-sm backdrop-blur">
                Lighting up your sales workspace
              </div>
              <h1 className="mt-5 max-w-sm text-3xl font-black tracking-tight text-white">
                A brighter start for every shift.
              </h1>
              <p className="mt-3 max-w-sm text-sm leading-6 text-indigo-100/85">
                Sign in to open sales, manage customers, and keep your day moving from one clean workspace.
              </p>
            </div>

            <div className="relative z-10 flex flex-1 items-center justify-center py-6">
              <LoginLamp isOn={loading} />
            </div>

            <div className="relative z-10 flex items-center justify-between rounded-2xl border border-white/10 bg-white/10 px-4 py-3 shadow-sm backdrop-blur">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-indigo-100/70">
                  Lamp Status
                </p>
                <p className="mt-1 text-sm font-semibold text-white">
                  {loading ? 'Power on: authenticating...' : 'Power off: waiting for sign in'}
                </p>
              </div>
              <span
                className={`h-3.5 w-3.5 rounded-full ${
                  loading ? 'bg-amber-400 shadow-[0_0_18px_rgba(251,191,36,0.9)]' : 'bg-indigo-200/60'
                }`}
              />
            </div>

            <div className="absolute left-8 top-8 h-20 w-20 rounded-full bg-indigo-300/20 blur-2xl" />
            <div className="absolute bottom-16 right-10 h-24 w-24 rounded-full bg-blue-300/20 blur-3xl" />
          </section>

          <section className="flex flex-col justify-center p-6 sm:p-8 lg:px-10 lg:py-9">
            <div className="mx-auto w-full max-w-md">
              <div className="mb-6">
                <div className="inline-flex items-center rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-semibold text-indigo-700">
                  KingKush Sale
                </div>
                <h2 className="mt-4 text-3xl font-black tracking-tight text-slate-900">
                  Welcome back
                </h2>
                <p className="mt-2 text-sm text-slate-500">
                  Sign in to continue to your workspace.
                </p>
              </div>

              {error && (
                <div className="mb-4 flex items-start gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
                  <AlertCircle className="mt-0.5 h-[18px] w-[18px] shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Username
                  </label>
                  <div className="relative">
                    <User className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="h-12 w-full rounded-xl border border-indigo-100 bg-indigo-50/60 pl-11 pr-4 text-sm font-medium text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                      placeholder="Enter username"
                      required
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <label className="text-[11px] font-semibold uppercase tracking-[0.2em] text-slate-500">
                    Password
                  </label>
                  <div className="relative">
                    <Lock className="absolute left-4 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-slate-400" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="h-12 w-full rounded-xl border border-indigo-100 bg-indigo-50/60 pl-11 pr-12 text-sm font-medium text-slate-900 outline-none transition-all placeholder:text-slate-400 focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                      placeholder="Enter password"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-indigo-400 transition-colors hover:bg-indigo-100 hover:text-indigo-700"
                    >
                      {showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
                    </button>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[linear-gradient(135deg,#312e81_0%,#4338ca_55%,#4f46e5_100%)] text-sm font-semibold text-white shadow-[0_14px_30px_rgba(79,70,229,0.22)] transition-all hover:shadow-[0_18px_34px_rgba(79,70,229,0.28)] disabled:cursor-not-allowed disabled:shadow-none disabled:opacity-60"
                >
                  {loading ? (
                    <>
                      <span className="h-[18px] w-[18px] rounded-full border-2 border-white/30 border-t-white animate-spin" />
                      Signing in...
                    </>
                  ) : (
                    <>
                      Sign in
                      <ArrowRight className="h-[18px] w-[18px]" />
                    </>
                  )}
                </button>
              </form>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-indigo-100" />
                <span className="text-[11px] font-semibold uppercase tracking-[0.2em] text-indigo-300">
                  Google
                </span>
                <div className="h-px flex-1 bg-indigo-100" />
              </div>

              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="flex h-11 w-full items-center justify-center gap-3 rounded-xl border border-indigo-100 bg-white text-sm font-semibold text-slate-700 transition-all hover:border-indigo-200 hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                  G
                </span>
                Continue with Google
              </button>

              <p className="mt-5 text-center text-[11px] font-medium text-indigo-300">
                (c) 2026 KingKush Sale
              </p>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
