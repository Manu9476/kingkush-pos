import { useEffect, useState } from 'react';
import {
  Shield,
  CheckCircle,
  XCircle,
  AlertTriangle,
  RefreshCw,
  Activity,
  Wrench,
  FileCode2,
  Boxes,
  Database
} from 'lucide-react';

import { getSystemStatusReport, type SystemStatusReport } from '../services/platformApi';

function severityClasses(severity: 'critical' | 'warning' | 'info') {
  if (severity === 'critical') {
    return 'border-red-200 bg-red-50 text-red-700';
  }
  if (severity === 'warning') {
    return 'border-amber-200 bg-amber-50 text-amber-700';
  }
  return 'border-blue-200 bg-blue-50 text-blue-700';
}

function moduleStatusClasses(status: 'ok' | 'warning' | 'error') {
  if (status === 'error') {
    return 'border-red-200 bg-red-50';
  }
  if (status === 'warning') {
    return 'border-amber-200 bg-amber-50';
  }
  return 'border-emerald-200 bg-emerald-50';
}

export default function ReadinessPanel() {
  const [report, setReport] = useState<SystemStatusReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadReport = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const payload = await getSystemStatusReport();
      setReport(payload);
    } catch (err: any) {
      setError(err.message || 'Unable to load system report');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadReport();
  }, []);

  return (
    <div className="bg-white rounded-3xl shadow-xl border border-gray-100 overflow-hidden">
      <div className="p-6 border-b border-gray-50 flex items-center justify-between bg-indigo-50/30">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center text-white">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-gray-900">System Status</h2>
            <p className="text-xs text-gray-500">Live health, detected issues, history counts and component responsibilities</p>
          </div>
        </div>
        <button
          onClick={() => void loadReport()}
          className="p-2 hover:bg-indigo-100 rounded-lg transition-colors text-indigo-600"
          title="Refresh Report"
        >
          <RefreshCw className={`w-5 h-5 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      <div className="p-6 space-y-6">
        {error && (
          <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-medium text-red-700">
            {error}
          </div>
        )}

        {isLoading && !report ? (
          <div className="flex items-center gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-6 text-sm text-gray-500">
            <RefreshCw className="w-5 h-5 animate-spin text-indigo-500" />
            Generating deep system report...
          </div>
        ) : null}

        {report && (
          <>
            <section className="space-y-4">
              <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
                <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-red-600">Critical Issues</p>
                  <p className="mt-2 text-2xl font-black text-red-700">{report.issueSummary.critical}</p>
                  <p className="mt-1 text-xs text-red-600">Must be fixed before trusting the affected workflow.</p>
                </div>
                <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-amber-600">Warnings</p>
                  <p className="mt-2 text-2xl font-black text-amber-700">{report.issueSummary.warning}</p>
                  <p className="mt-1 text-xs text-amber-700">Operational gaps that can become user-facing problems.</p>
                </div>
                <div className="rounded-2xl border border-blue-100 bg-blue-50 px-4 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-blue-600">Info Notices</p>
                  <p className="mt-2 text-2xl font-black text-blue-700">{report.issueSummary.info}</p>
                  <p className="mt-1 text-xs text-blue-700">Helpful setup improvements and readiness hints.</p>
                </div>
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50 px-4 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-indigo-600">Modules Checked</p>
                  <p className="mt-2 text-2xl font-black text-indigo-700">{report.moduleHealth.length}</p>
                  <p className="mt-1 text-xs text-indigo-700">Every major screen is now included in the diagnostic sweep.</p>
                </div>
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600">
                <Activity className="w-4 h-4" />
                Service Health
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {report.services.map((service) => (
                  <div key={service.id} className="flex items-start gap-4 p-4 rounded-2xl bg-gray-50 border border-gray-100">
                    <div className="mt-1">
                      {service.status === 'ok' && <CheckCircle className="w-5 h-5 text-green-500" />}
                      {service.status === 'error' && <XCircle className="w-5 h-5 text-red-500" />}
                      {service.status === 'warning' && <AlertTriangle className="w-5 h-5 text-amber-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-bold text-gray-900">{service.label}</h3>
                      <p className="text-xs text-gray-500 mt-0.5">{service.message}</p>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600">
                <Boxes className="w-4 h-4" />
                Module Health
              </div>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                {report.moduleHealth.map((module) => (
                  <div key={module.id} className={`rounded-2xl border px-4 py-4 ${moduleStatusClasses(module.status)}`}>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="flex items-center gap-3">
                        {module.status === 'ok' && <CheckCircle className="h-5 w-5 text-emerald-500" />}
                        {module.status === 'warning' && <AlertTriangle className="h-5 w-5 text-amber-500" />}
                        {module.status === 'error' && <XCircle className="h-5 w-5 text-red-500" />}
                        <div>
                          <h3 className="text-sm font-bold text-gray-900">{module.label}</h3>
                          <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500">
                            {module.issueCount > 0 ? `${module.issueCount} issue${module.issueCount === 1 ? '' : 's'} detected` : 'Healthy'}
                          </p>
                        </div>
                      </div>
                      <span className="rounded-full bg-white/80 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-gray-600">
                        {module.status}
                      </span>
                    </div>

                    <p className="mt-3 text-sm text-gray-700">{module.summary}</p>
                    <p className="mt-3 text-xs text-gray-500">{module.functionality}</p>

                    {module.fix && (
                      <div className="mt-3 rounded-xl bg-white/70 px-3 py-3 text-xs font-medium text-gray-700">
                        Fix: {module.fix}
                      </div>
                    )}

                    <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold text-indigo-600">
                      <span>Route: {module.route}</span>
                      <span>Permission: {module.permission}</span>
                      <span>File: {module.file}</span>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600">
                <Wrench className="w-4 h-4" />
                Detected Issues
              </div>
              {report.issues.length === 0 ? (
                <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-4 text-sm font-medium text-emerald-700">
                  No live configuration issues were detected in the current system snapshot.
                </div>
              ) : (
                <div className="space-y-4">
                  {report.issues.map((issue) => (
                    <div key={issue.id} className={`rounded-2xl border px-4 py-4 ${severityClasses(issue.severity)}`}>
                      <div className="flex flex-wrap items-center gap-3">
                        <h3 className="text-sm font-bold">{issue.title}</h3>
                        <span className="rounded-full bg-white/80 px-3 py-1 text-[10px] font-bold uppercase tracking-wider">
                          {issue.severity}
                        </span>
                      </div>
                      <p className="mt-2 text-sm">{issue.summary}</p>
                      <p className="mt-2 text-sm font-medium">Fix: {issue.fix}</p>
                      <div className="mt-3 flex flex-wrap gap-3 text-xs font-semibold">
                        {issue.route && <span>Route: {issue.route}</span>}
                        {issue.file && <span>File: {issue.file}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600">
                <Database className="w-4 h-4" />
                Data Footprint
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-6 gap-3">
                {Object.entries(report.counts).map(([key, value]) => (
                  <div key={key} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
                      {key.replace(/([A-Z])/g, ' $1').trim()}
                    </p>
                    <p className="mt-2 text-lg font-black text-gray-900">{value.toLocaleString()}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="space-y-4">
              <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-indigo-600">
                <Boxes className="w-4 h-4" />
                Component Directory
              </div>
              <div className="space-y-3">
                {report.components.map((component) => (
                  <div key={component.id} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-4">
                    <div className="flex flex-col gap-2 md:flex-row md:items-start md:justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-gray-900">{component.label}</h3>
                        <p className="mt-1 text-sm text-gray-600">{component.functionality}</p>
                      </div>
                      <div className="text-xs font-semibold text-gray-500 md:text-right">
                        <p>Route: {component.route}</p>
                        <p>Permission: {component.permission}</p>
                      </div>
                    </div>
                    <div className="mt-3 flex items-center gap-2 text-xs font-semibold text-indigo-600">
                      <FileCode2 className="w-4 h-4" />
                      {component.file}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}
      </div>
    </div>
  );
}
