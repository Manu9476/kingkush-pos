import React, { Component, createContext, useContext, useState, useEffect } from 'react';
import type { ErrorInfo } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { 
  db, 
  auth,
  onAuthStateChanged,
  onSnapshot,
  signInWithEmailAndPassword,
  signOut,
  doc
} from './data';
import { UserProfile } from './types';
import { bootstrapSuperadmin, getSetupStatus } from './services/platformApi';
import { 
  LayoutDashboard, 
  Package, 
  ShoppingCart, 
  BarChart3, 
  LogOut, 
  Menu, 
  X,
  Shield,
  CreditCard,
  ClipboardList,
  Truck,
  Tag,
  Users as UsersIcon,
  FolderTree,
  Receipt,
  History as HistoryIcon,
  Banknote,
  Building2
} from 'lucide-react';

import Dashboard from './components/Dashboard';
import Products from './components/Products';
import POS from './components/POS';
import Reports from './components/Reports';
import Login from './components/Login';
import { Toaster } from 'sonner';
import ReadinessPanel from './components/ReadinessPanel';
import Categories from './components/Categories';
import Suppliers from './components/Suppliers';
import Inventory from './components/Inventory';
import Users from './components/Users';
import Labels from './components/Labels';
import Credits from './components/Credits';
import Customers from './components/Customers';
import Settings from './components/Settings';
import Expenses from './components/Expenses';
import SalesHistory from './components/SalesHistory';
import AuditLogs from './components/AuditLogs';
import PurchaseOrders from './components/PurchaseOrders';
import CashShifts from './components/CashShifts';
import Branches from './components/Branches';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: unknown;
}

class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: unknown) {
    return { hasError: true, error };
  }

  componentDidCatch(error: unknown, errorInfo: ErrorInfo) {
    if (process.env.NODE_ENV === 'development') {
      console.error('ErrorBoundary caught an error', error, errorInfo);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-red-50 flex items-center justify-center p-6">
          <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-lg w-full text-center space-y-4">
            <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
              <X className="w-8 h-8" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900">Something went wrong</h1>
            <p className="text-gray-600">The application encountered an unexpected error. Please try refreshing the page.</p>
            <div className="text-left bg-gray-50 p-4 rounded-xl overflow-auto max-h-40">
              <code className="text-xs text-red-500">{this.state.error instanceof Error ? this.state.error.message : String(this.state.error)}</code>
            </div>
            <button 
              onClick={() => window.location.reload()}
              className="w-full py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
            >
              Refresh Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

const AuthContext = createContext<{
  user: UserProfile | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  bootstrapRequired: boolean;
  bootstrap: (displayName: string, username: string, password: string) => Promise<void>;
  setUser: React.Dispatch<React.SetStateAction<UserProfile | null>>;
} | null>(null);

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
};

type AppModule = {
  id: string;
  label: string;
  path: string;
  icon: React.ComponentType<{ className?: string }>;
  permissions: string[];
};

const APP_MODULES: AppModule[] = [
  { id: 'dashboard', label: 'Dashboard', path: '/', icon: LayoutDashboard, permissions: ['dashboard'] },
  { id: 'pos', label: 'Sale', path: '/pos', icon: ShoppingCart, permissions: ['pos'] },
  { id: 'sales-history', label: 'Sales History', path: '/sales-history', icon: Receipt, permissions: ['sales-history'] },
  { id: 'shifts', label: 'Cash Shifts', path: '/cash-shifts', icon: Banknote, permissions: ['shifts', 'pos'] },
  { id: 'customers', label: 'Customers', path: '/customers', icon: UsersIcon, permissions: ['customers'] },
  { id: 'credits', label: 'Credits', path: '/credits', icon: CreditCard, permissions: ['credits'] },
  { id: 'products', label: 'Products', path: '/products', icon: Package, permissions: ['products'] },
  { id: 'categories', label: 'Categories', path: '/categories', icon: FolderTree, permissions: ['categories'] },
  { id: 'inventory', label: 'Inventory', path: '/inventory', icon: ClipboardList, permissions: ['inventory'] },
  { id: 'purchase-orders', label: 'Purchase Orders', path: '/purchase-orders', icon: Truck, permissions: ['purchase-orders'] },
  { id: 'suppliers', label: 'Suppliers', path: '/suppliers', icon: Truck, permissions: ['suppliers'] },
  { id: 'branches', label: 'Branches', path: '/branches', icon: Building2, permissions: ['branches'] },
  { id: 'labels', label: 'Labels', path: '/labels', icon: Tag, permissions: ['labels'] },
  { id: 'reports', label: 'Reports', path: '/reports', icon: BarChart3, permissions: ['reports'] },
  { id: 'expenses', label: 'Expenses', path: '/expenses', icon: Receipt, permissions: ['expenses'] },
  { id: 'users', label: 'Users', path: '/users', icon: UsersIcon, permissions: ['users'] },
  { id: 'audit-logs', label: 'Audit Logs', path: '/audit-logs', icon: HistoryIcon, permissions: ['audit-logs'] },
  { id: 'settings', label: 'Settings', path: '/settings', icon: Shield, permissions: ['settings'] },
  { id: 'status', label: 'System Status', path: '/status', icon: Shield, permissions: ['status'] }
];

function userHasAnyPermission(user: UserProfile | null | undefined, permissionIds: string[]) {
  if (!user) {
    return false;
  }

  if (user.role === 'superadmin') {
    return true;
  }

  return permissionIds.some((permissionId) => user.permissions?.includes(permissionId));
}

function normalizeAuthMessage(message: string) {
  if (message.toLowerCase().includes('tuple concurrently updated')) {
    return 'The system is finishing a database update. Please retry in a few seconds.';
  }

  return message;
}

function isTerminalProfileError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('user profile not found') ||
    normalized.includes('account is inactive') ||
    normalized.includes('permission denied') ||
    normalized.includes('authentication required')
  );
}

