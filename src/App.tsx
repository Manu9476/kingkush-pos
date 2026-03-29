import React, { Component, createContext, useContext, useState, useEffect } from 'react';
import type { ErrorInfo } from 'react';
import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { 
  db, 
  auth,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  doc, 
  getDoc
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

function Layout({ children }: { children: React.ReactNode }) {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  const navItems = [
    { id: 'dashboard', label: 'Dashboard', path: '/', icon: LayoutDashboard },
    { id: 'pos', label: 'Sale', path: '/pos', icon: ShoppingCart },
    { id: 'sales-history', label: 'Sales History', path: '/sales-history', icon: Receipt },
    { id: 'shifts', label: 'Cash Shifts', path: '/cash-shifts', icon: Banknote },
    { id: 'customers', label: 'Customers', path: '/customers', icon: UsersIcon },
    { id: 'credits', label: 'Credits', path: '/credits', icon: CreditCard },
    { id: 'products', label: 'Products', path: '/products', icon: Package },
    { id: 'categories', label: 'Categories', path: '/categories', icon: FolderTree },
    { id: 'inventory', label: 'Inventory', path: '/inventory', icon: ClipboardList },
    { id: 'purchase-orders', label: 'Purchase Orders', path: '/purchase-orders', icon: Truck },
    { id: 'suppliers', label: 'Suppliers', path: '/suppliers', icon: Truck },
    { id: 'branches', label: 'Branches', path: '/branches', icon: Building2 },
    { id: 'labels', label: 'Labels', path: '/labels', icon: Tag },
    { id: 'reports', label: 'Reports', path: '/reports', icon: BarChart3 },
    { id: 'expenses', label: 'Expenses', path: '/expenses', icon: Receipt },
    { id: 'users', label: 'Users', path: '/users', icon: UsersIcon },
    { id: 'audit-logs', label: 'Audit Logs', path: '/audit-logs', icon: HistoryIcon },
    { id: 'settings', label: 'Settings', path: '/settings', icon: Shield },
    { id: 'status', label: 'System Status', path: '/status', icon: Shield },
  ];

  const filteredNav = navItems.filter(item => 
    user?.role === 'superadmin' || user?.permissions?.includes(item.id)
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className={`
        fixed inset-y-0 left-0 z-50 w-64 bg-indigo-900 text-white transform transition-transform duration-300 ease-in-out
        md:sticky md:top-0 md:h-screen md:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0' : '-translate-x-full'}
      `}>
        <div className="h-full flex flex-col">
          <div className="p-8 shrink-0">
            <h1 className="text-2xl font-black text-white tracking-tight">KingKush Sale</h1>
            <div className="mt-2">
              <p className="text-[10px] font-bold text-indigo-100 uppercase tracking-wider leading-tight">
                {user?.role === 'superadmin' ? 'System Super Admin' : 'Staff Portal'}
              </p>
              <p className="text-[10px] font-bold text-indigo-100 uppercase tracking-wider leading-tight">({user?.role})</p>
            </div>
          </div>

          <nav className="flex-1 px-4 space-y-1 overflow-y-auto custom-scrollbar">
            {filteredNav.map(item => (
              <Link
                key={item.path}
                to={item.path}
                onClick={() => setIsMobileMenuOpen(false)}
                className={`
                  flex items-center gap-4 px-6 py-3.5 rounded-2xl transition-all
                  ${location.pathname === item.path 
                    ? 'bg-indigo-800 text-white font-bold shadow-lg shadow-indigo-950/20' 
                    : 'text-indigo-200 hover:bg-indigo-800/50 hover:text-white font-medium'}
                `}
              >
                <item.icon className="w-5 h-5" />
                <span className="text-sm">{item.label}</span>
              </Link>
            ))}
          </nav>

          <div className="p-8 shrink-0 border-t border-indigo-800/50">
            <button 
              onClick={() => logout()}
              className="w-full flex items-center gap-4 px-6 py-3.5 text-indigo-200 hover:bg-red-500/10 hover:text-red-400 rounded-2xl font-medium transition-all"
            >
              <LogOut className="w-5 h-5" />
              <span className="text-sm">Logout</span>
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="sticky top-0 z-40 h-20 bg-white/80 backdrop-blur-md border-b border-gray-100 flex items-center justify-between px-6 md:px-12">
          <div className="flex items-center gap-3">
            <span className="font-black text-indigo-900 text-xl md:hidden">KingKush Sale</span>
            <div className="hidden md:block">
              <p className="text-sm font-bold text-gray-900">Welcome back, {user?.displayName || user?.username}</p>
              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">{user?.role}</p>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <button 
              onClick={() => logout()}
              className="flex items-center gap-2 px-4 py-2 text-red-600 hover:bg-red-50 rounded-xl font-bold transition-all text-sm border border-red-100"
            >
              <LogOut className="w-4 h-4" />
              <span className="hidden sm:inline">Logout</span>
            </button>
            <button onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)} className="p-2 md:hidden">
              {isMobileMenuOpen ? <X /> : <Menu />}
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-6 md:p-12 lg:p-16">
          {children}
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

    const unsubAuth = onAuthStateChanged(auth, async (authUser) => {
      if (!isMounted) {
        return;
      }

      if (!authUser) {
        setUser(null);
        setLoading(false);
        return;
      }

      try {
        const userDoc = await getDoc(doc(db, 'users', authUser.uid));
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
        setUser(null);
        setAuthError(error instanceof Error ? error.message : 'Failed to load user profile');
      } finally {
        setLoading(false);
      }
    });

    return () => {
      isMounted = false;
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

  const hasPermission = (permissionId: string) => {
    if (!user) return false;
    if (user.role === 'superadmin') return true;
    return user.permissions?.includes(permissionId);
  };

  const getDefaultAuthorizedPath = () => {
    if (!user) return '/login';
    if (user.role === 'superadmin') return '/';

    const routePriority: Array<{ permission: string; path: string }> = [
      { permission: 'dashboard', path: '/' },
      { permission: 'pos', path: '/pos' },
      { permission: 'shifts', path: '/cash-shifts' },
      { permission: 'credits', path: '/credits' },
      { permission: 'products', path: '/products' },
      { permission: 'inventory', path: '/inventory' },
      { permission: 'branches', path: '/branches' },
      { permission: 'labels', path: '/labels' },
      { permission: 'reports', path: '/reports' },
      { permission: 'expenses', path: '/expenses' },
      { permission: 'users', path: '/users' },
      { permission: 'audit-logs', path: '/audit-logs' },
      { permission: 'settings', path: '/settings' },
      { permission: 'status', path: '/status' }
    ];

    const firstAllowed = routePriority.find((route) => hasPermission(route.permission));
    return firstAllowed?.path ?? null;
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

  if (authError) {
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
                  <Route path="/" element={hasPermission('dashboard') ? <Dashboard /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/pos" element={hasPermission('pos') ? <POS /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/sales-history" element={hasPermission('pos') ? <SalesHistory /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/cash-shifts" element={hasPermission('shifts') || hasPermission('pos') ? <CashShifts /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/customers" element={hasPermission('pos') ? <Customers /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/credits" element={hasPermission('credits') ? <Credits /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/products" element={hasPermission('products') ? <Products /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/categories" element={hasPermission('products') ? <Categories /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/inventory" element={hasPermission('inventory') ? <Inventory /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/purchase-orders" element={hasPermission('inventory') ? <PurchaseOrders /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/suppliers" element={hasPermission('inventory') ? <Suppliers /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/branches" element={hasPermission('branches') ? <Branches /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/labels" element={hasPermission('labels') ? <Labels /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/users" element={hasPermission('users') ? <Users /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/audit-logs" element={hasPermission('audit-logs') ? <AuditLogs /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/expenses" element={hasPermission('expenses') ? <Expenses /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/reports" element={hasPermission('reports') ? <Reports /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/settings" element={hasPermission('settings') ? <Settings /> : <Navigate to={defaultAuthorizedPath} replace />} />
                  <Route path="/status" element={hasPermission('status') ? <ReadinessPanel /> : <Navigate to={defaultAuthorizedPath} replace />} />
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
