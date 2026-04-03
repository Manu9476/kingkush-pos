import { useState, useEffect } from 'react';
import { 
  db, 
  collection, 
  query, 
  orderBy, 
  onSnapshot, 
  limit,
  handleFirestoreError,
  OperationType
} from '../data';
import { AuditLog } from '../types';
import { 
  Search, 
  Clock, 
  Activity,
  Download,
  Printer,
  X
} from 'lucide-react';

export default function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [, setIsPrinting] = useState(false);
  const [printType, setPrintType] = useState<'a4' | 'thermal' | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const downloadLog = (log: AuditLog) => {
    const content = `
SYSTEM AUDIT LOG REPORT
-----------------------
Log ID: ${log.id}
Timestamp: ${log.timestamp && typeof log.timestamp === 'object' && 'toDate' in log.timestamp ? new Date(log.timestamp.toDate()).toLocaleString() : typeof log.timestamp === 'string' ? new Date(log.timestamp).toLocaleString() : 'N/A'}
User: ${log.userName} (ID: ${log.userId})
Action: ${log.action}
Details: ${log.details}
-----------------------
Generated on: ${new Date().toLocaleString()}
    `.trim();

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `audit_log_${log.id.slice(-8)}_${new Date().getTime()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const printLog = (type: 'a4' | 'thermal') => {
    setPrintType(type);
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
      setPrintType(null);
    }, 500);
  };

  useEffect(() => {
    const q = query(collection(db, 'audit_logs'), orderBy('timestamp', 'desc'), limit(100));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const logsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as AuditLog));
      setLogs(logsData);
      setLoading(false);
    }, (err) => handleFirestoreError(err, OperationType.LIST, 'audit_logs'));
    return () => unsubscribe();
  }, []);

  const filteredLogs = logs.filter(l => {
    const query = searchQuery.toLowerCase();
    return (
      (l.userName?.toLowerCase() || '').includes(query) ||
      (l.action?.toLowerCase() || '').includes(query) ||
      (l.details?.toLowerCase() || '').includes(query)
    );
  });

  const getActionColor = (action: string) => {
    if (action.includes('DELETE')) return 'bg-red-100 text-red-600';
    if (action.includes('UPDATE')) return 'bg-amber-100 text-amber-600';
    if (action.includes('CREATE')) return 'bg-green-100 text-green-600';
    if (action.includes('REFUND')) return 'bg-purple-100 text-purple-600';
    return 'bg-blue-100 text-blue-600';
  };

  return (
    <div className="route-workspace space-y-6">
      <div className="route-header flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">System Audit Logs</h1>
          <p className="text-gray-500 font-medium">Track all administrative and critical actions</p>
        </div>
      </div>

      <div className="route-body desktop-scroll pr-1 custom-scrollbar">
      <div className="desktop-card bg-white rounded-3xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-6 border-b border-gray-100 flex flex-col md:flex-row gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
            <input 
              type="text"
              placeholder="Search logs by user, action, or details..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
            />
          </div>
        </div>

        <div className="desktop-table-scroll overflow-x-auto max-h-150 overflow-y-auto pr-2 custom-scrollbar">
          <table className="w-full text-left border-collapse">
            <thead className="sticky top-0 bg-white z-10 shadow-sm">
              <tr className="bg-gray-50/50">
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Timestamp</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">User</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Action</th>
                <th className="px-6 py-4 text-[10px] font-bold text-gray-400 uppercase tracking-widest">Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center">
                    <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto" />
                  </td>
                </tr>
              ) : filteredLogs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center text-gray-500">No logs found</td>
                </tr>
              ) : filteredLogs.map((log) => (
                <tr 
                  key={log.id} 
                  onClick={() => setSelectedLog(log)}
                  className="hover:bg-gray-50/50 transition-colors group cursor-pointer"
                >
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-gray-100 rounded-xl text-gray-400 group-hover:bg-white group-hover:shadow-sm transition-all">
                        <Clock className="w-4 h-4" />
                      </div>
                      <div>
                        <div className="text-sm font-bold text-gray-900">
                          {log.timestamp && typeof log.timestamp === 'object' && 'toDate' in log.timestamp ? log.timestamp.toDate().toLocaleDateString() : typeof log.timestamp === 'string' ? new Date(log.timestamp).toLocaleDateString() : 'Just now'}
                        </div>
                        <div className="text-[10px] text-gray-400 font-medium">
                          {log.timestamp && typeof log.timestamp === 'object' && 'toDate' in log.timestamp ? log.timestamp.toDate().toLocaleTimeString() : typeof log.timestamp === 'string' ? new Date(log.timestamp).toLocaleTimeString() : ''}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-full flex items-center justify-center text-xs font-bold">
                        {(log.userName || 'U').charAt(0).toUpperCase()}
                      </div>
                      <span className="text-sm font-bold text-gray-900">{log.userName || 'Unknown User'}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider ${getActionColor(log.action || '')}`}>
                      {(log.action || 'UNKNOWN').replace(/_/g, ' ')}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center justify-between gap-4">
                      <p className="text-sm text-gray-600 font-medium max-w-md truncate" title={log.details}>
                        {log.details}
                      </p>
                      <button 
                        onClick={(e) => {
                          e.stopPropagation();
                          downloadLog(log);
                        }}
                        className="p-2 text-gray-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-xl transition-all opacity-0 group-hover:opacity-100"
                        title="Download Report"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      </div>

      {/* Log Details Modal */}
      {selectedLog && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-[2.5rem] w-full max-w-2xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-6 bg-indigo-600 text-white flex justify-between items-center shrink-0">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-xl">
                  <Activity className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-lg">Log Details</h3>
                  <p className="text-indigo-100 text-xs">ID: {selectedLog.id}</p>
                </div>
              </div>
              <button onClick={() => setSelectedLog(null)} className="p-2 hover:bg-white/20 rounded-xl transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-8 space-y-8">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Timestamp</p>
                  <p className="text-sm font-bold text-gray-900">
                    {selectedLog.timestamp && typeof selectedLog.timestamp === 'object' && 'toDate' in selectedLog.timestamp ? selectedLog.timestamp.toDate().toLocaleString() : typeof selectedLog.timestamp === 'string' ? new Date(selectedLog.timestamp).toLocaleString() : 'N/A'}
                  </p>
                </div>
                <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">User</p>
                  <p className="text-sm font-bold text-gray-900">{selectedLog.userName}</p>
                  <p className="text-[10px] text-gray-500 font-medium">User ID: {selectedLog.userId}</p>
                </div>
                <div className="bg-gray-50 p-6 rounded-3xl border border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-1">Action Type</p>
                  <span className={`inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mt-1 ${getActionColor(selectedLog.action || '')}`}>
                    {(selectedLog.action || 'UNKNOWN').replace(/_/g, ' ')}
                  </span>
                </div>
              </div>

              <div className="bg-gray-50 p-8 rounded-4xl border border-gray-100">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Detailed Description</h4>
                <p className="text-gray-700 font-medium leading-relaxed whitespace-pre-wrap">
                  {selectedLog.details}
                </p>
              </div>

              <div className="flex flex-wrap gap-4">
                <button 
                  onClick={() => printLog('a4')}
                  className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-bold shadow-lg shadow-indigo-100 hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                >
                  <Printer className="w-5 h-5" />
                  Print A4 Report
                </button>
                <button 
                  onClick={() => printLog('thermal')}
                  className="flex-1 py-4 bg-gray-900 text-white rounded-2xl font-bold shadow-lg shadow-gray-100 hover:bg-black transition-all flex items-center justify-center gap-2"
                >
                  <Printer className="w-5 h-5" />
                  Thermal Print
                </button>
                <button 
                  onClick={() => downloadLog(selectedLog)}
                  className="flex-1 py-4 bg-gray-100 text-gray-600 rounded-2xl font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2"
                >
                  <Download className="w-5 h-5" />
                  Download TXT
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Print Templates */}
      <div className="hidden print:block">
        {selectedLog && printType === 'a4' && (
          <div id="audit-report-a4" className="p-12 font-sans text-gray-900 max-w-4xl mx-auto border-4 border-double border-gray-200 bg-white">
            <div className="text-center mb-12 border-b-2 border-gray-900 pb-8">
              <h1 className="text-4xl font-black uppercase tracking-tighter mb-2">System Audit Report</h1>
              <p className="text-gray-500 font-bold tracking-widest uppercase text-sm">KingKush Supermarket Management System</p>
            </div>

            <div className="grid grid-cols-2 gap-12 mb-12">
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Log ID</p>
                  <p className="text-lg font-mono font-bold">{selectedLog.id}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Timestamp</p>
                  <p className="text-lg font-bold">{selectedLog.timestamp && typeof selectedLog.timestamp === 'object' && 'toDate' in selectedLog.timestamp ? selectedLog.timestamp.toDate().toLocaleString() : typeof selectedLog.timestamp === 'string' ? new Date(selectedLog.timestamp).toLocaleString() : 'N/A'}</p>
                </div>
              </div>
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">User Responsible</p>
                  <p className="text-lg font-bold">{selectedLog.userName}</p>
                  <p className="text-sm text-gray-500">ID: {selectedLog.userId}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">Action Performed</p>
                  <p className="text-lg font-black text-indigo-600 uppercase">{(selectedLog.action || 'UNKNOWN').replace(/_/g, ' ')}</p>
                </div>
              </div>
            </div>

            <div className="bg-gray-50 p-8 rounded-3xl border-2 border-gray-100 mb-12">
              <h2 className="text-sm font-bold text-gray-400 uppercase tracking-widest mb-4">Activity Details</h2>
              <p className="text-xl font-medium leading-relaxed text-gray-800 italic">
                "{selectedLog.details}"
              </p>
            </div>

            <div className="mt-24 pt-8 border-t border-gray-200 flex justify-between items-end">
              <div className="text-left">
                <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-8">System Verification</p>
                <div className="w-48 h-px bg-gray-900 mb-2"></div>
                <p className="text-xs font-bold uppercase tracking-widest">Authorized Signature</p>
              </div>
              <div className="text-right text-gray-400 text-[10px] font-bold uppercase tracking-widest">
                <p>Generated on: {new Date().toLocaleString()}</p>
                <p>Noxira Labs Security Protocol</p>
              </div>
            </div>
          </div>
        )}

        {selectedLog && printType === 'thermal' && (
          <div id="audit-report-thermal" className="p-4 font-mono text-[12px] leading-tight w-[80mm] bg-white">
            <div className="text-center mb-4">
              <h1 className="font-bold text-lg uppercase">AUDIT LOG REPORT</h1>
              <p>********************************</p>
            </div>
            
            <div className="space-y-2 mb-4">
              <p>ID: {selectedLog.id.slice(-12).toUpperCase()}</p>
              <p>DATE: {selectedLog.timestamp && typeof selectedLog.timestamp === 'object' && 'toDate' in selectedLog.timestamp ? selectedLog.timestamp.toDate().toLocaleDateString() : typeof selectedLog.timestamp === 'string' ? new Date(selectedLog.timestamp).toLocaleDateString() : 'N/A'}</p>
              <p>TIME: {selectedLog.timestamp && typeof selectedLog.timestamp === 'object' && 'toDate' in selectedLog.timestamp ? selectedLog.timestamp.toDate().toLocaleTimeString() : typeof selectedLog.timestamp === 'string' ? new Date(selectedLog.timestamp).toLocaleTimeString() : 'N/A'}</p>
              <p>USER: {(selectedLog.userName || 'Unknown').toUpperCase()}</p>
              <p>ACTION: {(selectedLog.action || 'Unknown').toUpperCase()}</p>
              <p>********************************</p>
            </div>

            <div className="mb-4">
              <p className="font-bold mb-1">DETAILS:</p>
              <p className="italic">{selectedLog.details}</p>
            </div>

            <div className="text-center border-t border-dashed border-gray-300 pt-4 mt-4">
              <p>SYSTEM SECURITY LOG</p>
              <p className="text-[10px] mt-1">{new Date().toLocaleString()}</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
