import { useEffect, useMemo, useState } from 'react';
import {
  db,
  collection,
  onSnapshot,
  query,
  orderBy,
  where,
  toDate,
  handleFirestoreError,
  OperationType
} from '../data';
import type { Branch, CashMovement, CashShift } from '../types';
import {
  closeShift,
  getShiftReport,
  getShiftStatus,
  openShift,
  recordCashMovement
} from '../services/platformApi';
import { Banknote, Clock3, LockOpen, Lock, ArrowDownUp, ShieldCheck, Printer } from 'lucide-react';
import { toast } from 'sonner';
import { useAuth } from '../App';
import { formatShiftReportNumber } from '../utils/receipts';

type LiveShiftSummary = {
  shiftId: string;
  branchId: string | null;
  openingFloat: number;
  cashSales: number;
  cashCreditPayments: number;
  manualCashIn: number;
  manualCashOut: number;
  expectedCash: number;
  countedCash: number | null;
  variance: number | null;
} | null;

type ShiftReport = {
  generatedAt: string;
  shift: CashShift & {
    branchName?: string;
  };
  summary: NonNullable<LiveShiftSummary>;
  totals: {
    saleCount: number;
    creditSaleCount: number;
    refundedSaleCount: number;
    totalSales: number;
    totalCollected: number;
    totalOutstanding: number;
    totalRefundAmount: number;
    creditPaymentCount: number;
    totalCreditPayments: number;
  };
  movements: CashMovement[];
  sales: Array<{
    id: string;
    totalAmount: number;
    amountPaid: number;
    collectedAmount: number;
    outstandingBalance: number;
    paymentMethod: string;
    tenderMethod?: string | null;
    customerName?: string | null;
    isCredit: boolean;
    isRefunded: boolean;
    refundAmount: number;
    soldAt: string;
  }>;
  creditPayments: Array<{
    id: string;
    saleId: string;
    amountPaid: number;
    remainingBalance: number;
    paymentMethod: string;
    reference?: string | null;
    cashierName: string;
    paidAt: string;
  }>;
};

const CASH_MOVEMENT_TYPES = [
  { id: 'cash-in', label: 'Cash In' },
  { id: 'cash-out', label: 'Cash Out' },
  { id: 'float-add', label: 'Add Float' },
  { id: 'safe-drop', label: 'Safe Drop' }
] as const;

const SHIFT_STATUS_POLL_INTERVAL_MS = 30000;

function formatMoneyInput(amount: number) {
  if (!Number.isFinite(amount)) {
    return '0';
  }

  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}

