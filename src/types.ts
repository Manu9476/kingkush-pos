export interface SystemSettings {
  id: string;
  skuPrefix: string;
  badDebtThresholdDays: number;
  taxRate: number;
  loyaltyPointRate: number;
  updatedAt: string;
}

export interface UserProfile {
  uid: string;
  username: string;
  password?: string;
  email?: string;
  displayName: string;
  role: 'superadmin' | 'admin' | 'cashier';
  permissions: string[];
  status: 'active' | 'inactive';
  createdAt: string;
}

export interface Product {
  id: string;
  sku: string;
  barcode: string;
  name: string;
  categoryId: string;
  supplierId: string;
  buyingPrice: number;
  sellingPrice: number;
  stockQuantity: number;
  unitType: string;
  expiryDate?: string;
  lowStockThreshold: number;
  isHotItem: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  description?: string;
}

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone?: string;
  email?: string;
}

export interface Customer {
  id: string;
  customerCode?: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  loyaltyPoints: number;
  totalBalance?: number;
  createdAt: string;
}

export interface Sale {
  id: string;
  cashierId: string;
  cashierName: string;
  totalAmount: number;
  taxAmount: number;
  paymentMethod: 'cash' | 'mpesa' | 'card' | 'credit';
  amountPaid: number;
  balance: number;
  customerName?: string;
  customerId?: string;
  reference?: string;
  timestamp: { toDate: () => Date } | Date | string | { seconds: number; nanoseconds: number } | null;
  isCredit?: boolean;
  isRefunded?: boolean;
  refundAmount?: number;
  refundedAt?: string;
  refundedBy?: string;
  refundReason?: string;
  outstandingBalance?: number;
  newTotalBalance?: number;
}

export interface Credit {
  id: string;
  saleId: string;
  customerId?: string;
  customerName: string;
  totalAmount: number;
  amountPaid: number;
  outstandingBalance: number;
  items: string; // Summary of items
  timestamp: any;
  status: 'open' | 'settled';
}

export interface CreditPayment {
  id: string;
  creditId: string;
  saleId: string;
  amountPaid: number;
  remainingBalance?: number;
  paymentMethod: string;
  reference?: string;
  timestamp: any;
  cashierId: string;
  cashierName: string;
}

export interface SaleItem {
  id: string;
  saleId: string;
  productId: string;
  productName: string;
  barcode: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  name?: string;
  sellingPrice?: number;
  isRefunded?: boolean;
  status?: 'sold' | 'refunded';
  refundedAt?: string;
  refundedBy?: string;
}

export interface InventoryTransaction {
  id: string;
  productId: string;
  type: 'stock-in' | 'stock-out' | 'adjustment';
  quantity: number;
  reason?: string;
  timestamp: any;
  userId: string;
}

export interface LabelBatchItem {
  productId: string;
  name: string;
  sku: string;
  barcode: string;
  sellingPrice: number;
  copies: number;
}

export interface LabelTemplate {
  id: string;
  name: string;
  items: LabelBatchItem[];
  barcodeFormat: string;
  labelPreset: string;
  offsetX: number;
  offsetY: number;
  showPrice: boolean;
  ownerId: string;
  sharedWith: string[];
  isDefault?: boolean;
  createdAt: { toDate: () => Date } | Date | string | { seconds: number; nanoseconds: number };
  updatedAt: { toDate: () => Date } | Date | string | { seconds: number; nanoseconds: number };
}

export interface Expense {
  id: string;
  category: string;
  description: string;
  amount: number;
  date: { toDate: () => Date } | Date | string | { seconds: number; nanoseconds: number } | null;
  paymentMethod: 'cash' | 'mpesa' | 'bank' | 'other';
  reference?: string;
  recordedBy: string; // User ID
  recordedByName: string;
}

export interface ExpenseCategory {
  id: string;
  name: string;
  description?: string;
  createdAt: any;
}

export interface AuditLog {
  id: string;
  userId: string;
  userName: string;
  action: string;
  details: string;
  timestamp: { toDate: () => Date } | Date | string | { seconds: number; nanoseconds: number } | null;
}

export interface PurchaseOrder {
  id: string;
  supplierId: string;
  supplierName: string;
  items: {
    productId: string;
    productName: string;
    quantity: number;
    costPrice: number;
  }[];
  totalAmount: number;
  status: 'pending' | 'received' | 'cancelled';
  notes?: string;
  createdBy?: string;
  receivedBy?: string;
  createdAt: any;
  receivedAt?: { toDate: () => Date } | Date | string | { seconds: number; nanoseconds: number };
}
