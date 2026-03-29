import React, { useState } from 'react';
import { auth, googleProvider, signInWithPopup } from '../data';
import { Shield, X, ArrowRight, AlertCircle, User, Lock, Eye, EyeOff } from 'lucide-react';
import ReadinessPanel from './ReadinessPanel';
import { useAuth } from '../App';

export default function Login() {
  const { login } = useAuth()!;
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showReadiness, setShowReadiness] = useState(false);
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

  const handleSubmit = async (e: React.FormEvent) => {
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
    <div className="min-h-screen bg-indigo-900 flex items-center justify-center p-4">
      <div className="max-w-md w-full">
        <div className="bg-white p-10 rounded-[2.5rem] shadow-2xl relative overflow-hidden">
          {/* Decorative background element */}
          <div className="absolute -top-24 -right-24 w-48 h-48 bg-indigo-50 rounded-full blur-3xl opacity-50" />
          <div className="absolute -bottom-24 -left-24 w-48 h-48 bg-blue-50 rounded-full blur-3xl opacity-50" />
          
          <div className="relative">
            <div className="flex flex-col items-center mb-10">
              <div className="w-20 h-20 bg-indigo-600 rounded-3xl flex items-center justify-center mb-6 shadow-lg shadow-indigo-200">
                <Shield className="w-10 h-10 text-white" />
              </div>
              <h1 className="text-4xl font-black text-gray-900 tracking-tight mb-2">KingKush</h1>
              <p className="text-gray-600 font-bold uppercase text-[10px] tracking-[0.2em]">Premium Sales System</p>
            </div>

            {error && (
              <div className="mb-8 p-4 bg-red-50 border border-red-100 text-red-600 rounded-2xl text-sm font-bold flex items-center gap-3 animate-in fade-in slide-in-from-top-2">
                <AlertCircle className="w-5 h-5 shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest ml-4">Username</label>
                <div className="relative">
                  <User className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full pl-14 pr-6 py-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 transition-all font-bold text-gray-900 placeholder:text-gray-300 outline-none"
                    placeholder="Enter username"
                    required
                  />
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-[10px] font-black text-gray-600 uppercase tracking-widest ml-4">Password</label>
                <div className="relative">
                  <Lock className="absolute left-6 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full pl-14 pr-14 py-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 transition-all font-bold text-gray-900 placeholder:text-gray-300 outline-none"
                    placeholder="••••••••"
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-6 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 transition-colors"
                  >
                    {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group relative w-full overflow-hidden rounded-2xl border border-indigo-950/10 bg-[linear-gradient(135deg,#312e81_0%,#4338ca_55%,#4f46e5_100%)] px-6 py-4 text-white shadow-[0_14px_30px_rgba(79,70,229,0.24)] transition-all duration-200 hover:-translate-y-0.5 hover:shadow-[0_18px_36px_rgba(79,70,229,0.28)] active:translate-y-0 disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
              >
                <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/60" />
                {loading ? (
                  <span className="relative flex items-center justify-center py-1">
                    <span className="h-6 w-6 rounded-full border-4 border-white/25 border-t-white animate-spin" />
                  </span>
                ) : (
                  <span className="relative flex items-center justify-between gap-4">
                    <span className="text-left">
                      <span className="block text-[10px] font-black uppercase tracking-[0.28em] text-indigo-100/80">
                        Secure Access
                      </span>
                      <span className="mt-1 block text-lg font-black tracking-tight">
                        Sign In
                      </span>
                    </span>
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/12 ring-1 ring-white/20 transition-transform duration-200 group-hover:translate-x-1">
                      <ArrowRight className="w-5 h-5" />
                    </span>
                  </span>
                )}
              </button>
            </form>

            <div className="mt-10">
              <div className="relative flex items-center justify-center mb-8">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-gray-100"></div>
                </div>
                <span className="relative px-4 bg-white text-[10px] font-black text-gray-500 uppercase tracking-widest">Or Super Admin Google Login</span>
              </div>

              <button
                onClick={handleGoogleLogin}
                disabled={loading}
                className="w-full bg-white border-2 border-gray-100 text-gray-600 py-4 rounded-2xl font-bold hover:bg-gray-50 transition-all flex items-center justify-center gap-3"
              >
                <div className="w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-black flex items-center justify-center">G</div>
                Google Account
              </button>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-col items-center gap-4">
          <button 
            onClick={() => setShowReadiness(true)}
            className="flex items-center gap-2 text-[10px] font-black text-indigo-200 uppercase tracking-widest hover:text-white transition-colors"
          >
            <Shield className="w-4 h-4" />
            System Readiness Check
          </button>
          <p className="text-[10px] font-bold text-indigo-300 uppercase tracking-[0.3em]">© 2026 KingKush Sale</p>
        </div>
      </div>

      {showReadiness && (
        <div className="fixed inset-0 bg-indigo-950/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in duration-300">
          <div className="bg-white w-full max-w-lg rounded-[2.5rem] shadow-2xl overflow-hidden animate-in zoom-in-95 duration-300">
            <div className="p-8 border-b border-gray-50 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Shield className="w-6 h-6 text-indigo-600" />
                <h2 className="text-xl font-black text-gray-900">System Readiness</h2>
              </div>
              <button 
                onClick={() => setShowReadiness(false)}
                className="p-2 hover:bg-gray-100 rounded-xl transition-colors"
              >
                <X className="w-6 h-6 text-gray-500" />
              </button>
            </div>
            <div className="p-8">
              <ReadinessPanel />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
