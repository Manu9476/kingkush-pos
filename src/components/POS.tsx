import React, { useState, useEffect, useRef } from 'react';
import {
  db,
  collection,
  query,
  where,
  getDocs,
  onSnapshot,
  doc,
  getDoc,
  handleFirestoreError,
  OperationType,
  toDate
} from '../data';
import { Product, Sale, Customer, SystemSettings } from '../types';
import type { Branch } from '../types';
import { ShoppingCart, Trash2, Plus, Minus, CheckCircle, Printer, X, User as UserIcon, Shield } from 'lucide-react';
import { useAuth } from '../App';
import { toast } from 'sonner';
import ConfirmDialog from './ConfirmDialog';

import { isCashDrawerEnabled, saleUsesCashDrawer, triggerCashDrawer } from '../services/cashDrawer';
import { createSale, getShiftStatus } from '../services/platformApi';
import { formatSaleReceiptNumber } from '../utils/receipts';

export default function POS() {
  const { user } = useAuth();
  const [barcodeInput, setBarcodeInput] = useState('');
  const [cart, setCart] = useState<(Product & { quantity: number })[]>([]);
  const [paymentMethod, setPaymentMethod] = useState<'cash' | 'mpesa' | 'card' | 'credit'>('cash');
  const [amountPaid, setAmountPaid] = useState<number>(0);
  const [isProcessing, setIsProcessing] = useState(false);
  const [lastSale, setLastSale] = useState<Sale | null>(null);
  const [lastSaleItems, setLastSaleItems] = useState<(Product & { quantity: number })[]>([]);
  const [showReceipt, setShowReceipt] = useState(false);
  const [isScannerFocused, setIsScannerFocused] = useState(true);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [branches, setBranches] = useState<Branch[]>([]);
  const [currentShift, setCurrentShift] = useState<any | null>(null);
  const [shiftSummary, setShiftSummary] = useState<any | null>(null);
  
  const [allProducts, setAllProducts] = useState<Product[]>([]);
  const [allCustomers, setAllCustomers] = useState<Customer[]>([]);
  
  const [customerName, setCustomerName] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [customerBalance, setCustomerBalance] = useState<number>(0);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerSearchResults, setCustomerSearchResults] = useState<Customer[]>([]);
  const [showCustomerDropdown, setShowCustomerDropdown] = useState(false);
  const [reference, setReference] = useState('');
  const [depositMethod, setDepositMethod] = useState<'cash' | 'mpesa' | 'card'>('cash');
  const isManualAmountPaid = useRef(false);
  
  const [quickSearchQuery, setQuickSearchQuery] = useState('');
  const [quickSearchResults, setQuickSearchResults] = useState<Product[]>([]);

  // Confirm Dialog State
  const [confirmConfig, setConfirmConfig] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
    type?: 'danger' | 'warning' | 'info';
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {},
  });
  
  const inputRef = useRef<HTMLInputElement>(null);
  const quickSearchRef = useRef<HTMLDivElement>(null);
  const customerSearchRef = useRef<HTMLDivElement>(null);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const lastDrawerTriggerSaleId = useRef<string | null>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (quickSearchRef.current && !quickSearchRef.current.contains(event.target as Node)) {
        setQuickSearchResults([]);
      }
      if (customerSearchRef.current && !customerSearchRef.current.contains(event.target as Node)) {
        setShowCustomerDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const settingsDoc = await getDoc(doc(db, 'settings', 'system'));
        if (settingsDoc.exists()) {
          setSettings(settingsDoc.data() as SystemSettings);
        }
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Error fetching settings:', error);
        }
      }
    };
    fetchSettings();
  }, []);

  useEffect(() => {
    const refreshShiftStatus = async () => {
      try {
        const payload = await getShiftStatus();
        setCurrentShift(payload.shift);
        setShiftSummary(payload.summary);
      } catch (error) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Error fetching current shift:', error);
        }
        setCurrentShift(null);
        setShiftSummary(null);
      }
    };

    void refreshShiftStatus();
    const intervalId = window.setInterval(refreshShiftStatus, 10000);
    return () => window.clearInterval(intervalId);
  }, []);

  useEffect(() => {
    if (!user) return;

    const unsubProducts = onSnapshot(collection(db, 'products'), 
      (snapshot) => {
        setAllProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product)));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'products')
    );
    const unsubCustomers = onSnapshot(collection(db, 'customers'), 
      (snapshot) => {
        setAllCustomers(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Customer)));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'customers')
    );
    const unsubBranches = onSnapshot(collection(db, 'branches'),
      (snapshot) => {
        setBranches(snapshot.docs.map((entry) => ({ id: entry.id, ...entry.data() } as Branch)));
      },
      (err) => handleFirestoreError(err, OperationType.LIST, 'branches')
    );
    return () => {
      unsubProducts();
      unsubCustomers();
      unsubBranches();
    };
  }, [user]);

  useEffect(() => {
    const queryText = customerSearchQuery.trim().toLowerCase();
    if (queryText.length < 1) {
      setCustomerSearchResults([]);
      return;
    }

    const results = allCustomers.filter(c => 
      c.name.toLowerCase().includes(queryText) ||
      c.customerCode?.toLowerCase().includes(queryText) ||
      c.phone?.includes(queryText) ||
      c.email?.toLowerCase().includes(queryText)
    ).slice(0, 5);
    
    setCustomerSearchResults(results);
  }, [customerSearchQuery, allCustomers]);

  useEffect(() => {
    const fetchCustomerBalance = async () => {
      if (!customerId) {
        setCustomerBalance(0);
        return;
      }

      try {
        const q = query(
          collection(db, 'credits'),
          where('customerId', '==', customerId),
          where('status', '==', 'open')
        );
        const snapshot = await getDocs(q);
        const balance = snapshot.docs.reduce((sum, doc) => sum + (doc.data().outstandingBalance || 0), 0);
        setCustomerBalance(balance);
      } catch (error) {
        console.error('Error fetching customer balance:', error);
      }
    };

    fetchCustomerBalance();
  }, [customerId]);

  useEffect(() => {
    const queryText = quickSearchQuery.trim().toLowerCase();
    if (queryText.length < 1) {
      setQuickSearchResults([]);
      return;
    }

    const results = allProducts.filter(p => 
      p.name.toLowerCase().includes(queryText) ||
      p.sku.toLowerCase().includes(queryText) ||
      p.barcode.toLowerCase().includes(queryText)
    ).slice(0, 10);
    
    setQuickSearchResults(results);
  }, [quickSearchQuery, allProducts]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      // Keyboard Shortcuts
      if (e.key === 'F9') {
        e.preventDefault();
        handleCheckout();
      } else if (e.key === 'F2') {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'F4') {
        e.preventDefault();
        customerInputRef.current?.focus();
      } else if (e.key === 'Escape') {
        if (showReceipt) {
          setShowReceipt(false);
        } else if (cart.length > 0) {
          setConfirmConfig({
            isOpen: true,
            title: 'Clear Cart',
            message: 'Are you sure you want to clear the current cart?',
            onConfirm: () => setCart([]),
            type: 'danger'
          });
        }
      }

      // If we're not in an input, redirect focus to barcode input
      const target = e.target as HTMLElement;
      const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
      
      // Redirect to scanner if not in an input and it's a printable character or scanner prefix
      if (!isInput && e.key.length === 1) {
        inputRef.current?.focus();
      }
    };

    const handleFocus = () => setIsScannerFocused(true);
    const handleBlur = () => {
      setIsScannerFocused(false);
      window.setTimeout(() => {
        if (
          settings?.barcodeAutofocus !== false &&
          document.activeElement === document.body &&
          !showReceipt
        ) {
          inputRef.current?.focus();
        }
      }, 120);
    };

    const input = inputRef.current;
    if (input) {
      input.addEventListener('focus', handleFocus);
      input.addEventListener('blur', handleBlur);
    }

    window.addEventListener('keydown', handleGlobalKeyDown);
    return () => {
      window.removeEventListener('keydown', handleGlobalKeyDown);
      if (input) {
        input.removeEventListener('focus', handleFocus);
        input.removeEventListener('blur', handleBlur);
      }
    };
  }, [settings?.barcodeAutofocus, showReceipt]);

  useEffect(() => {
    if (settings?.barcodeAutofocus === false || showReceipt) {
      return;
    }
    inputRef.current?.focus();
  }, [settings?.barcodeAutofocus, showReceipt]);

  const processBarcodeValue = (rawValue: string) => {
    if (!rawValue.trim()) return;

    let input = rawValue.trim();
    let multiplier = 1;

    // Handle quantity multiplier (e.g., 5*barcode)
    if (input.includes('*')) {
      const parts = input.split('*');
      multiplier = parseInt(parts[0]) || 1;
      input = parts[1] || '';
    }

    const queryText = input.toLowerCase();
    
    // Try barcode first
    let product = allProducts.find(p => p.barcode.toLowerCase() === queryText);
    
    // If not found by barcode, try SKU
    if (!product) {
      product = allProducts.find(p => p.sku.toLowerCase() === queryText);
    }

    // If still not found, try Name (exact match)
    if (!product) {
      product = allProducts.find(p => p.name.toLowerCase() === queryText);
    }
    
    if (!product) {
      toast.error('Product not found!');
    } else {
      if (product.stockQuantity <= 0) {
        toast.error('Out of stock!');
        setBarcodeInput('');
        return;
      }
      addToCart(product, multiplier);
    }
    setBarcodeInput('');
  };

  const handleScan = (e: React.FormEvent) => {
    e.preventDefault();
    processBarcodeValue(barcodeInput);
  };

  useEffect(() => {
    const trimmed = barcodeInput.trim();
    const submitDelay = Math.max(60, Number(settings?.barcodeSubmitDelayMs ?? 120));
    const shouldAutoSubmit = trimmed.length >= 5 || trimmed.includes('*');

    if (!shouldAutoSubmit || showReceipt) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      processBarcodeValue(trimmed);
    }, submitDelay);

    return () => window.clearTimeout(timeoutId);
  }, [barcodeInput, settings?.barcodeSubmitDelayMs, showReceipt, allProducts]);

  const addToCart = (product: Product, quantity: number = 1) => {
    setCart(prev => {
      const existing = prev.find(item => item.id === product.id);
      if (existing) {
        const totalQty = existing.quantity + quantity;
        if (totalQty > product.stockQuantity) {
          toast.warning(`Only ${product.stockQuantity} items available in stock!`);
          return prev;
        }
        return prev.map(item => 
          item.id === product.id ? { ...item, quantity: totalQty } : item
        );
      }
      if (quantity > product.stockQuantity) {
        toast.warning(`Only ${product.stockQuantity} items available in stock!`);
        return prev;
      }
      return [...prev, { ...product, quantity }];
    });
  };

  const removeFromCart = (productId: string) => {
    setCart(prev => prev.filter(item => item.id !== productId));
  };

  const updateQuantity = (productId: string, delta: number) => {
    setCart(prev => prev.map(item => {
      if (item.id === productId) {
        const newQty = item.quantity + delta;
        if (newQty > 0 && newQty <= item.stockQuantity) {
          return { ...item, quantity: newQty };
        }
      }
      return item;
    }));
  };

  const setQuantity = (productId: string, value: string) => {
    const newQty = parseInt(value);
    if (isNaN(newQty)) return;
    
    setCart(prev => prev.map(item => {
      if (item.id === productId) {
        if (newQty > 0 && newQty <= item.stockQuantity) {
          return { ...item, quantity: newQty };
        } else if (newQty > item.stockQuantity) {
          toast.warning(`Only ${item.stockQuantity} items available in stock!`);
          return { ...item, quantity: item.stockQuantity };
        }
      }
      return item;
    }));
  };

  const subtotal = cart.reduce((sum, item) => sum + (item.sellingPrice * item.quantity), 0);
  const taxRate = settings?.taxRate || 0;
  const total = subtotal;
  const taxAmount = (total * taxRate) / 100;
  const checkoutCreditAmount = Math.max(total - amountPaid, 0);
  const currentBranchName = branches.find((branch) => branch.id === (currentShift?.branchId || settings?.defaultBranchId))?.name || 'Main Branch';
  const receiptPaymentLabel = (sale: Sale) => {
    const hasCreditBalance = Boolean(sale.isCredit || (sale.outstandingBalance || 0) > 0);
    if (hasCreditBalance && sale.amountPaid > 0 && sale.tenderMethod && sale.tenderMethod !== 'credit') {
      return `${(sale.tenderMethod || 'cash').toUpperCase()} + CREDIT`;
    }
    if (hasCreditBalance) {
      return 'CREDIT';
    }
    return (sale.tenderMethod || sale.paymentMethod).toUpperCase();
  };

  useEffect(() => {
    // Reset manual flag when cart is cleared
    if (cart.length === 0) {
      isManualAmountPaid.current = false;
    }
  }, [cart.length]);

  useEffect(() => {
    // Auto-fill amount paid ONLY if the user hasn't manually changed it
    // and we are not in credit mode (where 0 is a common starting point)
    if (!isManualAmountPaid.current && paymentMethod !== 'credit' && total > 0) {
      setAmountPaid(total);
    }
  }, [paymentMethod, total]);

  useEffect(() => {
    if (!showReceipt || !lastSale || !settings?.receiptAutoPrint) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      window.print();
    }, 350);

    return () => window.clearTimeout(timeoutId);
  }, [showReceipt, lastSale, settings?.receiptAutoPrint]);

  useEffect(() => {
    if (
      !showReceipt ||
      !lastSale ||
      !settings ||
      !settings.drawerEnabled ||
      !settings.drawerAutoOpenOnCashSale ||
      !saleUsesCashDrawer(lastSale)
    ) {
      return;
    }

    if (lastDrawerTriggerSaleId.current === lastSale.id) {
      return;
    }

    lastDrawerTriggerSaleId.current = lastSale.id;

    void triggerCashDrawer(settings, {
      eventType: 'sale',
      saleId: lastSale.id,
      amount: lastSale.amountPaid,
      paymentMethod: lastSale.tenderMethod || lastSale.paymentMethod,
      reference: lastSale.reference,
      suppressFailureToast: false
    }).catch(() => {
      // The helper service already reports a user-facing error message.
    });
  }, [
    showReceipt,
    lastSale,
    settings,
    settings?.drawerEnabled,
    settings?.drawerAutoOpenOnCashSale,
    settings?.drawerHelperUrl
  ]);

  const handleManualDrawerOpen = async () => {
    if (!settings) {
      return;
    }

    try {
      await triggerCashDrawer(settings, {
        eventType: 'manual',
        saleId: lastSale?.id,
        amount: lastSale?.amountPaid,
        paymentMethod: lastSale ? (lastSale.tenderMethod || lastSale.paymentMethod) : paymentMethod,
        reference: lastSale?.reference || reference,
        announceSuccess: true
      });
    } catch {
      // The helper service already reports a user-facing error message.
    }
  };

  const handleCheckout = async () => {
    if (cart.length === 0) return;
    if (!currentShift) {
      toast.error('Open a cashier shift before completing sales.');
      return;
    }
    if (isNaN(amountPaid) || amountPaid < 0) {
      toast.error('Please enter a valid amount paid.');
      return;
    }

    if (checkoutCreditAmount > 0 && !customerId && !customerName.trim()) {
      toast.error('Select or enter the customer taking the credit before completing checkout.');
      return;
    }

    const processCheckout = async () => {
      setIsProcessing(true);
      try {
        const response = await createSale({
          items: cart.map((item) => ({
            id: item.id,
            name: item.name,
            barcode: item.barcode,
            quantity: item.quantity,
            sellingPrice: item.sellingPrice
          })),
          paymentMethod,
          tenderMethod: paymentMethod === 'credit' ? (amountPaid > 0 ? depositMethod : 'credit') : paymentMethod,
          amountPaid: amountPaid || 0,
          customerId: customerId && customerId.trim() !== '' ? customerId : undefined,
          customerName: (customerName || '').trim(),
          reference: (reference || '').trim()
        });

        const saleData = response.sale as Sale & { newTotalBalance?: number };
        setLastSale({ 
          ...saleData,
          timestamp: toDate(saleData.timestamp)
        } as Sale & { newTotalBalance?: number });
      setLastSaleItems([...cart]);
      setShowReceipt(true);
      setCart([]);
      setAmountPaid(0);
      isManualAmountPaid.current = false;
      setCustomerName('');
      setCustomerId('');
      setCustomerBalance(0);
      setCustomerSearchQuery('');
      setDepositMethod('cash');
      } catch (error) {
        handleFirestoreError(error, OperationType.WRITE, 'sales');
      } finally {
        setIsProcessing(false);
      }
    };

    if (cart.length > 10 || total > 5000) {
      setConfirmConfig({
        isOpen: true,
        title: 'Confirm Checkout',
        message: `Are you sure you want to complete this checkout for KES ${total.toLocaleString()}?`,
        onConfirm: processCheckout,
        type: 'info'
      });
    } else {
      processCheckout();
    }
  };

  return (
    <div className="max-w-6xl mx-auto space-y-8">
      <ConfirmDialog
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
        type={confirmConfig.type}
      />
      <div className="flex flex-col gap-1">
        <p className="text-sm text-indigo-600 font-medium">Fast checkout workflow with scanner-first input and real-time totals.</p>
        <h1 className="text-2xl font-bold text-gray-900">New Sale</h1>
      </div>

      <div className={`rounded-3xl border px-6 py-5 ${currentShift ? 'border-emerald-100 bg-emerald-50' : 'border-amber-100 bg-amber-50'}`}>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className={`text-xs font-bold uppercase tracking-[0.24em] ${currentShift ? 'text-emerald-700' : 'text-amber-700'}`}>
              {currentShift ? 'Cashier Shift Active' : 'Shift Required'}
            </p>
            <p className={`mt-2 text-sm font-semibold ${currentShift ? 'text-emerald-900' : 'text-amber-900'}`}>
              {currentShift
                ? `${currentBranchName} • Expected drawer cash KES ${(shiftSummary?.expectedCash || currentShift.openingFloat || 0).toLocaleString()}`
                : 'Open a cashier shift from the Cash Shifts page before processing sales.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => window.location.assign('/cash-shifts')}
            className={`inline-flex items-center justify-center rounded-2xl px-4 py-3 text-sm font-bold transition-all ${currentShift ? 'bg-white text-emerald-700 hover:bg-emerald-100' : 'bg-amber-600 text-white hover:bg-amber-700'}`}
          >
            {currentShift ? 'View Shift Controls' : 'Open Shift Controls'}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 items-start">
        {/* Left: Sale Details */}
        <div className="lg:col-span-2 space-y-8">
          <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 space-y-8">
            <div className="flex justify-between items-center">
              <h2 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
                <ShoppingCart className="w-6 h-6 text-indigo-600" />
                Current Cart
              </h2>
              <div className="flex items-center gap-4">
                {cart.length > 0 && (
                  <button 
                    onClick={() => setConfirmConfig({
                      isOpen: true,
                      title: 'Clear Cart',
                      message: 'Are you sure you want to clear the current cart?',
                      onConfirm: () => setCart([]),
                      type: 'danger'
                    })}
                    className="text-xs font-bold text-red-500 hover:text-red-600 flex items-center gap-1"
                  >
                    <Trash2 className="w-3 h-3" /> Clear
                  </button>
                )}
              </div>
            </div>
          
          <div className="space-y-6">
            <form onSubmit={handleScan} className="space-y-2">
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium text-gray-600">Scan Barcode</label>
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${isScannerFocused ? 'bg-green-500 animate-pulse' : 'bg-gray-300'}`} />
                  <span className={`text-xs font-bold ${isScannerFocused ? 'text-green-600' : 'text-gray-400'}`}>
                    {isScannerFocused ? 'Scanner Ready' : 'Scanner Inactive - Click to Focus'}
                  </span>
                </div>
              </div>
              <div className="relative">
                <input 
                  ref={inputRef}
                  type="text"
                  value={barcodeInput}
                  onChange={(e) => setBarcodeInput(e.target.value)}
                  placeholder="Scan or type barcode, then press Enter"
                  className={`w-full px-4 py-4 bg-gray-50 border-2 rounded-2xl outline-none transition-all placeholder:text-gray-400 text-lg font-mono ${
                    isScannerFocused ? 'border-indigo-500 ring-4 ring-indigo-50' : 'border-gray-200'
                  }`}
                />
                <div className="absolute right-4 top-1/2 -translate-y-1/2 flex items-center gap-2">
                </div>
              </div>
              <p className="text-xs text-gray-500 flex items-center gap-1">
                <Shield className="w-3 h-3" />
                Hardware scanners in keyboard mode will auto-submit.
              </p>
            </form>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-600">Quick Add (No Barcode Label)</label>
              <div className="relative" ref={quickSearchRef}>
                <div className="relative">
                  <input 
                    type="text"
                    value={quickSearchQuery}
                    onChange={(e) => setQuickSearchQuery(e.target.value)}
                    placeholder="Type product name or SKU (e.g. cigarette, sweet)"
                    className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition-all placeholder:text-gray-500"
                  />
                </div>

                {quickSearchResults.length > 0 && (
                  <div className="absolute z-10 w-full mt-2 bg-white border border-gray-100 rounded-xl shadow-xl overflow-hidden">
                    {quickSearchResults.map(product => (
                      <button
                        key={product.id}
                        onClick={() => {
                          addToCart(product);
                          setQuickSearchQuery('');
                          setQuickSearchResults([]);
                        }}
                        className="w-full px-4 py-3 text-left hover:bg-gray-50 flex justify-between items-center group transition-colors"
                      >
                        <div>
                          <p className="font-bold text-gray-900 group-hover:text-indigo-600">{product.name}</p>
                          <p className="text-xs text-gray-500">{product.sku}</p>
                        </div>
                        <div className="text-right">
                          <p className="font-bold text-gray-900">KES {product.sellingPrice.toLocaleString()}</p>
                          <p className={`text-[10px] font-bold uppercase ${product.stockQuantity < 10 ? 'text-red-500' : 'text-green-500'}`}>
                            {product.stockQuantity} in stock
                          </p>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <p className="text-xs text-gray-500">Use this for small items that are hard to label. Checkout still deducts inventory.</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="grid grid-cols-12 gap-4 pb-2 border-b border-gray-100 text-[10px] font-bold text-gray-600 uppercase tracking-widest">
              <div className="col-span-6">ITEM</div>
              <div className="col-span-2 text-center">QTY</div>
              <div className="col-span-2 text-right">PRICE</div>
              <div className="col-span-2 text-right">TOTAL</div>
            </div>

            <div className="space-y-4 min-h-50">
              {cart.length === 0 ? (
                <p className="text-gray-600 py-8 text-center font-medium">Cart is empty — scan a product to begin.</p>
              ) : (
                cart.map(item => (
                  <div key={item.id} className="grid grid-cols-12 gap-4 items-center group bg-gray-50/50 p-2 rounded-xl border border-transparent hover:border-indigo-100 transition-all">
                    <div className="col-span-5">
                      <h3 className="font-bold text-gray-900 truncate">{item.name}</h3>
                      <p className="text-[10px] text-gray-500">{item.sku}</p>
                    </div>
                    <div className="col-span-3 flex justify-center">
                      <div className="flex items-center gap-1">
                        <button onClick={() => updateQuantity(item.id, -1)} className="p-1 hover:bg-white rounded text-gray-500 shadow-sm border border-gray-100"><Minus className="w-3 h-3" /></button>
                        <input 
                          type="number"
                          value={item.quantity}
                          onChange={(e) => setQuantity(item.id, e.target.value)}
                          className="w-10 text-center text-sm font-bold bg-white border border-gray-200 rounded outline-none focus:ring-1 focus:ring-indigo-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                        />
                        <button onClick={() => updateQuantity(item.id, 1)} className="p-1 hover:bg-white rounded text-gray-500 shadow-sm border border-gray-100"><Plus className="w-3 h-3" /></button>
                      </div>
                    </div>
                    <div className="col-span-2 text-right text-sm font-bold text-gray-900">
                      {(item.sellingPrice * item.quantity).toLocaleString()}
                    </div>
                    <div className="col-span-2 flex justify-end">
                      <button 
                        onClick={() => removeFromCart(item.id)}
                        className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
                        title="Remove item"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>

        {/* Right: Checkout Panel */}
        <div className="bg-white rounded-3xl p-8 shadow-sm border border-gray-100 space-y-8">
          <h2 className="text-3xl font-bold text-gray-900">Checkout</h2>

          <div className="space-y-2">
            <div className="flex justify-between text-gray-600">
              <span className="text-lg">Subtotal: KES {subtotal.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-gray-600">
              <span className="text-lg">VAT ({taxRate}%): KES {taxAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between text-2xl font-bold text-gray-900 pt-2 border-t border-gray-100">
              <span>Total: <span className="text-indigo-600">KES {total.toLocaleString()}</span></span>
            </div>
          </div>

          <div className="space-y-6">
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Payment Method</label>
              <select 
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value as any)}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-gray-700"
              >
                <option value="cash">Cash</option>
                <option value="mpesa">M-Pesa</option>
                <option value="card">Card</option>
                {(user?.role === 'superadmin' || user?.permissions?.includes('credits')) && (
                  <option value="credit">Credit</option>
                )}
              </select>
            </div>

            {paymentMethod === 'credit' && amountPaid > 0 && (
              <div className="space-y-2">
                <label className="text-sm font-medium text-gray-700">Deposit Method</label>
                <select
                  value={depositMethod}
                  onChange={(e) => setDepositMethod(e.target.value as 'cash' | 'mpesa' | 'card')}
                  className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none text-gray-700"
                >
                  <option value="cash">Cash</option>
                  <option value="mpesa">M-Pesa</option>
                  <option value="card">Card</option>
                </select>
              </div>
            )}

            {checkoutCreditAmount > 0 && (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-amber-700">Credit Detected</p>
                <p className="mt-2 font-semibold">
                  KES {checkoutCreditAmount.toLocaleString()} will be recorded as customer credit and tracked across the system.
                </p>
              </div>
            )}

            <div className="space-y-2 relative" ref={customerSearchRef}>
              <div className="flex justify-between items-center">
                <label className="text-sm font-medium text-gray-700">
                  Customer Search {checkoutCreditAmount > 0 && <span className="text-amber-600">(required for credit)</span>}
                </label>
                {customerId && (
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-bold px-2 py-1 rounded-lg ${customerBalance > 0 ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                      Balance: KES {customerBalance.toLocaleString()}
                    </span>
                    <button 
                      onClick={() => {
                        setCustomerId('');
                        setCustomerName('');
                        setCustomerSearchQuery('');
                        setCustomerBalance(0);
                      }}
                      className="p-1 hover:bg-gray-100 rounded-full text-gray-400 hover:text-red-500 transition-colors"
                      title="Clear customer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                )}
              </div>
              <div className="relative">
                <UserIcon className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <input 
                  ref={customerInputRef}
                  type="text"
                  value={customerSearchQuery}
                  onChange={(e) => {
                    setCustomerSearchQuery(e.target.value);
                    setShowCustomerDropdown(true);
                  }}
                  onFocus={() => setShowCustomerDropdown(true)}
                  placeholder="Search customer by name, code or phone..."
                  className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none placeholder:text-gray-500 text-sm"
                />
              </div>

              {showCustomerDropdown && customerSearchResults.length > 0 && (
                <div className="absolute z-50 left-0 right-0 mt-1 bg-white border border-gray-100 rounded-xl shadow-xl max-h-48 overflow-y-auto">
                  {customerSearchResults.map(customer => (
                    <button
                      key={customer.id}
                      onClick={() => {
                        setCustomerName(customer.name);
                        setCustomerId(customer.id);
                        setCustomerSearchQuery(customer.name);
                        setShowCustomerDropdown(false);
                      }}
                      className="w-full px-4 py-3 text-left hover:bg-indigo-50 flex items-center gap-3 transition-colors border-b border-gray-50 last:border-0"
                    >
                      <div className="w-8 h-8 bg-indigo-100 text-indigo-600 rounded-lg flex items-center justify-center font-bold text-xs">
                        {customer.name.charAt(0).toUpperCase()}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold text-gray-900">{customer.name}</p>
                          {customer.customerCode && (
                            <span className="text-[10px] font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-500">
                              {customer.customerCode}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-500">
                          {customer.phone || 'No phone'} {customer.address ? `• ${customer.address}` : ''}
                        </p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Customer Name (Manual/Selected)</label>
              <input 
                type="text"
                value={customerName}
                onChange={(e) => {
                  setCustomerName(e.target.value);
                  setCustomerId('');
                }}
                placeholder="e.g. Jane Njeri"
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none placeholder:text-gray-500"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Amount Paid / Deposit</label>
              <input 
                type="number"
                value={amountPaid === 0 ? '' : amountPaid}
                onChange={(e) => {
                  const val = e.target.value === '' ? 0 : parseFloat(e.target.value);
                  setAmountPaid(val);
                  isManualAmountPaid.current = true;
                }}
                onFocus={(e) => e.target.select()}
                autoComplete="off"
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none font-bold text-lg"
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">Reference (optional)</label>
              <input 
                type="text"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                className="w-full p-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none"
              />
            </div>

            <button 
              onClick={handleCheckout}
              disabled={isProcessing || cart.length === 0 || !currentShift}
              className="w-full py-4 bg-indigo-600 hover:bg-indigo-700 disabled:bg-gray-400 text-white rounded-xl font-bold text-lg transition-all flex items-center justify-center gap-2 shadow-lg shadow-indigo-200"
            >
              {isProcessing ? (
                <div className="w-6 h-6 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                'Complete Checkout'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Receipt Modal */}
      {showReceipt && lastSale && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl flex flex-col max-h-[90vh]">
            <div className="p-4 bg-indigo-600 text-white flex justify-between items-center shrink-0">
              <h3 className="font-bold">Sale Completed</h3>
              <button onClick={() => setShowReceipt(false)} className="p-1 hover:bg-white/20 rounded">
                <X className="w-5 h-5" />
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
              <div className="text-center">
                <div className="w-12 h-12 bg-green-100 text-green-600 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle className="w-8 h-8" />
                </div>
                <h2 className="text-xl font-bold text-gray-900">KES {lastSale.totalAmount.toLocaleString()}</h2>
                <p className="text-xs text-gray-500">Receipt #: {formatSaleReceiptNumber(lastSale.id)}</p>
              </div>

              {/* Receipt Preview */}
              <div className="bg-gray-50 p-4 rounded-xl border border-gray-100 font-mono text-[10px] space-y-2 max-w-75 mx-auto shadow-inner">
                <div className="text-center border-b border-dashed border-gray-300 pb-2 mb-2">
                  <h4 className="font-bold text-sm uppercase">{settings?.businessName || 'KingKush Sale'}</h4>
                  {currentBranchName && <p>{currentBranchName}</p>}
                  {settings?.storeAddress && <p>{settings.storeAddress}</p>}
                  {settings?.storePhone && <p>Tel: {settings.storePhone}</p>}
                </div>
                
                <div className="flex justify-between">
                  <span>Date: {toDate(lastSale.timestamp).toLocaleDateString()}</span>
                  <span>Time: {toDate(lastSale.timestamp).toLocaleTimeString()}</span>
                </div>
                <p>Receipt #: {formatSaleReceiptNumber(lastSale.id)}</p>
                {lastSale.shiftId && <p>Shift: {lastSale.shiftId.slice(-6).toUpperCase()}</p>}
                <p>Cashier: {lastSale.cashierName}</p>
                {lastSale.customerName && <p>Customer: {lastSale.customerName}</p>}
                
                <div className="border-y border-dashed border-gray-300 py-2 my-2">
                  <div className="flex justify-between font-bold mb-1">
                    <span className="w-1/2">ITEM</span>
                    <span className="w-1/4 text-right">QTY</span>
                    <span className="w-1/4 text-right">TOTAL</span>
                  </div>
                  {lastSaleItems.map((item, idx) => (
                    <div key={idx} className="flex justify-between">
                      <span className="w-1/2 truncate">{item.name}</span>
                      <span className="w-1/4 text-right">{item.quantity}</span>
                      <span className="w-1/4 text-right">{(item.sellingPrice * item.quantity).toLocaleString()}</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-1">
                  <div className="flex justify-between">
                    <span>SUBTOTAL</span>
                    <span>KES {lastSale.totalAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>VAT ({settings?.taxRate || 0}%)</span>
                    <span>KES {(lastSale.taxAmount || 0).toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between font-bold text-xs border-t border-dashed border-gray-300 pt-1">
                    <span>TOTAL</span>
                    <span>KES {lastSale.totalAmount.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>PAYMENT ({receiptPaymentLabel(lastSale)})</span>
                    <span>KES {lastSale.amountPaid.toLocaleString()}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>CHANGE</span>
                    <span>KES {lastSale.balance.toLocaleString()}</span>
                  </div>
                  {(lastSale.outstandingBalance || 0) > 0 && (
                    <div className="flex justify-between font-bold text-amber-700 border-t border-dashed border-gray-300 pt-1 mt-1">
                      <span>CREDIT AMOUNT</span>
                      <span>KES {(lastSale.outstandingBalance || 0).toLocaleString()}</span>
                    </div>
                  )}
                  {settings?.loyaltyPointRate && (
                    <div className="flex justify-between text-indigo-600 border-t border-dashed border-gray-300 pt-1 mt-1">
                      <span>POINTS EARNED</span>
                      <span>{Math.floor(lastSale.totalAmount / settings.loyaltyPointRate)}</span>
                    </div>
                  )}
                  {(lastSale.newTotalBalance !== undefined && lastSale.newTotalBalance > 0) && (
                    <div className="flex justify-between font-bold text-red-600 border-t border-dashed border-gray-300 pt-1 mt-1">
                      <span>TOTAL OUTSTANDING</span>
                      <span>KES {lastSale.newTotalBalance.toLocaleString()}</span>
                    </div>
                  )}
                </div>

                <div className="text-center border-t border-dashed border-gray-300 pt-2 mt-4">
                  <p className="font-bold text-xs mb-1 uppercase">{settings?.receiptHeader || 'Thank you for shopping with us!'}</p>
                  <p>{settings?.receiptFooter || 'Goods once sold are not returnable.'}</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-4">
                {isCashDrawerEnabled(settings) && (
                  <button
                    onClick={() => void handleManualDrawerOpen()}
                    className="w-full py-3 border border-indigo-200 rounded-xl font-bold text-indigo-700 hover:bg-indigo-50 transition-all"
                  >
                    Open Cash Drawer
                  </button>
                )}
                <button 
                  onClick={() => window.print()}
                  className="w-full py-4 bg-indigo-600 text-white rounded-xl font-bold text-lg shadow-lg shadow-indigo-200 flex items-center justify-center gap-2 hover:bg-indigo-700 transition-all"
                >
                  <Printer className="w-6 h-6" />
                  Print Receipt
                </button>
                <button 
                  onClick={() => setShowReceipt(false)}
                  className="w-full py-3 border border-gray-200 rounded-xl font-medium text-gray-600 hover:bg-gray-50 transition-all"
                >
                  New Sale
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Hidden Thermal Receipt for Printing */}
      {showReceipt && lastSale && (
        <div id="thermal-receipt" className="hidden print:block font-mono text-[12px] leading-tight p-4 w-[80mm]">
          <div className="text-center mb-4">
            <h1 className="font-bold text-lg uppercase">{settings?.businessName || 'KingKush Sale'}</h1>
            {currentBranchName && <p>{currentBranchName}</p>}
            {settings?.storeAddress && <p>{settings.storeAddress}</p>}
            {settings?.storePhone && <p>Tel: {settings.storePhone}</p>}
            <p className="mt-2">********************************</p>
          </div>
          
          <div className="mb-2">
            <div className="flex justify-between">
              <span>DATE: {toDate(lastSale.timestamp).toLocaleDateString()}</span>
              <span>TIME: {toDate(lastSale.timestamp).toLocaleTimeString()}</span>
            </div>
            <p>RECEIPT #: {formatSaleReceiptNumber(lastSale.id)}</p>
            {lastSale.shiftId && <p>SHIFT: {lastSale.shiftId.toUpperCase()}</p>}
            <p>CASHIER: {lastSale.cashierName.toUpperCase()}</p>
            {lastSale.customerName && <p>CUSTOMER: {lastSale.customerName.toUpperCase()}</p>}
            <p>********************************</p>
          </div>

          <div className="mb-4">
            <div className="flex justify-between font-bold mb-1">
              <span className="w-[45%]">ITEM</span>
              <span className="w-[15%] text-right">QTY</span>
              <span className="w-[20%] text-right">PRICE</span>
              <span className="w-[20%] text-right">TOTAL</span>
            </div>
            {lastSaleItems.map((item, idx) => (
              <div key={idx} className="flex justify-between mb-1">
                <span className="w-[45%] wrap-break-word">{item.name.toUpperCase()}</span>
                <span className="w-[15%] text-right">{item.quantity}</span>
                <span className="w-[20%] text-right">{item.sellingPrice.toLocaleString()}</span>
                <span className="w-[20%] text-right">{(item.sellingPrice * item.quantity).toLocaleString()}</span>
              </div>
            ))}
            <p>********************************</p>
          </div>

          <div className="space-y-1 mb-6">
            <div className="flex justify-between">
              <span>SUBTOTAL</span>
              <span>KES {lastSale.totalAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>VAT ({settings?.taxRate || 0}%)</span>
              <span>KES {(lastSale.taxAmount || 0).toLocaleString()}</span>
            </div>
            <div className="flex justify-between font-bold text-base border-t border-dashed border-gray-300 pt-1 mt-1">
              <span>TOTAL AMOUNT</span>
              <span>KES {lastSale.totalAmount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>PAYMENT ({receiptPaymentLabel(lastSale)})</span>
              <span>KES {lastSale.amountPaid.toLocaleString()}</span>
            </div>
            <div className="flex justify-between">
              <span>CHANGE</span>
              <span>KES {lastSale.balance.toLocaleString()}</span>
            </div>
            {(lastSale.outstandingBalance || 0) > 0 && (
              <div className="flex justify-between font-bold border-t border-dashed border-gray-300 pt-1 mt-1">
                <span>CREDIT AMOUNT</span>
                <span>KES {(lastSale.outstandingBalance || 0).toLocaleString()}</span>
              </div>
            )}
            {(lastSale.newTotalBalance !== undefined && lastSale.newTotalBalance > 0) && (
              <div className="flex justify-between font-bold border-t border-dashed border-gray-300 pt-1 mt-1">
                <span>TOTAL OUTSTANDING</span>
                <span>KES {lastSale.newTotalBalance.toLocaleString()}</span>
              </div>
            )}
          </div>

          <div className="text-center">
            <p className="font-bold mb-1 uppercase">{settings?.receiptHeader || 'Thank you for shopping with us!'}</p>
            <p>{settings?.receiptFooter || 'Goods once sold are not returnable.'}</p>
            <p className="mt-2">********************************</p>
          </div>
        </div>
      )}
    </div>
  );
}
