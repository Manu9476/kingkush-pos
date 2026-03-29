import { useState, useEffect } from 'react';
import { CreditCard, Search, CheckCircle, Printer, AlertTriangle } from 'lucide-react';
import { 
  db, 
  collection, 
  query, 
  where, 
  getDoc,
  onSnapshot, 
  doc, 
  serverTimestamp, 
  writeBatch,
  increment,
  handleFirestoreError,
  OperationType
} from '../data';
import { Credit, CreditPayment, SystemSettings } from '../types';
import { useAuth } from '../App';

export default function Credits() {
  const { user } = useAuth();
  const [credits, setCredits] = useState<Credit[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCredit, setSelectedCredit] = useState<Credit | null>(null);
  const [paymentAmount, setPaymentAmount] = useState<number>(0);
  const [paymentMethod, setPaymentMethod] = useState('Cash');
  const [paymentReference, setPaymentReference] = useState('');
  const [isProcessing, setIsProcessing] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [, setIsPrinting] = useState(false);
  const [lastPayment, setLastPayment] = useState<CreditPayment | null>(null);

  useEffect(() => {
    const q = query(collection(db, 'credits'), where('status', '==', 'open'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setCredits(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Credit)));
    }, (error) => {
      handleFirestoreError(error, OperationType.GET, 'credits');
    });

    const fetchSettings = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'system'));
        if (settingsDoc.exists()) {
          setSettings(settingsDoc.data() as SystemSettings);
        }
      } catch (error) {
        console.error('Error fetching settings:', error);
      }
    };

    fetchSettings();
    return () => unsubscribe();
  }, []);

  const filteredCredits = credits.filter(c => 
    c.customerName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.saleId.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const totalOutstanding = credits.reduce((sum, c) => sum + c.outstandingBalance, 0);

  const handleSettle = (credit: Credit) => {
    setSelectedCredit(credit);
    setPaymentAmount(credit.outstandingBalance);
    setPaymentReference('');
  };

  const handleSavePayment = async () => {
    if (!selectedCredit || paymentAmount <= 0) return;

    setIsProcessing(true);
    try {
      const batch = writeBatch(db);
      
      const newOutstanding = selectedCredit.outstandingBalance - paymentAmount;

      // 1. Record the payment
      const paymentRef = doc(collection(db, 'credit_payments'));
      const paymentData: Partial<CreditPayment> = {
        creditId: selectedCredit.id,
        saleId: selectedCredit.saleId,
        amountPaid: paymentAmount,
        remainingBalance: newOutstanding,
        paymentMethod,
        reference: paymentReference,
        timestamp: serverTimestamp(),
        cashierId: user?.uid ?? null,
        cashierName: user?.displayName || user?.email || 'Unknown'
      };
      batch.set(paymentRef, paymentData);

      // 2. Update the credit record
      const creditRef = doc(db, 'credits', selectedCredit.id);
      batch.update(creditRef, {
        amountPaid: increment(paymentAmount),
        outstandingBalance: increment(-paymentAmount),
        status: newOutstanding <= 0 ? 'settled' : 'open'
      });

      // 3. Update the original sale record
      const saleRef = doc(db, 'sales', selectedCredit.saleId);
      batch.update(saleRef, {
        amountPaid: increment(paymentAmount),
        outstandingBalance: increment(-paymentAmount)
      });

      await batch.commit();
      
      // Store payment info for printing
      setLastPayment({
        id: paymentRef.id,
        ...paymentData as CreditPayment,
        timestamp: { toDate: () => new Date() } // Mock timestamp for immediate printing
      });

      setShowSuccess(true);
      setSelectedCredit(null);
      setPaymentAmount(0);
      setPaymentReference('');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'credit_payments');
    } finally {
      setIsProcessing(false);
    }
  };

  const handlePrintReceipt = (payment: CreditPayment) => {
    setLastPayment(payment);
    setIsPrinting(true);
    setTimeout(() => {
      window.print();
      setIsPrinting(false);
    }, 1000);
  };

  return (
    <div className="max-w-7xl mx-auto space-y-8">
      <div className="flex flex-col gap-1">
        <h1 className="text-3xl font-bold text-gray-900">Customer Credits</h1>
        <p className="text-sm text-gray-500">Track outstanding balances and record customer credit payments.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-8">
        {/* Left: Open Credit Sales */}
        <div className="lg:col-span-3 space-y-6">
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Open Credit Sales</h2>
              <div className="text-sm text-gray-500 font-medium">
                Open credits: {filteredCredits.length} of {credits.length} | Total outstanding: <span className="text-indigo-600 font-bold text-lg">KES {totalOutstanding.toLocaleString()}</span>
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600">Lookup Customer Credit</label>
              <div className="relative">
                <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 w-5 h-5" />
                <input 
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Type customer name or sale number"
                  className="w-full pl-12 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                />
              </div>
              <p className="text-xs text-gray-500">Filter credit records as you type.</p>
            </div>

            <div className="overflow-x-auto max-h-150 overflow-y-auto pr-2 custom-scrollbar">
              <table className="w-full">
                <thead className="sticky top-0 bg-white z-10 shadow-sm">
                  <tr className="text-[10px] font-bold text-gray-600 uppercase tracking-widest border-b border-gray-50">
                    <th className="text-left py-4 px-2">SALE NO</th>
                    <th className="text-left py-4 px-2">CUSTOMER</th>
                    <th className="text-left py-4 px-2">ITEMS (NAME / SKU)</th>
                    <th className="text-right py-4 px-2">TOTAL</th>
                    <th className="text-right py-4 px-2">PAID</th>
                    <th className="text-right py-4 px-2">OUTSTANDING</th>
                    <th className="text-left py-4 px-2">DATE</th>
                    <th className="text-center py-4 px-2">ACTION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filteredCredits.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-12 text-center text-gray-500">
                        <div className="w-16 h-16 bg-gray-50 text-gray-200 rounded-full flex items-center justify-center mx-auto mb-4">
                          <CreditCard className="w-8 h-8" />
                        </div>
                        <p className="font-medium">No open credits found.</p>
                      </td>
                    </tr>
                  ) : (
                    filteredCredits.map(credit => {
                      const creditDate = credit.timestamp?.toDate() || new Date();
                      const daysOld = Math.floor((new Date().getTime() - creditDate.getTime()) / (1000 * 60 * 60 * 24));
                      const isBadDebt = settings?.badDebtThresholdDays ? daysOld >= settings.badDebtThresholdDays : false;

                      return (
                        <tr key={credit.id} className={`text-sm group hover:bg-gray-50 transition-colors ${isBadDebt ? 'bg-red-50/30' : ''}`}>
                          <td className="py-4 px-2 font-mono text-xs text-gray-500">{credit.saleId}</td>
                          <td className="py-4 px-2">
                            <div className="flex flex-col">
                              <span className="font-bold text-gray-900">{credit.customerName}</span>
                              {isBadDebt && (
                                <span className="flex items-center gap-1 text-[10px] font-black text-red-600 uppercase tracking-tighter">
                                  <AlertTriangle className="w-3 h-3" />
                                  Bad Debt ({daysOld} days)
                                </span>
                              )}
                            </div>
                          </td>
                          <td className="py-4 px-2 text-gray-600 max-w-50 truncate">{credit.items}</td>
                          <td className="py-4 px-2 text-right font-medium">{credit.totalAmount.toLocaleString()}</td>
                          <td className="py-4 px-2 text-right text-gray-600">{credit.amountPaid.toLocaleString()}</td>
                          <td className="py-4 px-2 text-right font-bold text-indigo-600">{credit.outstandingBalance.toLocaleString()}</td>
                          <td className="py-4 px-2 text-gray-500 text-xs">
                            {creditDate.toLocaleString()}
                          </td>
                          <td className="py-4 px-2 text-center">
                            <button 
                              onClick={() => handleSettle(credit)}
                              className="px-4 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-colors"
                            >
                              Settle
                            </button>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right: Record Payment Form */}
        <div className="space-y-6">
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 space-y-6 sticky top-8">
            <h2 className="text-2xl font-bold text-gray-900 leading-tight">Record Credit Payment</h2>
            
            <div className="space-y-4">
              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Sale Number</label>
                <input 
                  type="text"
                  readOnly
                  value={selectedCredit?.saleId || ''}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-mono text-gray-500 outline-none"
                  placeholder="Select a sale to settle"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Customer</label>
                <input 
                  type="text"
                  readOnly
                  value={selectedCredit?.customerName || ''}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Outstanding</label>
                <input 
                  type="text"
                  readOnly
                  value={selectedCredit ? selectedCredit.outstandingBalance.toLocaleString() : ''}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-indigo-600 outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Payment Method</label>
                <select 
                  value={paymentMethod}
                  onChange={(e) => setPaymentMethod(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-medium text-gray-700 outline-none"
                >
                  <option value="Cash">Cash</option>
                  <option value="M-Pesa">M-Pesa</option>
                  <option value="Card">Card</option>
                </select>
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Amount Paid</label>
                <input 
                  type="number"
                  value={paymentAmount || ''}
                  onChange={(e) => setPaymentAmount(Number(e.target.value))}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm font-bold text-gray-900 outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-bold text-gray-600 uppercase tracking-wider">Reference (optional)</label>
                <input 
                  type="text"
                  value={paymentReference}
                  onChange={(e) => setPaymentReference(e.target.value)}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl text-sm outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div className="pt-4 space-y-3">
                <button 
                  onClick={handleSavePayment}
                  disabled={!selectedCredit || paymentAmount <= 0 || isProcessing}
                  className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold text-sm hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:bg-gray-300 disabled:shadow-none"
                >
                  {isProcessing ? 'Processing...' : 'Save Payment'}
                </button>
                <button 
                  onClick={() => lastPayment && handlePrintReceipt(lastPayment)}
                  disabled={!lastPayment}
                  className="w-full py-4 bg-gray-100 text-gray-600 rounded-xl font-bold text-sm hover:bg-gray-200 transition-all disabled:opacity-50"
                >
                  Print Receipt
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Success Modal */}
      {showSuccess && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-3xl w-full max-w-md overflow-hidden shadow-2xl">
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-4">
                <CheckCircle className="w-10 h-10" />
              </div>
              <h3 className="text-2xl font-bold text-gray-900 mb-2">Payment Recorded</h3>
              <p className="text-gray-500 mb-4">The credit payment has been successfully recorded and the balance updated.</p>
              {lastPayment?.remainingBalance !== undefined && (
                <div className="mb-8 p-4 bg-indigo-50 rounded-2xl">
                  <p className="text-xs font-bold text-indigo-600 uppercase tracking-widest mb-1">Remaining Balance</p>
                  <p className="text-2xl font-black text-indigo-900">KES {lastPayment.remainingBalance.toLocaleString()}</p>
                </div>
              )}
              <div className="space-y-3">
                <button 
                  onClick={() => lastPayment && handlePrintReceipt(lastPayment)}
                  className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all flex items-center justify-center gap-2"
                >
                  <Printer className="w-5 h-5" />
                  Print Receipt
                </button>
                <button 
                  onClick={() => setShowSuccess(false)}
                  className="w-full py-4 bg-gray-100 text-gray-600 rounded-xl font-bold hover:bg-gray-200 transition-all"
                >
                  Continue
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Print Receipt */}
      {lastPayment && (
        <div id="credit-receipt" className="hidden print:block font-mono text-[12px] leading-tight">
          <div className="text-center mb-6">
            <h1 className="font-bold text-lg uppercase">KingKush Supermarket</h1>
            <p className="text-sm">1331-60100-Embu</p>
            <p className="text-sm">Tel: +254 701137747</p>
            <p className="mt-2">********************************</p>
          </div>
          
          <div className="space-y-2 mb-6">
            <div className="flex justify-between">
              <span>DATE:</span>
              <span>{lastPayment.timestamp?.toDate().toLocaleDateString()}</span>
            </div>
            <div className="flex justify-between">
              <span>TIME:</span>
              <span>{lastPayment.timestamp?.toDate().toLocaleTimeString()}</span>
            </div>
            <div className="flex justify-between">
              <span>RECEIPT #:</span>
              <span>{lastPayment.id.slice(-8).toUpperCase()}</span>
            </div>
            <div className="flex justify-between">
              <span>SALE NO:</span>
              <span>{lastPayment.saleId}</span>
            </div>
          </div>

          <div className="border-y border-dashed border-gray-300 py-4 mb-6">
            <p className="font-bold mb-2 uppercase tracking-widest text-[10px]">Payment Details:</p>
            <div className="flex justify-between">
              <span>METHOD:</span>
              <span>{lastPayment.paymentMethod.toUpperCase()}</span>
            </div>
            {lastPayment.reference && (
              <div className="flex justify-between">
                <span>REF:</span>
                <span>{lastPayment.reference}</span>
              </div>
            )}
          </div>

          <div className="space-y-2 mb-8">
            <div className="flex justify-between font-bold text-sm">
              <span>AMOUNT PAID:</span>
              <span>KES {lastPayment.amountPaid.toLocaleString()}</span>
            </div>
            {lastPayment.remainingBalance !== undefined && (
              <div className="flex justify-between font-bold text-sm text-red-600">
                <span>REMAINING BALANCE:</span>
                <span>KES {lastPayment.remainingBalance.toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="space-y-6 mt-12">
            <div className="border-t border-gray-300 pt-1">
              <p className="text-[10px] uppercase tracking-widest text-center">Served By: {lastPayment.cashierName}</p>
            </div>
            <div className="border-t border-gray-300 pt-4 mt-8">
              <p className="text-[10px] uppercase tracking-widest text-center">Customer Signature</p>
            </div>
          </div>

          <div className="text-center mt-12 text-[10px]">
            <p>********************************</p>
            <p className="font-bold mb-1 uppercase">All goods are inclusive of vat</p>
            <p>THANK YOU FOR YOUR PAYMENT</p>
            <p className="mt-2">Created by Noxira labs(+254 701137747)</p>
          </div>
        </div>
      )}
    </div>
  );
}