function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const filteredNav = APP_MODULES.filter((item) => userHasAnyPermission(user, item.permissions));

  return (
    <div className="app-shell min-h-screen bg-gray-50 flex flex-col md:h-screen md:flex-row md:overflow-hidden">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-56 bg-indigo-900 text-white transform transition-transform duration-300 ease-in-out
        md:sticky md:top-0 md:h-screen md:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="h-full flex flex-col">
          <div className="p-6 shrink-0">
            <h1 className="text-xl font-black text-white tracking-tight">KingKush Sale</h1>
            <div className="mt-2">
              <p className="text-[10px] font-bold text-indigo-100 uppercase tracking-wider leading-tight">
                {user?.role === 'superadmin' ? 'System Super Admin' : 'Staff Portal'}
              </p>
              <p className="text-[10px] font-bold text-indigo-100 uppercase tracking-wider leading-tight">({user?.role})</p>
            </div>
          </div>

          <nav className="flex-1 px-3 space-y-1 overflow-y-auto custom-scrollbar">
            {filteredNav.map(item => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`
                  flex items-center gap-3 px-4 py-2.5 rounded-xl transition-all
                  ${location.pathname === item.path 
                    ? 'bg-indigo-800 text-white font-bold shadow-lg shadow-indigo-950/20' 
                    : 'text-indigo-200 hover:bg-indigo-800/50 hover:text-white font-medium'}
                `}
              >
                <item.icon className="w-4 h-4" />
                <span className="text-[13px]">{item.label}</span>
              </Link>
            ))}
          </nav>

          <div className="p-6 shrink-0 border-t border-indigo-800/50">
            <button 
              onClick={() => logout()}
              className="w-full flex items-center gap-3 px-4 py-2.5 text-indigo-200 hover:bg-red-500/10 hover:text-red-400 rounded-xl font-medium transition-all"
            >
              <LogOut className="w-4 h-4" />
              <span className="text-[13px]">Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="sticky top-0 z-40 h-16 shrink-0 bg-white/80 backdrop-blur-md border-b border-gray-100 flex items-center justify-between px-4 md:px-8">
          <div className="flex items-center gap-3">
            <span className="font-black text-indigo-900 text-lg md:hidden">KingKush Sale</span>
            <div className="hidden md:block">
              <p className="text-sm font-bold text-gray-900">Welcome back, {user?.displayName || user?.username}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{user?.role}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => logout()}
              className="flex items-center gap-2 px-3.5 py-2 text-red-600 hover:bg-red-50 rounded-xl font-bold transition-all text-sm border border-red-100"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 md:hidden">
              {isMobileMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </header>

        <div className="app-content flex-1 min-h-0 overflow-hidden p-4 md:p-6 lg:p-8">
          <div className="route-host h-full min-h-0">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);
  const [bootstrapRequired, setBootstrapRequired] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let unsubProfile: (() => void) | null = null;

    const initialize = async () => {
      try {
        const setup = await getSetupStatus();
        if (isMounted) {
          setBootstrapRequired(setup.needsBootstrap);
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Failed to load setup status', error);
        }
      }
    };

    void initialize();

    const unsubAuth = onAuthStateChanged(auth, (authUser) => {
      if (!isMounted) {
        return;
      }

      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      if (!authUser) {
        setUser(null);
        setAuthError(null);
        setLoading(false);
        return;
      }

      if (authUser.sessionProfile) {
        if (authUser.sessionProfile.status !== 'active') {
          void signOut(auth);
          setUser(null);
          setAuthError('Account is inactive. Please contact an administrator.');
          setLoading(false);
          return;
        }

        setUser(authUser.sessionProfile);
        setBootstrapRequired(false);
        setAuthError(null);
        setLoading(false);
      }

      unsubProfile = onSnapshot(
        doc(db, 'users', authUser.uid),
        async (userDoc) => {
          if (!isMounted) {
            return;
          }

          try {
            if (!userDoc.exists()) {
              await signOut(auth);
              throw new Error('User profile not found');
            }

            const userData = userDoc.data() as UserProfile;
            if (userData.status !== 'active') {
              await signOut(auth);
              throw new Error('Account is inactive. Please contact an administrator.');
            }

            setUser(userData);
            setBootstrapRequired(false);
            setAuthError(null);
          } catch (error) {
            const message = normalizeAuthMessage(
              error instanceof Error ? error.message : 'Failed to load user profile'
            );

            if (isTerminalProfileError(message)) {
              setUser(null);
              setAuthError(message);
            } else {
              setUser((currentUser) => currentUser ?? authUser.sessionProfile ?? null);
              setAuthError(null);
            }
          } finally {
            setLoading(false);
          }
        },
        (error) => {
          if (!isMounted) {
            return;
          }

          const message = normalizeAuthMessage(
            error instanceof Error ? error.message : 'Failed to load user profile'
          );

          if (isTerminalProfileError(message)) {
            setUser(null);
            setAuthError(message);
          } else {
            setUser((currentUser) => currentUser ?? authUser.sessionProfile ?? null);
            setAuthError(null);
          }

          setLoading(false);
        }
      );

      if (!unsubProfile) {
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
      if (unsubProfile) {
        unsubProfile();
      }
      unsubAuth();
    };
  }, []);

  const login = async (username: string, password: string) => {
    setAuthError(null);
    const email = `${username.toLowerCase()}@kingkush.local`;
    await signInWithEmailAndPassword(auth, email, password);
  };

  const bootstrap = async (displayName: string, username: string, password: string) => {
    setAuthError(null);
    await bootstrapSuperadmin({ displayName, username, password });
    setBootstrapRequired(false);
    const email = `${username.toLowerCase()}@kingkush.local`;
    await signInWithEmailAndPassword(auth, email, password);
  };

  const logout = async () => {
    setUser(null);
    await signOut(auth);
  };

  const canAccessModule = (moduleId: string) => {
    const module = APP_MODULES.find((entry) => entry.id === moduleId);
    return module ? userHasAnyPermission(user, module.permissions) : false;
  };

  const getDefaultAuthorizedPath = () => {
    if (!user) return '/login';
    if (user.role === 'superadmin') return '/';

    return APP_MODULES.find((module) => userHasAnyPermission(user, module.permissions))?.path ?? null;
  };

  const defaultAuthorizedPath = getDefaultAuthorizedPath();

  if (loading) {
    return (
      <div className="min-h-screen bg-indigo-900 flex items-center justify-center">
        <div className="text-center space-y-4">
          <div className="w-16 h-16 border-4 border-white border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-white font-medium animate-pulse">Initializing KingKush Sale...</p>
        </div>
      </div>
    );
  }

  if (authError && isTerminalProfileError(authError)) {
    return (
      <div className="min-h-screen bg-indigo-900 flex items-center justify-center p-6">
        <div className="bg-white p-8 rounded-3xl shadow-2xl max-w-md w-full text-center space-y-6">
          <div className="w-16 h-16 bg-red-100 text-red-600 rounded-full flex items-center justify-center mx-auto">
            <Shield className="w-8 h-8" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">Access Denied</h1>
          <p className="text-gray-600">{authError}</p>
          <button 
            onClick={() => setAuthError(null)}
            className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
          >
            Back to Login
          </button>
        </div>
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <AuthContext.Provider value={{ user, loading, login, logout, bootstrapRequired, bootstrap, setUser }}>
        <BrowserRouter>
          <Toaster position="top-right" richColors />
          {!user ? (
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="*" element={<Navigate to="/login" />} />
            </Routes>
          ) : (
            <Layout>
              {defaultAuthorizedPath ? (
                <Routes>
                  <Route path="/" element={canAccessModule('dashboard') ? <Dashboard /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/pos" element={canAccessModule('pos') ? <POS /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/sales-history" element={canAccessModule('sales-history') ? <SalesHistory /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/cash-shifts" element={canAccessModule('shifts') ? <CashShifts /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/customers" element={canAccessModule('customers') ? <Customers /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/credits" element={canAccessModule('credits') ? <Credits /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/products" element={canAccessModule('products') ? <Products /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/categories" element={canAccessModule('categories') ? <Categories /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/inventory" element={canAccessModule('inventory') ? <Inventory /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/purchase-orders" element={canAccessModule('purchase-orders') ? <PurchaseOrders /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/suppliers" element={canAccessModule('suppliers') ? <Suppliers /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/branches" element={canAccessModule('branches') ? <Branches /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/labels" element={canAccessModule('labels') ? <Labels /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/users" element={canAccessModule('users') ? <Users /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/audit-logs" element={canAccessModule('audit-logs') ? <AuditLogs /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/expenses" element={canAccessModule('expenses') ? <Expenses /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/reports" element={canAccessModule('reports') ? <Reports /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/settings" element={canAccessModule('settings') ? <Settings /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/status" element={canAccessModule('status') ? <ReadinessPanel /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="*" element={<Navigate to={defaultAuthorizedPath} replace />} />
                </Routes>
              ) : (
                <div className="max-w-xl mx-auto bg-white border border-gray-100 rounded-3xl p-8 text-center space-y-4">
                  <h2 className="text-2xl font-bold text-gray-900">No Access Assigned</h2>
                  <p className="text-gray-600">
                    This account does not have any enabled modules yet. Contact a superadmin to assign permissions.
                  </p>
                  <button
                    onClick={() => logout()}
                    className="inline-flex items-center justify-center px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all"
                  >
                    Logout
                  </button>
                </div>
              )}
            </Layout>
          )}
        </BrowserRouter>
      </AuthContext.Provider>
    </ErrorBoundary>
  );
}
