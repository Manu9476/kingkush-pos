import { useEffect, useState } from 'react';
import {
  db,
  collection,
  getDocs,
  query,
  orderBy,
  where,
  getDoc,
  doc,
  collectionGroup,
  toDate
} from '../data';
import { Branch, Expense, Product, Sale } from '../types';
import { useAuth } from '../App';
import {
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  BarChart,
  Bar
} from 'recharts';
import { AlertTriangle, Calendar, Clock, DollarSign, Download, FileText, Package, TrendingUp } from 'lucide-react';
import { toast } from 'sonner';
import { getProductMovementReport } from '../services/platformApi';

type ReportPeriod = 'daily' | 'weekly' | 'monthly' | 'custom';

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function endOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(23, 59, 59, 999);
  return value;
}

function formatDateInput(date: Date) {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parseDateInput(value: string) {
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) {
    return null;
  }

  const parsed = new Date(year, month - 1, day);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDateStamp(date: Date) {
  return formatDateInput(date);
}

export default function Reports() {
  const { user } = useAuth();
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [credits, setCredits] = useState<any[]>([]);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [reportLoadError, setReportLoadError] = useState<string | null>(null);
  const [activePeriod, setActivePeriod] = useState<ReportPeriod>('monthly');
  const [customStartDate, setCustomStartDate] = useState(() => {
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 6);
    return formatDateInput(defaultStart);
  });
  const [customEndDate, setCustomEndDate] = useState(() => formatDateInput(new Date()));
  const [isPreparingMovementReport, setIsPreparingMovementReport] = useState(false);

  useEffect(() => {
    const fetchData = async () => {
      if (!user) return;

      try {
        const [
          salesSnapshot,
          productsSnapshot,
          expensesSnapshot,
          creditsSnapshot,
          settingsDoc,
          branchesSnapshot
        ] = await Promise.all([
          getDocs(query(collection(db, 'sales'), orderBy('timestamp', 'desc'))),
          getDocs(collection(db, 'products')),
          getDocs(query(collection(db, 'expenses'), orderBy('date', 'desc'))),
          getDocs(query(collection(db, 'credits'), where('status', '==', 'open'))),
          getDoc(doc(db, 'settings', 'system')),
          getDocs(collection(db, 'branches'))
        ]);

        setSales(salesSnapshot.docs.map((saleDoc) => ({ id: saleDoc.id, ...saleDoc.data() } as Sale)));
        setProducts(productsSnapshot.docs.map((productDoc) => ({ id: productDoc.id, ...productDoc.data() } as Product)));
        setExpenses(expensesSnapshot.docs.map((expenseDoc) => ({ id: expenseDoc.id, ...expenseDoc.data() } as Expense)));
        setCredits(creditsSnapshot.docs.map((creditDoc) => ({ id: creditDoc.id, ...creditDoc.data() })));
        setBranches(branchesSnapshot.docs.map((branchDoc) => ({ id: branchDoc.id, ...branchDoc.data() } as Branch)));
        setSettings(settingsDoc.exists() ? settingsDoc.data() : null);
        setReportLoadError(null);
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unable to load report data';
        setReportLoadError(message);
        toast.error(message);
      }
    };

    fetchData();
  }, [user]);

  const resolveSelectedWindow = () => {
    const now = new Date();
    const todayStart = startOfDay(now);
    const todayEnd = endOfDay(now);

    if (activePeriod === 'daily') {
      return {
        start: todayStart,
        end: todayEnd,
        label: 'Today',
        stamp: formatDateStamp(now)
      };
    }

    if (activePeriod === 'weekly') {
      const weeklyStart = new Date(todayStart);
      weeklyStart.setDate(weeklyStart.getDate() - 6);
      return {
        start: weeklyStart,
        end: todayEnd,
        label: `${weeklyStart.toLocaleDateString()} to ${todayEnd.toLocaleDateString()}`,
        stamp: `${formatDateStamp(weeklyStart)}_to_${formatDateStamp(todayEnd)}`
      };
    }

    if (activePeriod === 'monthly') {
      const monthlyStart = new Date(now.getFullYear(), now.getMonth(), 1);
      return {
        start: startOfDay(monthlyStart),
        end: todayEnd,
        label: `${monthlyStart.toLocaleDateString()} to ${todayEnd.toLocaleDateString()}`,
        stamp: `${formatDateStamp(monthlyStart)}_to_${formatDateStamp(todayEnd)}`
      };
    }

    const parsedStart = parseDateInput(customStartDate);
    const parsedEnd = parseDateInput(customEndDate);
    if (!parsedStart || !parsedEnd) {
      return null;
    }

    const customStart = startOfDay(parsedStart);
    const customEnd = endOfDay(parsedEnd);
    if (customEnd < customStart) {
      return null;
    }

    return {
      start: customStart,
      end: customEnd,
      label: `${customStart.toLocaleDateString()} to ${customEnd.toLocaleDateString()}`,
      stamp: `${formatDateStamp(customStart)}_to_${formatDateStamp(customEnd)}`
    };
  };

  const selectedWindow = resolveSelectedWindow();

  const filterBySelectedWindow = <T,>(items: T[], getTimestamp: (item: T) => unknown) => {
    if (!selectedWindow) {
      return [];
    }

    return items.filter((item) => {
      const timestamp = getTimestamp(item);
      if (!timestamp) {
        return false;
      }

      const value = toDate(timestamp);
      return value >= selectedWindow.start && value <= selectedWindow.end;
    });
  };

  const filteredSales = filterBySelectedWindow(sales, (sale) => sale.timestamp);
  const filteredExpenses = filterBySelectedWindow(expenses, (expense) => expense.date);
  const totalRevenue = filteredSales.reduce((sum, sale) => sum + (sale.totalAmount - (sale.refundAmount || 0)), 0);
  const avgSale = filteredSales.length > 0 ? totalRevenue / filteredSales.length : 0;
  const lowStockProducts = products.filter((product) => product.stockQuantity <= (product.lowStockThreshold || 5));

  const getBranchLabel = (branchId?: string) => {
    if (!branchId) {
      return 'Unassigned';
    }

    const branch = branches.find((entry) => entry.id === branchId);
    return branch ? branch.name : branchId;
  };

  const getRequiredWindow = () => {
    const currentWindow = resolveSelectedWindow();
    if (!currentWindow) {
      toast.error('Choose a valid start and end date first.');
      return null;
    }

    return currentWindow;
  };

  const calculateDebtAging = () => {
    const now = new Date();
    const badDebtThreshold = settings?.badDebtThresholdDays || 90;
    const aging = {
      current: 0,
      overdue: 0,
      critical: 0,
      badDebt: 0
    };

    credits.forEach((credit) => {
      const creditDate = credit.timestamp ? toDate(credit.timestamp) : new Date();
      const diffDays = Math.floor((now.getTime() - creditDate.getTime()) / (1000 * 60 * 60 * 24));

      if (diffDays >= badDebtThreshold) {
        aging.badDebt += Number(credit.outstandingBalance || 0);
      } else if (diffDays > 60) {
        aging.critical += Number(credit.outstandingBalance || 0);
      } else if (diffDays > 30) {
        aging.overdue += Number(credit.outstandingBalance || 0);
      } else {
        aging.current += Number(credit.outstandingBalance || 0);
      }
    });

    return [
      { name: '0-30 Days', value: aging.current },
      { name: '31-60 Days', value: aging.overdue },
      { name: '61-90 Days', value: aging.critical },
      { name: `${badDebtThreshold}+ Days (Bad Debt)`, value: aging.badDebt }
    ];
  };

  const debtAgingData = calculateDebtAging();

  const calculateProfitEstimate = () => {
    const revenue = filteredSales.reduce((sum, sale) => sum + (sale.totalAmount - (sale.refundAmount || 0)), 0);
    const estimatedCost = revenue * 0.88;
    const estimatedProfit = revenue - estimatedCost;

    return {
      range: selectedWindow?.label || 'Invalid range',
      revenue: Math.round(revenue),
      estimated_cost: Math.round(estimatedCost),
      estimated_profit: Math.round(estimatedProfit)
    };
  };

  const profitStats = calculateProfitEstimate();

  const downloadCSV = (data: Record<string, unknown>[], filename: string, title?: string) => {
    if (data.length === 0) {
      toast.error('No data to export');
      return;
    }

    const headers = Object.keys(data[0]);
    const generationTime = new Date().toLocaleString();

    let csvContent = '';
    csvContent += `"${title || 'Business Report'}"\n`;
    csvContent += `"Generated At:","${generationTime}"\n`;
    csvContent += `"Generated By:","${user?.displayName || user?.username || 'System'}"\n`;
    if (selectedWindow) {
      csvContent += `"Report Window:","${selectedWindow.label}"\n`;
    }
    csvContent += '\n';

    csvContent += headers.join(',') + '\n';
    csvContent += data
      .map((row) =>
        headers
          .map((header) => {
            const value = row[header] ?? '';
            const escaped = String(value).replace(/"/g, '""');
            return `"${escaped}"`;
          })
          .join(',')
      )
      .join('\n');

    const blob = new Blob(['\ufeff' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportSalesCSV = () => {
    if (reportLoadError) {
      toast.error(reportLoadError);
      return;
    }

    const currentWindow = getRequiredWindow();
    if (!currentWindow) {
      return;
    }

    const exportData: Record<string, unknown>[] = filteredSales.map((sale) => ({
      'Sale ID': sale.id,
      Date: toDate(sale.timestamp).toLocaleString(),
      Branch: getBranchLabel(sale.branchId),
      Cashier: sale.cashierName,
      Customer: sale.customerName || 'Walk-in Customer',
      'Original Amount': sale.totalAmount,
      'Refunded Amount': sale.refundAmount || 0,
      'Net Amount': sale.totalAmount - (sale.refundAmount || 0),
      'Amount Paid': sale.amountPaid,
      'Outstanding Balance': sale.outstandingBalance || 0,
      'Payment Method': sale.paymentMethod,
      'Tender Method': sale.tenderMethod || sale.paymentMethod,
      Reference: sale.reference || '',
      Status: sale.isCredit || (sale.outstandingBalance || 0) > 0 ? 'Credit / Partial' : 'Paid'
    }));

    const totalOriginal = filteredSales.reduce((sum, sale) => sum + sale.totalAmount, 0);
    const totalRefunded = filteredSales.reduce((sum, sale) => sum + (sale.refundAmount || 0), 0);
    const totalNet = totalOriginal - totalRefunded;
    const totalCollected = filteredSales.reduce((sum, sale) => sum + sale.amountPaid, 0);
    const totalOutstanding = filteredSales.reduce((sum, sale) => sum + (sale.outstandingBalance || 0), 0);

    exportData.push({
      'Sale ID': 'TOTAL',
      Date: '',
      Branch: '',
      Cashier: '',
      Customer: '',
      'Original Amount': totalOriginal,
      'Refunded Amount': totalRefunded,
      'Net Amount': totalNet,
      'Amount Paid': totalCollected,
      'Outstanding Balance': totalOutstanding,
      'Payment Method': '',
      'Tender Method': '',
      Reference: '',
      Status: ''
    });

    downloadCSV(exportData, `Sales_Report_${currentWindow.stamp}.csv`, `Sales Report (${currentWindow.label})`);
  };

  const exportInventoryCSV = () => {
    if (reportLoadError) {
      toast.error(reportLoadError);
      return;
    }

    const exportData: Record<string, unknown>[] = products.map((product) => ({
      SKU: product.sku,
      Barcode: product.barcode,
      'Product Name': product.name,
      'Buying Price': product.buyingPrice,
      'Selling Price': product.sellingPrice,
      'Stock Quantity': product.stockQuantity,
      Unit: product.unitType,
      'Total Value (Cost)': product.stockQuantity * product.buyingPrice,
      'Total Value (Retail)': product.stockQuantity * product.sellingPrice
    }));

    const totalQty = products.reduce((sum, product) => sum + product.stockQuantity, 0);
    const totalCostValue = products.reduce((sum, product) => sum + product.stockQuantity * product.buyingPrice, 0);
    const totalRetailValue = products.reduce((sum, product) => sum + product.stockQuantity * product.sellingPrice, 0);

    exportData.push({
      SKU: 'TOTAL',
      Barcode: '',
      'Product Name': '',
      'Buying Price': '',
      'Selling Price': '',
      'Stock Quantity': totalQty,
      Unit: '',
      'Total Value (Cost)': totalCostValue,
      'Total Value (Retail)': totalRetailValue
    });

    downloadCSV(exportData, `Inventory_Report_${formatDateStamp(new Date())}.csv`, 'Inventory Status Report');
  };

  const exportExpensesCSV = () => {
    if (reportLoadError) {
      toast.error(reportLoadError);
      return;
    }

    const currentWindow = getRequiredWindow();
    if (!currentWindow) {
      return;
    }

    const exportData: Record<string, unknown>[] = filteredExpenses.map((expense) => ({
      ID: expense.id,
      Date: toDate(expense.date).toLocaleString(),
      Branch: getBranchLabel(expense.branchId),
      Category: expense.category,
      Description: expense.description,
      Amount: expense.amount,
      'Payment Method': expense.paymentMethod,
      Reference: expense.reference || 'N/A',
      'Recorded By': expense.recordedByName
    }));

    const totalAmount = filteredExpenses.reduce((sum, expense) => sum + expense.amount, 0);
    exportData.push({
      ID: 'TOTAL',
      Date: '',
      Branch: '',
      Category: '',
      Description: '',
      Amount: totalAmount,
      'Payment Method': '',
      Reference: '',
      'Recorded By': ''
    });

    downloadCSV(exportData, `Expenses_Report_${currentWindow.stamp}.csv`, `Expenses Report (${currentWindow.label})`);
  };

  const exportProfitCSV = async () => {
    if (reportLoadError) {
      toast.error(reportLoadError);
      return;
    }

    const currentWindow = getRequiredWindow();
    if (!currentWindow) {
      return;
    }

    if (filteredSales.length === 0) {
      toast.error('No sales found in the selected range');
      return;
    }

    const toastId = toast.loading('Preparing profit report... This may take a moment.');

    try {
      const saleIds = new Set(filteredSales.map((sale) => sale.id));
      const profitRows: Record<string, unknown>[] = [];
      const itemsSnapshot = await getDocs(query(collectionGroup(db, 'items')));

      const itemsBySale = new Map<string, any[]>();
      itemsSnapshot.docs.forEach((itemDoc) => {
        const itemData = itemDoc.data();
        const saleId = typeof itemData.saleId === 'string' ? itemData.saleId : undefined;
        if (!saleId || !saleIds.has(saleId)) {
          return;
        }

        if (!itemsBySale.has(saleId)) {
          itemsBySale.set(saleId, []);
        }
        itemsBySale.get(saleId)?.push(itemData);
      });

      for (const sale of filteredSales) {
        const items = itemsBySale.get(sale.id) || [];
        for (const item of items) {
          if (item.status === 'refunded') {
            continue;
          }

          const product = products.find((entry) => entry.id === item.productId);
          const buyingPrice = product?.buyingPrice || 0;
          const profit = item.totalPrice - buyingPrice * item.quantity;
          profitRows.push({
            Date: toDate(sale.timestamp).toLocaleString(),
            'Sale ID': sale.id,
            Branch: getBranchLabel(sale.branchId),
            Product: item.productName,
            Quantity: item.quantity,
            'Buying Price': buyingPrice,
            'Selling Price': item.unitPrice,
            'Total Cost': buyingPrice * item.quantity,
            'Total Revenue': item.totalPrice,
            Profit: profit
          });
        }
      }

      if (profitRows.length === 0) {
        toast.error('No sale items found in the selected range');
        return;
      }

      const totalQty = profitRows.reduce((sum, row) => sum + Number(row.Quantity ?? 0), 0);
      const totalCost = profitRows.reduce((sum, row) => sum + Number(row['Total Cost'] ?? 0), 0);
      const totalRevenueValue = profitRows.reduce((sum, row) => sum + Number(row['Total Revenue'] ?? 0), 0);
      const totalProfit = profitRows.reduce((sum, row) => sum + Number(row.Profit ?? 0), 0);

      profitRows.push({
        Date: 'TOTAL',
        'Sale ID': '',
        Branch: '',
        Product: '',
        Quantity: totalQty,
        'Buying Price': '',
        'Selling Price': '',
        'Total Cost': totalCost,
        'Total Revenue': totalRevenueValue,
        Profit: totalProfit
      });

      downloadCSV(profitRows, `Profit_Report_${currentWindow.stamp}.csv`, `Profit Report (${currentWindow.label})`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to generate profit report');
    } finally {
      toast.dismiss(toastId);
    }
  };

  const exportProfitSummaryCSV = () => {
    if (reportLoadError) {
      toast.error(reportLoadError);
      return;
    }

    const currentWindow = getRequiredWindow();
    if (!currentWindow) {
      return;
    }

    const exportData = [
      {
        'Report Window': currentWindow.label,
        Revenue: profitStats.revenue,
        'Estimated Cost': profitStats.estimated_cost,
        'Estimated Profit': profitStats.estimated_profit
      }
    ];

    downloadCSV(exportData, `Profit_Summary_${currentWindow.stamp}.csv`, `Profit Summary (${currentWindow.label})`);
  };

  const exportProductMovementCSV = async () => {
    if (reportLoadError) {
      toast.error(reportLoadError);
      return;
    }

    const currentWindow = getRequiredWindow();
    if (!currentWindow) {
      return;
    }

    setIsPreparingMovementReport(true);
    const toastId = toast.loading('Preparing product movement report...');

    try {
      const report = await getProductMovementReport({
        rangeStart: currentWindow.start.toISOString(),
        rangeEnd: currentWindow.end.toISOString()
      });

      if (report.rows.length === 0) {
        toast.error('No product movement was found in the selected range');
        return;
      }

      const rowsByProduct = new Map<string, typeof report.rows>();
      report.rows.forEach((row) => {
        if (!rowsByProduct.has(row.productId)) {
          rowsByProduct.set(row.productId, []);
        }
        rowsByProduct.get(row.productId)?.push(row);
      });

      const exportData: Record<string, unknown>[] = [];
      report.summary.forEach((summary) => {
        exportData.push({
          Section: 'PRODUCT SUMMARY',
          'Product Name': summary.productName,
          SKU: summary.sku,
          Barcode: summary.barcode,
          Unit: summary.unitType,
          'Date/Time': '',
          'Movement Type': '',
          'Source Type': '',
          'Source ID': '',
          Quantity: '',
          'Quantity In': summary.totalIn,
          'Quantity Out': summary.totalOut,
          'Net Quantity': summary.netQuantity,
          'Resulting Stock': summary.latestKnownStock,
          'Moved By': '',
          Branch: '',
          Supplier: '',
          Customer: '',
          'Payment Method': '',
          'Tender Method': '',
          Reference: '',
          Reason: '',
          Notes: '',
          'Movement ID': '',
          'Total Moves': summary.totalMoves
        });

        const detailRows = rowsByProduct.get(summary.productId) || [];
        detailRows.forEach((row) => {
          exportData.push({
            Section: 'MOVEMENT',
            'Product Name': row.productName,
            SKU: row.sku,
            Barcode: row.barcode,
            Unit: row.unitType,
            'Date/Time': new Date(row.movementAt).toLocaleString(),
            'Movement Type': row.movementType,
            'Source Type': row.sourceType || '',
            'Source ID': row.sourceId || '',
            Quantity: row.quantity,
            'Quantity In': row.quantityIn,
            'Quantity Out': row.quantityOut,
            'Net Quantity': row.netQuantity,
            'Resulting Stock': row.resultingStock,
            'Moved By': row.movedBy,
            Branch: row.branchName || row.branchCode,
            Supplier: row.supplierName,
            Customer: row.customerName,
            'Payment Method': row.paymentMethod,
            'Tender Method': row.tenderMethod,
            Reference: row.reference,
            Reason: row.reason,
            Notes: row.notes,
            'Movement ID': row.movementId,
            'Total Moves': ''
          });
        });
      });

      downloadCSV(
        exportData,
        `Product_Movement_${currentWindow.stamp}.csv`,
        `Product Movement Report (${currentWindow.label})`
      );
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Unable to generate product movement report');
    } finally {
      toast.dismiss(toastId);
      setIsPreparingMovementReport(false);
    }
  };

  const paymentData = [
    { name: 'Cash', value: filteredSales.filter((sale) => sale.paymentMethod === 'cash').length },
    { name: 'M-Pesa', value: filteredSales.filter((sale) => sale.paymentMethod === 'mpesa').length },
    { name: 'Card', value: filteredSales.filter((sale) => sale.paymentMethod === 'card').length },
    { name: 'Credit', value: filteredSales.filter((sale) => sale.paymentMethod === 'credit').length }
  ].filter((entry) => entry.value > 0);

  const COLORS = ['#4f46e5', '#10b981', '#f59e0b', '#ef4444'];

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Business Reports</h1>
          <p className="text-gray-500">Choose a reporting window, export CSVs, and track product movement in one place.</p>
        </div>
        <div className="flex gap-2">
          <div className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 rounded-lg text-sm font-medium text-gray-700">
            <Calendar className="w-4 h-4" />
            {selectedWindow ? selectedWindow.label : 'Invalid date range'}
          </div>
          <button
            onClick={exportSalesCSV}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 shadow-lg shadow-indigo-100"
          >
            <Download className="w-4 h-4" />
            Export Sales CSV
          </button>
        </div>
      </div>

      {reportLoadError && (
        <div className="rounded-3xl border border-red-200 bg-red-50 px-5 py-4 text-sm font-medium text-red-700">
          {reportLoadError}
        </div>
      )}

      <div className="bg-white rounded-4xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-8 border-b border-gray-50 flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Report Window</h2>
            <p className="text-sm text-gray-500">Switch between preset periods or define your own calendar range for CSV exports.</p>
          </div>
          <div className="flex flex-wrap gap-3">
            {([
              ['daily', 'Today'],
              ['weekly', 'Last 7 Days'],
              ['monthly', 'This Month'],
              ['custom', 'Custom Range']
            ] as Array<[ReportPeriod, string]>).map(([periodId, label]) => (
              <button
                key={periodId}
                onClick={() => setActivePeriod(periodId)}
                className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all ${
                  activePeriod === periodId
                    ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-100'
                    : 'bg-indigo-50 text-indigo-700 hover:bg-indigo-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="p-8 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-3xl border border-gray-100 bg-gray-50/70 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-gray-400">Start</p>
            <input
              type="date"
              value={activePeriod === 'custom' ? customStartDate : selectedWindow ? formatDateInput(selectedWindow.start) : customStartDate}
              onChange={(event) => setCustomStartDate(event.target.value)}
              disabled={activePeriod !== 'custom'}
              className="mt-3 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
            />
          </div>
          <div className="rounded-3xl border border-gray-100 bg-gray-50/70 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-gray-400">End</p>
            <input
              type="date"
              value={activePeriod === 'custom' ? customEndDate : selectedWindow ? formatDateInput(selectedWindow.end) : customEndDate}
              onChange={(event) => setCustomEndDate(event.target.value)}
              disabled={activePeriod !== 'custom'}
              className="mt-3 w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm font-semibold text-gray-900 outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-500"
            />
          </div>
          <div className="rounded-3xl border border-gray-100 bg-gray-50/70 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-gray-400">Window</p>
            <p className="mt-3 text-sm font-bold text-gray-900">{selectedWindow ? selectedWindow.label : 'Fix the custom dates to continue'}</p>
            <p className="mt-1 text-xs text-gray-500">Exports, profit view, payment charts, and recent sales all follow this range.</p>
          </div>
          <div className="rounded-3xl border border-gray-100 bg-indigo-50 px-5 py-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.25em] text-indigo-500">Export Focus</p>
            <p className="mt-3 text-sm font-bold text-indigo-900">Product movement now groups the same product together with every movement underneath it.</p>
            <p className="mt-1 text-xs text-indigo-700">You’ll see when it moved, how it moved, who moved it, and the related reference trail.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500 font-medium">Net Revenue</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">KES {totalRevenue.toLocaleString()}</p>
          <div className="mt-2 flex items-center text-green-600 text-sm font-medium">
            <span>{selectedWindow?.label || 'Invalid range'}</span>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500 font-medium">Transactions</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">{filteredSales.length}</p>
          <div className="mt-2 flex items-center text-blue-600 text-sm font-medium">
            <span>{filteredSales.length > 0 ? 'Within selected range' : 'No activity in this range'}</span>
          </div>
        </div>
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <p className="text-sm text-gray-500 font-medium">Average Sale</p>
          <p className="text-3xl font-bold text-gray-900 mt-1">KES {avgSale.toLocaleString(undefined, { maximumFractionDigits: 0 })}</p>
          <div className="mt-2 flex items-center text-indigo-600 text-sm font-medium">
            <span>Computed from the selected report window</span>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-4xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="p-8 border-b border-gray-50 flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bold text-gray-900">Advanced CSV Exports</h2>
            <p className="text-sm text-gray-500">Generate clean files for finance, stock control, and movement audits.</p>
          </div>
          <div className="rounded-full bg-indigo-50 px-4 py-2 text-xs font-bold uppercase tracking-[0.25em] text-indigo-700">
            {selectedWindow ? selectedWindow.label : 'Invalid range'}
          </div>
        </div>

        <div className="p-8">
          <div className="flex flex-wrap gap-4 mb-8">
            <button
              onClick={exportSalesCSV}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
            >
              <Download className="w-4 h-4" />
              Export Sales CSV
            </button>
            <button
              onClick={exportProductMovementCSV}
              disabled={isPreparingMovementReport}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100 disabled:cursor-not-allowed disabled:bg-indigo-300 disabled:shadow-none"
            >
              <Package className="w-4 h-4" />
              {isPreparingMovementReport ? 'Preparing Movement CSV...' : 'Export Product Movement CSV'}
            </button>
            <button
              onClick={exportInventoryCSV}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
            >
              <Package className="w-4 h-4" />
              Export Inventory Snapshot
            </button>
            <button
              onClick={exportExpensesCSV}
              className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
            >
              <FileText className="w-4 h-4" />
              Export Expenses CSV
            </button>
            {user?.role === 'superadmin' && (
              <button
                onClick={exportProfitCSV}
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
              >
                <DollarSign className="w-4 h-4" />
                Export Profit CSV
              </button>
            )}
            {user?.role === 'superadmin' && (
              <button
                onClick={exportProfitSummaryCSV}
                className="flex items-center gap-2 px-6 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-100"
              >
                <TrendingUp className="w-4 h-4" />
                Export Profit Summary CSV
              </button>
            )}
          </div>

          {user?.role === 'superadmin' && (
            <div className="bg-gray-50 rounded-3xl border border-gray-100 p-8 font-mono text-sm text-gray-800 mt-8">
              <h4 className="text-xs font-bold text-gray-400 uppercase tracking-widest mb-4">Profit Estimate</h4>
              <pre className="whitespace-pre-wrap">{JSON.stringify(profitStats, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-8 rounded-4xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-red-50 text-red-600 rounded-2xl">
                <Clock className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900">Debt Aging</h3>
                <p className="text-xs text-gray-500 font-medium">Outstanding balances by age</p>
              </div>
            </div>
          </div>
          <div className="h-75 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={debtAgingData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: '#9ca3af' }} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 600, fill: '#9ca3af' }} />
                <Tooltip
                  contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  cursor={{ fill: '#f9fafb' }}
                />
                <Bar dataKey="value" fill="#4f46e5" radius={[6, 6, 0, 0]} barSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-8 rounded-4xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="p-3 bg-amber-50 text-amber-600 rounded-2xl">
                <AlertTriangle className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-lg font-black text-gray-900">Low Stock Alert</h3>
                <p className="text-xs text-gray-500 font-medium">{lowStockProducts.length} items need restocking</p>
              </div>
            </div>
            <button onClick={exportInventoryCSV} className="p-2 hover:bg-gray-50 rounded-xl text-gray-400 transition-colors">
              <Download className="w-5 h-5" />
            </button>
          </div>
          <div className="space-y-4 max-h-75 overflow-y-auto pr-2 custom-scrollbar">
            {lowStockProducts.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-sm text-gray-400 font-medium">All stock levels are healthy</p>
              </div>
            ) : (
              lowStockProducts.map((product) => (
                <div
                  key={product.id}
                  className="flex items-center justify-between p-4 bg-gray-50 rounded-2xl border border-gray-100 group hover:border-amber-200 transition-all"
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center font-bold text-gray-400 text-xs shadow-sm group-hover:scale-110 transition-transform">
                      {product.name.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-gray-900">{product.name}</p>
                      <p className="text-[10px] text-gray-500 font-medium">SKU: {product.sku}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-red-600">
                      {product.stockQuantity} {product.unitType}
                    </p>
                    <p className="text-[10px] text-gray-400 font-bold uppercase tracking-widest">
                      Alert at {product.lowStockThreshold || 5}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100 min-w-0 min-h-0">
          <h3 className="font-bold text-gray-900 mb-6">Payment Methods</h3>
          <div className="h-75 w-full">
            {paymentData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%" minWidth={0} debounce={1}>
                <PieChart>
                  <Pie data={paymentData} cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value">
                    {paymentData.map((entry, index) => (
                      <Cell key={entry.name} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <p className="text-gray-400">No payment data in the selected range</p>
            )}
          </div>
          <div className="flex justify-center gap-6 mt-4 flex-wrap">
            {paymentData.map((entry, index) => (
              <div key={entry.name} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[index] }} />
                <span className="text-sm text-gray-600">{entry.name}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="bg-white p-6 rounded-2xl shadow-sm border border-gray-100">
          <h3 className="font-bold text-gray-900 mb-2">Recent Sales In Range</h3>
          <p className="text-xs text-gray-500 mb-6">{selectedWindow ? selectedWindow.label : 'Invalid date range'}</p>
          <div className="overflow-x-auto max-h-100 overflow-y-auto pr-2 custom-scrollbar">
            <table className="w-full text-left">
              <thead className="sticky top-0 bg-white z-10 shadow-sm text-xs text-gray-600 uppercase">
                <tr className="bg-gray-50/50">
                  <th className="pb-4">ID</th>
                  <th className="pb-4">Cashier</th>
                  <th className="pb-4">Amount</th>
                  <th className="pb-4">Method</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filteredSales.slice(0, 8).map((sale) => (
                  <tr key={sale.id} className="text-sm">
                    <td className="py-3 font-mono text-xs text-gray-500">#{sale.id.slice(-6)}</td>
                    <td className="py-3 font-medium">{sale.cashierName}</td>
                    <td className="py-3 font-bold">
                      <div className="flex flex-col">
                        <span>KES {(sale.totalAmount - (sale.refundAmount || 0)).toLocaleString()}</span>
                        {sale.refundAmount ? (
                          <span className="text-[10px] text-red-500 line-through">KES {sale.totalAmount.toLocaleString()}</span>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-3">
                      <span className="px-2 py-1 bg-gray-100 rounded text-[10px] font-bold uppercase">{sale.paymentMethod}</span>
                    </td>
                  </tr>
                ))}
                {filteredSales.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-10 text-center text-sm text-gray-400">
                      No sales found in the selected range.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