export default function CashShifts() {
  const { user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [recentShifts, setRecentShifts] = useState<CashShift[]>([]);
  const [currentShift, setCurrentShift] = useState<CashShift | null>(null);
  const [liveSummary, setLiveSummary] = useState<LiveShiftSummary>(null);
  const [movements, setMovements] = useState<CashMovement[]>([]);
  const [selectedReport, setSelectedReport] = useState<ShiftReport | null>(null);
  const [isLoadingReport, setIsLoadingReport] = useState(false);

  const [openForm, setOpenForm] = useState({
    openingFloat: '0',
    notes: '',
    openingReference: ''
  });
  const [movementForm, setMovementForm] = useState({
    type: 'cash-out' as 'cash-in' | 'cash-out' | 'float-add' | 'safe-drop',
    amount: '',
    reason: '',
    reference: ''
  });
  const [closeForm, setCloseForm] = useState({
    closingCountedCash: '',
    notes: ''
  });

  const [isOpening, setIsOpening] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const [isRecordingMovement, setIsRecordingMovement] = useState(false);
  const canGenerateReports = Boolean(
    user?.role === 'superadmin' ||
    user?.role === 'admin' ||
    user?.permissions?.includes('reports')
  );
  const assignedBranchName = useMemo(() => {
    if (!user?.branchId) {
      return 'system default branch';
    }

    return branches.find((branch) => branch.id === user.branchId)?.name || user.branchId;
  }, [branches, user?.branchId]);

  const refreshShiftStatus = async () => {
    try {
      const payload = await getShiftStatus();
      setCurrentShift(payload.shift);
      setLiveSummary(payload.summary);
      setCloseForm((current) => {
        if (!payload.summary || current.closingCountedCash.trim() !== '') {
          return current;
        }

        return {
          ...current,
          closingCountedCash: formatMoneyInput(payload.summary.expectedCash)
        };
      });
    } catch (error: any) {
      if (error?.message?.includes('Authentication')) {
        return;
      }
      toast.error(error.message || 'Unable to load shift status');
    }
  };

  useEffect(() => {
    void refreshShiftStatus();
    const intervalId = window.setInterval(() => {
      void refreshShiftStatus();
    }, SHIFT_STATUS_POLL_INTERVAL_MS);
    const handleExternalRefresh = () => {
      void refreshShiftStatus();
    };

    window.addEventListener('focus', handleExternalRefresh);
    window.addEventListener('kingkush:data-mutated', handleExternalRefresh as EventListener);

    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleExternalRefresh);
      window.removeEventListener('kingkush:data-mutated', handleExternalRefresh as EventListener);
    };
  }, []);

  useEffect(() => {
    const unsubBranches = onSnapshot(
      collection(db, 'branches'),
      (snapshot) => {
        setBranches(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Branch)));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'branches')
    );

    const unsubShifts = onSnapshot(
      query(collection(db, 'cash_shifts'), orderBy('openedAt', 'desc')),
      (snapshot) => {
        setRecentShifts(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as CashShift)).slice(0, 20));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'cash_shifts')
    );

    return () => {
      unsubBranches();
      unsubShifts();
    };
  }, []);

  useEffect(() => {
    if (!currentShift?.id) {
      setMovements([]);
      return;
    }

    const unsubMovements = onSnapshot(
      query(collection(db, 'cash_movements'), where('shiftId', '==', currentShift.id), orderBy('timestamp', 'desc')),
      (snapshot) => {
        setMovements(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as CashMovement)));
      },
      (error) => handleFirestoreError(error, OperationType.LIST, 'cash_movements')
    );

    return () => unsubMovements();
  }, [currentShift?.id]);

  const currentBranchName = useMemo(() => {
    if (!currentShift?.branchId) {
      return 'Unassigned branch';
    }
    return branches.find((branch) => branch.id === currentShift.branchId)?.name || currentShift.branchId;
  }, [branches, currentShift?.branchId]);

  const handleLoadReport = async (shiftId: string, printAfterLoad = false) => {
    setIsLoadingReport(true);
    try {
      const report = await getShiftReport(shiftId);
      setSelectedReport(report as ShiftReport);
      if (printAfterLoad) {
        window.setTimeout(() => {
          window.print();
        }, 250);
      }
    } catch (error: any) {
      toast.error(error.message || 'Unable to load shift report');
    } finally {
      setIsLoadingReport(false);
    }
  };

  const handleOpenShift = async (event: React.FormEvent) => {
    event.preventDefault();
    const openingFloat = Number(openForm.openingFloat || 0);
    if (!Number.isFinite(openingFloat) || openingFloat < 0) {
      toast.error('Enter a valid opening float before opening the shift.');
      return;
    }

    setIsOpening(true);
    try {
      const payload = await openShift({
        openingFloat,
        notes: openForm.notes.trim(),
        openingReference: openForm.openingReference.trim()
      });
      setCurrentShift(payload.shift as CashShift);
      setLiveSummary(payload.summary as LiveShiftSummary);
      setCloseForm({
        closingCountedCash: formatMoneyInput(Number(payload.summary?.expectedCash ?? openingFloat)),
        notes: ''
      });
      setSelectedReport(null);
      toast.success('Cashier shift opened');
      setOpenForm({ openingFloat: '0', notes: '', openingReference: '' });
      void refreshShiftStatus();
    } catch (error: any) {
      toast.error(error.message || 'Unable to open shift');
    } finally {
      setIsOpening(false);
    }
  };

  const handleRecordMovement = async (event: React.FormEvent) => {
    event.preventDefault();
    const amount = Number(movementForm.amount || 0);
    const reason = movementForm.reason.trim();
    if (!Number.isFinite(amount) || amount <= 0 || !reason) {
      toast.error('Enter a positive amount and a reason before recording the movement.');
      return;
    }

    setIsRecordingMovement(true);
    try {
      await recordCashMovement({
        type: movementForm.type,
        amount,
        reason,
        reference: movementForm.reference.trim()
      });
      toast.success('Cash movement recorded');
      setMovementForm({
        type: 'cash-out',
        amount: '',
        reason: '',
        reference: ''
      });
      void refreshShiftStatus();
    } catch (error: any) {
      toast.error(error.message || 'Unable to record movement');
    } finally {
      setIsRecordingMovement(false);
    }
  };

  const handleCloseShift = async (event: React.FormEvent) => {
    event.preventDefault();
    const closingCountedCash = Number(closeForm.closingCountedCash || 0);
    if (!Number.isFinite(closingCountedCash) || closingCountedCash < 0) {
      toast.error('Enter a valid counted cash amount before closing the shift.');
      return;
    }

    setIsClosing(true);
    try {
      await closeShift({
        closingCountedCash,
        notes: closeForm.notes.trim()
      });
      setCurrentShift(null);
      setLiveSummary(null);
      setMovements([]);
      setSelectedReport(null);
      toast.success('Cashier shift closed');
      setCloseForm({ closingCountedCash: '', notes: '' });
      void refreshShiftStatus();
    } catch (error: any) {
      toast.error(error.message || 'Unable to close shift');
    } finally {
      setIsClosing(false);
    }
  };

  return (
    <div className="route-workspace space-y-8 max-w-7xl mx-auto">
      <div className="route-header flex flex-col gap-2">
        <h1 className="text-3xl font-bold text-gray-900">Cashier Shifts</h1>
        <p className="text-sm text-gray-500">Open tills, track cash movements, and close each shift with proper reconciliation.</p>
      </div>

      <div className="route-body desktop-scroll pr-1 custom-scrollbar">
      {!currentShift ? (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-8 py-6 border-b border-gray-50">
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <LockOpen className="h-6 w-6" />
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">Open a cashier shift</h2>
                <p className="text-sm text-gray-500">No active shift detected. Sales and cash reconciliation should start with an opening float.</p>
              </div>
            </div>
            <div className="mt-4 rounded-2xl bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-700">
              This shift will open under {assignedBranchName}.
            </div>
          </div>

          <form onSubmit={handleOpenShift} className="p-8 grid grid-cols-1 md:grid-cols-3 gap-5">
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Opening Float</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={openForm.openingFloat}
                onChange={(event) => setOpenForm((current) => ({ ...current, openingFloat: event.target.value }))}
                className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Reference</span>
              <input
                value={openForm.openingReference}
                onChange={(event) => setOpenForm((current) => ({ ...current, openingReference: event.target.value }))}
                placeholder="Float source or supervisor reference"
                className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
            </label>
            <label className="space-y-2">
              <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Opening Note</span>
              <input
                value={openForm.notes}
                onChange={(event) => setOpenForm((current) => ({ ...current, notes: event.target.value }))}
                placeholder="Optional note"
                className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
              />
            </label>
            <div className="md:col-span-3">
              <button
                type="submit"
                disabled={isOpening}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 font-bold text-white transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
              >
                <LockOpen className="h-4 w-4" />
                {isOpening ? 'Opening...' : 'Open Shift'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <>
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            <div className="px-8 py-6 border-b border-gray-50 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-5 w-5 text-emerald-600" />
                  <h2 className="text-xl font-bold text-gray-900">Active Shift</h2>
                </div>
                <p className="mt-1 text-sm text-gray-500">
                  {currentBranchName} | Opened {toDate(currentShift.openedAt).toLocaleString()}
                </p>
              </div>
              <div className="flex flex-col items-start gap-3 md:items-end">
                <div className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700">
                  Shift #{currentShift.id.slice(-8).toUpperCase()}
                </div>
                {canGenerateReports && (
                  <button
                    type="button"
                    onClick={() => void handleLoadReport(currentShift.id, true)}
                    disabled={isLoadingReport}
                    className="inline-flex items-center justify-center gap-2 rounded-2xl border border-indigo-200 px-4 py-2 text-sm font-bold text-indigo-700 transition-all hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Printer className="h-4 w-4" />
                    {isLoadingReport ? 'Preparing report...' : 'Print Shift Report'}
                  </button>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-5 gap-5 p-8">
              <MetricCard label="Opening Float" value={liveSummary?.openingFloat || 0} tone="indigo" />
              <MetricCard label="Cash Sales" value={liveSummary?.cashSales || 0} tone="emerald" />
              <MetricCard label="Credit Cash-In" value={liveSummary?.cashCreditPayments || 0} tone="blue" />
              <MetricCard label="Manual In" value={liveSummary?.manualCashIn || 0} tone="amber" />
              <MetricCard label="Manual Out" value={liveSummary?.manualCashOut || 0} tone="rose" />
            </div>

            <div className="px-8 pb-8">
              <div className="rounded-3xl bg-indigo-950 px-6 py-5 text-white">
                <p className="text-xs font-bold uppercase tracking-[0.25em] text-indigo-200">Expected Drawer Cash</p>
                <p className="mt-2 text-4xl font-black">KES {(liveSummary?.expectedCash || 0).toLocaleString()}</p>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-[0.98fr_1.02fr] gap-8">
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-8 py-6 border-b border-gray-50">
                <div className="flex items-center gap-3">
                  <ArrowDownUp className="h-5 w-5 text-indigo-600" />
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Cash Movements</h2>
                    <p className="text-sm text-gray-500">Record drops, extra float, and cash pulled from the till.</p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleRecordMovement} className="p-8 space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <label className="space-y-2">
                    <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Movement Type</span>
                    <select
                      value={movementForm.type}
                      onChange={(event) => setMovementForm((current) => ({ ...current, type: event.target.value as typeof movementForm.type }))}
                      className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                    >
                      {CASH_MOVEMENT_TYPES.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="space-y-2">
                    <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Amount</span>
                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={movementForm.amount}
                      onChange={(event) => setMovementForm((current) => ({ ...current, amount: event.target.value }))}
                      className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                    />
                  </label>
                </div>

                <label className="space-y-2 block">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Reason</span>
                  <input
                    value={movementForm.reason}
                    onChange={(event) => setMovementForm((current) => ({ ...current, reason: event.target.value }))}
                    placeholder="Why is cash moving in or out?"
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                  />
                </label>

                <label className="space-y-2 block">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Reference</span>
                  <input
                    value={movementForm.reference}
                    onChange={(event) => setMovementForm((current) => ({ ...current, reference: event.target.value }))}
                    placeholder="Optional voucher or approval reference"
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                  />
                </label>

                <button
                  type="submit"
                  disabled={isRecordingMovement}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-6 py-3 font-bold text-white transition-all hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Banknote className="h-4 w-4" />
                  {isRecordingMovement ? 'Recording...' : 'Record Movement'}
                </button>
              </form>

              <div className="border-t border-gray-50 px-8 py-6 space-y-3 max-h-[340px] overflow-y-auto">
                {movements.length === 0 ? (
                  <p className="text-sm text-gray-400">No cash movements recorded on this shift yet.</p>
                ) : (
                  movements.map((movement) => (
                    <div key={movement.id} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-bold text-gray-900">{movement.reason}</p>
                          <p className="text-xs text-gray-500">
                            {movement.type} | {toDate(movement.timestamp).toLocaleString()}
                          </p>
                        </div>
                        <p className="text-sm font-black text-gray-900">KES {movement.amount.toLocaleString()}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>

            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="px-8 py-6 border-b border-gray-50">
                <div className="flex items-center gap-3">
                  <Lock className="h-5 w-5 text-indigo-600" />
                  <div>
                    <h2 className="text-xl font-bold text-gray-900">Close Shift & Reconcile</h2>
                    <p className="text-sm text-gray-500">Count the drawer and compare it against expected system cash.</p>
                  </div>
                </div>
              </div>

              <form onSubmit={handleCloseShift} className="p-8 space-y-5">
                <div className="rounded-3xl bg-gray-50 p-5 border border-gray-100">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-gray-500">Expected Cash</p>
                  <p className="mt-2 text-3xl font-black text-gray-900">KES {(liveSummary?.expectedCash || 0).toLocaleString()}</p>
                </div>

                <label className="space-y-2 block">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Counted Cash in Drawer</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={closeForm.closingCountedCash}
                    onChange={(event) => setCloseForm((current) => ({ ...current, closingCountedCash: event.target.value }))}
                    className="w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                  />
                </label>

                <label className="space-y-2 block">
                  <span className="text-xs font-bold uppercase tracking-[0.2em] text-gray-500">Closing Note</span>
                  <textarea
                    value={closeForm.notes}
                    onChange={(event) => setCloseForm((current) => ({ ...current, notes: event.target.value }))}
                    placeholder="Explain shortages, overages, or special cash events"
                    className="min-h-28 w-full rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 outline-none transition-all focus:border-indigo-400 focus:bg-white focus:ring-4 focus:ring-indigo-100"
                  />
                </label>

                <div className="rounded-3xl border border-dashed border-indigo-200 bg-indigo-50 px-5 py-4">
                  <p className="text-xs font-bold uppercase tracking-[0.22em] text-indigo-600">Projected Variance</p>
                  <p className="mt-2 text-2xl font-black text-indigo-900">
                    KES {(
                      Number(closeForm.closingCountedCash || 0) - Number(liveSummary?.expectedCash || 0)
                    ).toLocaleString()}
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={isClosing}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-rose-600 px-6 py-3 font-bold text-white transition-all hover:bg-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <Lock className="h-4 w-4" />
                  {isClosing ? 'Closing...' : 'Close Shift'}
                </button>
              </form>
            </div>
          </div>
        </>
      )}

      <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-8 py-6 border-b border-gray-50 flex items-center gap-3">
          <Clock3 className="h-5 w-5 text-indigo-600" />
          <div>
            <h2 className="text-xl font-bold text-gray-900">Recent Shift History</h2>
            <p className="text-sm text-gray-500">Review the last shift closings and spot over/short trends quickly.</p>
          </div>
        </div>

        <div className="desktop-table-scroll overflow-x-auto">
          <table className="w-full">
            <thead className="bg-gray-50/70 text-left">
              <tr>
                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">Shift</th>
                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">Branch</th>
                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">Opened</th>
                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">Expected</th>
                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">Counted</th>
                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">Variance</th>
                <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">Status</th>
                {canGenerateReports && (
                  <th className="px-8 py-4 text-[10px] font-bold uppercase tracking-[0.22em] text-gray-500">Report</th>
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {recentShifts.map((shift) => {
                const branchName = branches.find((branch) => branch.id === shift.branchId)?.name || shift.branchId || 'Unassigned';
                return (
                  <tr key={shift.id}>
                    <td className="px-8 py-5">
                      <p className="text-sm font-bold text-gray-900">#{shift.id.slice(-8).toUpperCase()}</p>
                      <p className="text-xs text-gray-500">{shift.userName}</p>
                    </td>
                    <td className="px-8 py-5 text-sm text-gray-600">{branchName}</td>
                    <td className="px-8 py-5 text-sm text-gray-600">{toDate(shift.openedAt).toLocaleString()}</td>
                    <td className="px-8 py-5 text-sm font-semibold text-gray-900">
                      {shift.expectedCash === undefined ? 'Open' : `KES ${shift.expectedCash.toLocaleString()}`}
                    </td>
                    <td className="px-8 py-5 text-sm font-semibold text-gray-900">
                      {shift.closingCountedCash === undefined ? 'Open' : `KES ${shift.closingCountedCash.toLocaleString()}`}
                    </td>
                    <td className="px-8 py-5 text-sm font-black">
                      <span className={(shift.variance || 0) === 0 ? 'text-emerald-600' : (shift.variance || 0) > 0 ? 'text-blue-600' : 'text-red-600'}>
                        {shift.variance === undefined ? 'Open' : `KES ${shift.variance.toLocaleString()}`}
                      </span>
                    </td>
                    <td className="px-8 py-5">
                      <span className={`rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-[0.2em] ${shift.status === 'open' ? 'bg-emerald-50 text-emerald-600' : 'bg-gray-100 text-gray-600'}`}>
                        {shift.status}
                      </span>
                    </td>
                    {canGenerateReports && (
                      <td className="px-8 py-5">
                        <button
                          type="button"
                          onClick={() => void handleLoadReport(shift.id, true)}
                          disabled={isLoadingReport}
                          className="inline-flex items-center justify-center gap-2 rounded-2xl border border-indigo-200 px-3 py-2 text-xs font-bold text-indigo-700 transition-all hover:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-60"
                        >
                          <Printer className="h-4 w-4" />
                          Print
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}

              {recentShifts.length === 0 && (
                <tr>
                  <td colSpan={canGenerateReports ? 8 : 7} className="px-8 py-14 text-center text-sm text-gray-400">
                    No shift history yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedReport && (
        <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-8 py-6 border-b border-gray-50 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Shift Report Preview</h2>
              <p className="text-sm text-gray-500">
                {selectedReport.shift.branchName || 'Unassigned branch'} | {selectedReport.shift.userName} | {formatShiftReportNumber(selectedReport.shift.id)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-4 py-3 text-sm font-bold text-white transition-all hover:bg-indigo-700"
            >
              <Printer className="h-4 w-4" />
              Print Report
            </button>
          </div>

          <div className="grid grid-cols-1 gap-8 p-8 xl:grid-cols-[0.95fr_1.05fr]">
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <MetricCard label="Sales Count" value={selectedReport.totals.saleCount} tone="indigo" showCurrency={false} />
                <MetricCard label="Credit Sales" value={selectedReport.totals.creditSaleCount} tone="amber" showCurrency={false} />
                <MetricCard label="Refunded Sales" value={selectedReport.totals.refundedSaleCount} tone="rose" showCurrency={false} />
                <MetricCard label="Credit Payments" value={selectedReport.totals.creditPaymentCount} tone="blue" showCurrency={false} />
              </div>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <SummaryBlock label="Total Sales" value={selectedReport.totals.totalSales} />
                <SummaryBlock label="Collected During Shift" value={selectedReport.totals.totalCollected} />
                <SummaryBlock label="Outstanding Credit" value={selectedReport.totals.totalOutstanding} />
                <SummaryBlock label="Refund Amount" value={selectedReport.totals.totalRefundAmount} tone="rose" />
              </div>
              <div className="rounded-3xl border border-gray-100 bg-gray-50 p-5">
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-gray-500">Reconciliation</p>
                <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-gray-500">Opening Float</p>
                    <p className="text-lg font-black text-gray-900">KES {selectedReport.summary.openingFloat.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Expected Cash</p>
                    <p className="text-lg font-black text-gray-900">KES {selectedReport.summary.expectedCash.toLocaleString()}</p>
                  </div>
                  <div>
                    <p className="text-gray-500">Counted Cash</p>
                    <p className="text-lg font-black text-gray-900">
                      {selectedReport.summary.countedCash === null ? 'Open Shift' : `KES ${selectedReport.summary.countedCash.toLocaleString()}`}
                    </p>
                  </div>
                  <div>
                    <p className="text-gray-500">Variance</p>
                    <p className={`text-lg font-black ${(selectedReport.summary.variance || 0) < 0 ? 'text-red-600' : (selectedReport.summary.variance || 0) > 0 ? 'text-blue-600' : 'text-emerald-600'}`}>
                      {selectedReport.summary.variance === null ? 'Pending' : `KES ${selectedReport.summary.variance.toLocaleString()}`}
                    </p>
                  </div>
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="rounded-3xl border border-gray-100">
                <div className="border-b border-gray-100 px-5 py-4">
                  <h3 className="text-sm font-bold uppercase tracking-[0.22em] text-gray-500">Cash Movements</h3>
                </div>
                <div className="max-h-[260px] space-y-3 overflow-y-auto px-5 py-4">
                  {selectedReport.movements.length === 0 ? (
                    <p className="text-sm text-gray-400">No cash movements recorded for this shift.</p>
                  ) : (
                    selectedReport.movements.map((movement) => (
                      <div key={movement.id} className="rounded-2xl bg-gray-50 px-4 py-3">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="text-sm font-bold text-gray-900">{movement.reason}</p>
                            <p className="text-xs text-gray-500">{movement.type} | {toDate(movement.timestamp).toLocaleString()}</p>
                          </div>
                          <p className="text-sm font-black text-gray-900">KES {movement.amount.toLocaleString()}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              <div className="rounded-3xl border border-gray-100">
                <div className="border-b border-gray-100 px-5 py-4">
                  <h3 className="text-sm font-bold uppercase tracking-[0.22em] text-gray-500">Shift Sales & Credit Activity</h3>
                </div>
                <div className="max-h-[260px] space-y-3 overflow-y-auto px-5 py-4">
                  {selectedReport.sales.length === 0 && selectedReport.creditPayments.length === 0 ? (
                    <p className="text-sm text-gray-400">No sale or credit activity recorded for this shift.</p>
                  ) : (
                    <>
                      {selectedReport.sales.map((sale) => (
                        <div key={sale.id} className="rounded-2xl bg-gray-50 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-gray-900">Sale #{sale.id.slice(-8).toUpperCase()}</p>
                              <p className="text-xs text-gray-500">
                                {sale.customerName || 'Walk-in Customer'} | {(sale.tenderMethod || sale.paymentMethod).toUpperCase()} | {toDate(sale.soldAt).toLocaleString()}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className="text-sm font-black text-gray-900">KES {sale.totalAmount.toLocaleString()}</p>
                              {(sale.outstandingBalance || 0) > 0 && (
                                <p className="text-xs font-bold text-amber-600">Credit KES {sale.outstandingBalance.toLocaleString()}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                      {selectedReport.creditPayments.map((payment) => (
                        <div key={payment.id} className="rounded-2xl bg-blue-50 px-4 py-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-sm font-bold text-blue-900">Credit payment #{payment.id.slice(-8).toUpperCase()}</p>
                              <p className="text-xs text-blue-700">
                                {payment.paymentMethod.toUpperCase()} | {toDate(payment.paidAt).toLocaleString()}
                              </p>
                            </div>
                            <p className="text-sm font-black text-blue-900">KES {payment.amountPaid.toLocaleString()}</p>
                          </div>
                        </div>
                      ))}
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
      </div>

      {selectedReport && (
        <div id="cash-shift-receipt" className="hidden print:block font-mono text-[12px] leading-tight p-4 w-[80mm]">
          <div className="text-center mb-4">
            <h1 className="font-bold text-lg uppercase">KingKush Sale</h1>
            <p className="text-sm font-bold">CASH SHIFT REPORT</p>
            <p>{selectedReport.shift.branchName || 'Unassigned branch'}</p>
            <p className="mt-1">Report #: {formatShiftReportNumber(selectedReport.shift.id)}</p>
            <p className="mt-2">********************************</p>
          </div>

          <div className="mb-3 space-y-1">
            <p>SHIFT: {selectedReport.shift.id.toUpperCase()}</p>
            <p>CASHIER: {selectedReport.shift.userName.toUpperCase()}</p>
            <p>OPENED: {toDate(selectedReport.shift.openedAt).toLocaleString()}</p>
            {selectedReport.shift.closedAt && <p>CLOSED: {toDate(selectedReport.shift.closedAt).toLocaleString()}</p>}
            <p>GENERATED: {toDate(selectedReport.generatedAt).toLocaleString()}</p>
            <p>********************************</p>
          </div>

          <div className="mb-4 space-y-1">
            <div className="flex justify-between"><span>OPENING FLOAT</span><span>KES {selectedReport.summary.openingFloat.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>CASH SALES</span><span>KES {selectedReport.summary.cashSales.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>CREDIT CASH-IN</span><span>KES {selectedReport.summary.cashCreditPayments.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>MANUAL IN</span><span>KES {selectedReport.summary.manualCashIn.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>MANUAL OUT</span><span>KES {selectedReport.summary.manualCashOut.toLocaleString()}</span></div>
            <div className="flex justify-between font-bold"><span>EXPECTED CASH</span><span>KES {selectedReport.summary.expectedCash.toLocaleString()}</span></div>
            {selectedReport.summary.countedCash !== null && (
              <>
                <div className="flex justify-between"><span>COUNTED CASH</span><span>KES {selectedReport.summary.countedCash.toLocaleString()}</span></div>
                <div className="flex justify-between font-bold"><span>VARIANCE</span><span>KES {(selectedReport.summary.variance || 0).toLocaleString()}</span></div>
              </>
            )}
            <p>********************************</p>
          </div>

          <div className="mb-4">
            <p className="font-bold mb-1">ACTIVITY TOTALS</p>
            <div className="flex justify-between"><span>SALES COUNT</span><span>{selectedReport.totals.saleCount}</span></div>
            <div className="flex justify-between"><span>CREDIT SALES</span><span>{selectedReport.totals.creditSaleCount}</span></div>
            <div className="flex justify-between"><span>REFUNDS</span><span>{selectedReport.totals.refundedSaleCount}</span></div>
            <div className="flex justify-between"><span>TOTAL SALES</span><span>KES {selectedReport.totals.totalSales.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>COLLECTED</span><span>KES {selectedReport.totals.totalCollected.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>OUTSTANDING</span><span>KES {selectedReport.totals.totalOutstanding.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>REFUND VALUE</span><span>KES {selectedReport.totals.totalRefundAmount.toLocaleString()}</span></div>
            <div className="flex justify-between"><span>CREDIT PAYMENTS</span><span>KES {selectedReport.totals.totalCreditPayments.toLocaleString()}</span></div>
            <p>********************************</p>
          </div>

          {selectedReport.movements.length > 0 && (
            <div className="mb-4">
              <p className="font-bold mb-1">CASH MOVEMENTS</p>
              {selectedReport.movements.map((movement) => (
                <div key={movement.id} className="mb-1">
                  <div className="flex justify-between">
                    <span>{movement.type.toUpperCase()}</span>
                    <span>KES {movement.amount.toLocaleString()}</span>
                  </div>
                  <p className="text-[10px]">{movement.reason}</p>
                </div>
              ))}
              <p>********************************</p>
            </div>
          )}

          <div className="text-center">
            <p className="font-bold mb-1 uppercase">Shift report generated successfully</p>
            <p>Prepared for reconciliation and audit review.</p>
          </div>
        </div>
      )}
    </div>
  );
}

function MetricCard({
  label,
  value,
  tone,
  showCurrency = true
}: {
  label: string;
  value: number;
  tone: 'indigo' | 'emerald' | 'blue' | 'amber' | 'rose';
  showCurrency?: boolean;
}) {
  const toneMap = {
    indigo: 'bg-indigo-50 text-indigo-700',
    emerald: 'bg-emerald-50 text-emerald-700',
    blue: 'bg-blue-50 text-blue-700',
    amber: 'bg-amber-50 text-amber-700',
    rose: 'bg-rose-50 text-rose-700'
  } as const;

  return (
    <div className={`rounded-3xl border border-white/70 px-5 py-4 ${toneMap[tone]}`}>
      <p className="text-xs font-bold uppercase tracking-[0.22em]">{label}</p>
      <p className="mt-3 text-2xl font-black">{showCurrency ? `KES ${value.toLocaleString()}` : value.toLocaleString()}</p>
    </div>
  );
}

function SummaryBlock({
  label,
  value,
  tone = 'gray'
}: {
  label: string;
  value: number;
  tone?: 'gray' | 'rose';
}) {
  return (
    <div className={`rounded-3xl border px-5 py-4 ${tone === 'rose' ? 'border-rose-100 bg-rose-50' : 'border-gray-100 bg-gray-50'}`}>
      <p className={`text-xs font-bold uppercase tracking-[0.22em] ${tone === 'rose' ? 'text-rose-600' : 'text-gray-500'}`}>{label}</p>
      <p className={`mt-3 text-2xl font-black ${tone === 'rose' ? 'text-rose-700' : 'text-gray-900'}`}>KES {value.toLocaleString()}</p>
    </div>
  );
}
