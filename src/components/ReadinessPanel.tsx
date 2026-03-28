import React, { useState, useEffect } from 'react';
import { db, auth, doc, getDoc, setDoc, OperationType, handleFirestoreError } from '../data';
import { Shield, CheckCircle, XCircle, AlertTriangle, RefreshCw, Activity } from 'lucide-react';

interface HealthStatus {
  service: string;
  status: 'loading' | 'ok' | 'error' | 'warning';
  message: string;
}

export default function ReadinessPanel() {
  const [statuses, setStatuses] = useState<HealthStatus[]>([
    { service: 'Auth Service', status: 'loading', message: 'Checking...' },
    { service: 'Data Layer Connection', status: 'loading', message: 'Checking...' },
    { service: 'Security Rules', status: 'loading', message: 'Checking...' },
    { service: 'User Profile', status: 'loading', message: 'Checking...' },
  ]);

  const checkHealth = async () => {
    setStatuses(s => s.map(item => ({ ...item, status: 'loading', message: 'Checking...' })));

    // 1. Check Auth
    const authStatus: HealthStatus = { service: 'Auth Service', status: 'ok', message: 'Auth initialized' };
    if (!auth) {
      authStatus.status = 'error';
      authStatus.message = 'Auth not initialized';
    } else {
      authStatus.message = auth.currentUser ? `Logged in as ${auth.currentUser.email}` : 'Not logged in';
    }

    // 2. Check data layer read path
    let firestoreStatus: HealthStatus = { service: 'Data Layer Connection', status: 'loading', message: 'Testing read...' };
    try {
      // Try to read a document that should exist or at least test connection
      await getDoc(doc(db, '_health_check_', 'ping'));
      firestoreStatus = { service: 'Data Layer Connection', status: 'ok', message: 'Data layer reachable' };
    } catch (err: any) {
      console.error('Data layer health check failed:', err);
      const msg = (err.message || '').toLowerCase();
      const code = (err.code || '').toLowerCase();
      if (msg.includes('offline') || code.includes('offline')) {
        firestoreStatus = { service: 'Data Layer Connection', status: 'error', message: 'Client is offline. Check internet.' };
      } else if (msg.includes('permission') || msg.includes('insufficient') || code.includes('permission')) {
        firestoreStatus = { service: 'Data Layer Connection', status: 'ok', message: 'Connected (Permission denied as expected)' };
      } else {
        firestoreStatus = { service: 'Data Layer Connection', status: 'error', message: err.message || 'Connection failed' };
      }
    }

    // 3. Check Security Rules (Write test)
    let rulesStatus: HealthStatus = { service: 'Security Rules', status: 'loading', message: 'Testing write...' };
    try {
      // Try to write to a path that should be forbidden
      await setDoc(doc(db, '_forbidden_test_', 'test'), { data: 'test' });
      rulesStatus = { service: 'Security Rules', status: 'warning', message: 'Rules might be too open (Write allowed to forbidden path)' };
    } catch (err: any) {
      console.error('Rules write test failed:', err);
      const msg = (err.message || '').toLowerCase();
      const code = (err.code || '').toLowerCase();
      if (msg.includes('permission') || msg.includes('insufficient') || code.includes('permission')) {
        rulesStatus = { service: 'Security Rules', status: 'ok', message: 'Rules active (Write blocked as expected)' };
      } else {
        rulesStatus = { service: 'Security Rules', status: 'error', message: 'Could not verify rules: ' + (err.message || 'Unknown error') };
      }
    }

    // 4. User Profile
    let profileStatus: HealthStatus = { service: 'User Profile', status: 'ok', message: 'N/A' };
    if (auth.currentUser) {
      try {
        const userDoc = await getDoc(doc(db, 'users', auth.currentUser.uid));
        if (userDoc.exists()) {
          profileStatus = { service: 'User Profile', status: 'ok', message: 'Profile found in data layer' };
        } else {
          profileStatus = { service: 'User Profile', status: 'warning', message: 'Profile document missing' };
        }
      } catch (err: any) {
        profileStatus = { service: 'User Profile', status: 'error', message: 'Failed to fetch profile' };
      }
    } else {
      profileStatus = { service: 'User Profile', status: 'ok', message: 'Login required for profile check' };
    }

    setStatuses([authStatus, firestoreStatus, rulesStatus, profileStatus]);
  };

  useEffect(() => {
    checkHealth();
  }, []);

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
      <div className="p-6 border-b border-gray-50 flex items-center justify-between bg-indigo-50/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">Readiness & Security Panel</h2>
            <p className="text-xs text-gray-500">System health and vulnerability check</p>
          </div>
        </div>
        <button 
          onClick={checkHealth}
          className="p-2 hover:bg-indigo-100 rounded-lg transition-colors text-indigo-600"
          title="Refresh Checks"
        >
          <RefreshCw className="w-5 h-5" />
        </button>
      </div>

      <div className="p-6 space-y-4">
        {statuses.map((item, index) => (
          <div key={index} className="flex items-start gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100">
            <div className="mt-1">
              {item.status === 'loading' && <RefreshCw className="w-5 h-5 text-indigo-500 animate-spin" />}
              {item.status === 'ok' && <CheckCircle className="w-5 h-5 text-green-500" />}
              {item.status === 'error' && <XCircle className="w-5 h-5 text-red-500" />}
              {item.status === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-gray-900">{item.service}</h3>
              <p className="text-xs text-gray-500 mt-0.5 break-all">{item.message}</p>
            </div>
          </div>
        ))}
      </div>

      <div className="p-6 bg-gray-50 border-t border-gray-100">
        <div className="flex items-center gap-2 text-xs font-bold text-indigo-600 uppercase tracking-wider mb-3">
          <Activity className="w-4 h-4" />
          Security Recommendations
        </div>
        <ul className="text-xs text-gray-600 space-y-2 list-disc pl-4">
          <li>Ensure access control checks remain enforced in the data layer.</li>
          <li>Use the "Google Account" login for maximum security.</li>
          <li>Regularly check the "Reports" section for suspicious activity.</li>
          <li>Keep your admin password unique and complex.</li>
        </ul>
      </div>
    </div>
  );
}
