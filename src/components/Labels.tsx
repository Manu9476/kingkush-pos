import { useState, useEffect, useRef } from 'react';
import { 
  db, 
  collection, 
  onSnapshot, 
  addDoc, 
  updateDoc, 
  deleteDoc, 
  doc, 
  query, 
  where,
  orderBy,
  limit,
  serverTimestamp,
  writeBatch,
  handleFirestoreError,
  OperationType
} from '../data';
import { Product, LabelBatchItem, LabelTemplate } from '../types';
import { useAuth } from '../App';
import { 
  Tag, 
  Plus, 
  Save, 
  Download, 
  Share2, 
  History, 
  Printer, 
  Grid, 
  CheckCircle2,
  X
} from 'lucide-react';
import JsBarcode from 'jsbarcode';
import { toast } from 'sonner';
import ConfirmDialog from './ConfirmDialog';

const PRESETS = [
  { id: 'a4_3x8', name: 'A4 3 x 8 (63.5mm x 29.6mm)', cols: 3, rows: 8, width: 63.5, height: 29.6 },
  { id: 'a4_4x10', name: 'A4 4 x 10 (48.5mm x 25.4mm)', cols: 4, rows: 10, width: 48.5, height: 25.4 },
  { id: 'single_50x30', name: 'Single 50mm x 30mm', cols: 1, rows: 1, width: 50, height: 30 },
];

const BARCODE_FORMATS = ['CODE128', 'EAN13', 'UPC', 'CODE39'];

export default function Labels() {
  const { user } = useAuth();
  const [products, setProducts] = useState<Product[]>([]);
  const [templates, setTemplates] = useState<LabelTemplate[]>([]);
  
  // Batch State
  const [batch, setBatch] = useState<LabelBatchItem[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [copies, setCopies] = useState(12);
  
  // Config State
  const [barcodeFormat, setBarcodeFormat] = useState('CODE128');
  const [selectedPresetId, setSelectedPresetId] = useState(PRESETS[0].id);
  const [offsetX, setOffsetX] = useState(1);
  const [offsetY, setOffsetY] = useState(1);
  const [showPrice, setShowPrice] = useState(true);
  
  // Template State
  const [templateName, setTemplateName] = useState('');
  const [selectedTemplateId, setSelectedTemplateId] = useState('');

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<any[]>([]);

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

  useEffect(() => {
    if (!user) return;
    const unsubProducts = onSnapshot(collection(db, 'products'), 
      (snapshot) => setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Product))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'products')
    );

    const unsubTemplates = onSnapshot(query(collection(db, 'label_templates'), 
      where('ownerId', '==', user?.uid)), 
      (snapshot) => setTemplates(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as LabelTemplate))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'label_templates')
    );

    const unsubHistory = onSnapshot(query(collection(db, 'label_history'), 
      where('userId', '==', user?.uid), orderBy('timestamp', 'desc'), limit(10)), 
      (snapshot) => setHistory(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }))),
      (err) => handleFirestoreError(err, OperationType.LIST, 'label_history')
    );

    return () => {
      unsubProducts();
      unsubTemplates();
      unsubHistory();
    };
  }, [user]);

  const addToBatch = () => {
    const product = products.find(p => p.id === selectedProductId);
    if (!product) return;

    setBatch(prev => {
      const existing = prev.find(item => item.productId === product.id);
      if (existing) {
        return prev.map(item => 
          item.productId === product.id ? { ...item, copies: item.copies + copies } : item
        );
      }
      return [...prev, {
        productId: product.id,
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        sellingPrice: product.sellingPrice,
        copies: copies
      }];
    });
  };

  const removeFromBatch = (productId: string) => {
    setBatch(prev => prev.filter(item => item.productId !== productId));
  };

  const updateBatchCopies = (productId: string, newCopies: number) => {
    setBatch(prev => prev.map(item => 
      item.productId === productId ? { ...item, copies: Math.max(1, newCopies) } : item
    ));
  };

  const clearBatch = () => setBatch([]);

  const saveTemplate = async () => {
    if (!templateName.trim()) {
      toast.error('Please enter a template name');
      return;
    }
    
    const templateData = {
      name: templateName,
      items: batch,
      barcodeFormat,
      labelPreset: selectedPresetId,
      offsetX,
      offsetY,
      showPrice,
      ownerId: user?.uid || null,
      sharedWith: [],
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp()
    };

    try {
      if (selectedTemplateId) {
        const { createdAt, ...updateData } = templateData;
        await updateDoc(doc(db, 'label_templates', selectedTemplateId), {
          ...updateData,
          updatedAt: serverTimestamp()
        });
      } else {
        await addDoc(collection(db, 'label_templates'), templateData);
      }
      alert('Template saved successfully!');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'label_templates');
      toast.error('Failed to save template');
    }
  };

  const setAsDefault = async () => {
    if (!selectedTemplateId) return;
    try {
      const batchOp = writeBatch(db);
      // Unset current default
      templates.filter(t => t.isDefault).forEach(t => {
        batchOp.update(doc(db, 'label_templates', t.id), { isDefault: false });
      });
      // Set new default
      batchOp.update(doc(db, 'label_templates', selectedTemplateId), { isDefault: true });
      await batchOp.commit();
      toast.success('Template set as default');
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'label_templates');
      toast.error('Failed to set default template');
    }
  };

  const shareTemplate = async () => {
    if (!selectedTemplateId) return;
    const email = window.prompt('Enter admin email to share with:');
    if (!email) return;

    try {
      // In a real app, we'd look up the user by email. 
      // For now, we'll just add the email to the sharedWith array.
      const template = templates.find(t => t.id === selectedTemplateId);
      if (!template) return;

      const sharedWith = [...(template.sharedWith || []), email];
      await updateDoc(doc(db, 'label_templates', selectedTemplateId), { sharedWith });
      toast.success(`Template shared with ${email}`);
    } catch (error) {
      handleFirestoreError(error, OperationType.WRITE, 'label_templates');
      toast.error('Failed to share template');
    }
  };

  const loadTemplate = (id: string) => {
    const template = templates.find(t => t.id === id);
    if (!template) return;

    setBatch(template.items);
    setBarcodeFormat(template.barcodeFormat);
    setSelectedPresetId(template.labelPreset);
    setOffsetX(template.offsetX);
    setOffsetY(template.offsetY);
    setShowPrice(template.showPrice);
    setTemplateName(template.name);
    setSelectedTemplateId(template.id);
  };

  const removeAccess = async () => {
    if (!selectedTemplateId) return;
    
    setConfirmConfig({
      isOpen: true,
      title: 'Remove Shared Access',
      message: 'Are you sure you want to remove all shared access? This will revoke access for all other admins.',
      onConfirm: async () => {
        try {
          await updateDoc(doc(db, 'label_templates', selectedTemplateId), { sharedWith: [] });
          toast.success('Shared access removed');
        } catch (error) {
          handleFirestoreError(error, OperationType.WRITE, 'label_templates');
          toast.error('Failed to remove access');
        }
      },
      type: 'danger'
    });
  };

  const deleteTemplate = async () => {
    if (!selectedTemplateId) return;
    
    setConfirmConfig({
      isOpen: true,
      title: 'Delete Template',
      message: 'Are you sure you want to delete this template? This action cannot be undone.',
      onConfirm: async () => {
        try {
          await deleteDoc(doc(db, 'label_templates', selectedTemplateId));
          setSelectedTemplateId('');
          setTemplateName('');
          toast.success('Template deleted');
        } catch (error) {
          handleFirestoreError(error, OperationType.DELETE, 'label_templates');
          toast.error('Failed to delete template');
        }
      },
      type: 'danger'
    });
  };

  const printLabels = async () => {
    if (batch.length === 0) return;
    
    // Save to history
    try {
      await addDoc(collection(db, 'label_history'), {
        userId: user?.uid || null,
        items: batch,
        timestamp: serverTimestamp(),
        totalLabels
      });
    } catch (error) {
      if (process.env.NODE_ENV === 'development') {
        console.error('Failed to save history', error);
      }
    }

    const printWindow = window.open('', '_blank');
    if (!printWindow) return;

    const preset = PRESETS.find(p => p.id === selectedPresetId) || PRESETS[0];
    
    // Generate barcode images for each unique barcode in batch
    const barcodeImages: Record<string, string> = {};
    batch.forEach(item => {
      const canvas = document.createElement('canvas');
      try {
        JsBarcode(canvas, item.barcode, { format: barcodeFormat as any, width: 1, height: 30, fontSize: 10 });
        barcodeImages[item.barcode] = canvas.toDataURL("image/png");
      } catch (e) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Barcode generation failed', e);
        }
      }
    });

    const labelHtml = batch.flatMap(item => 
      Array(item.copies).fill(0).map(() => `
        <div class="label" style="width: ${preset.width}mm; height: ${preset.height}mm; padding: ${offsetY}mm ${offsetX}mm;">
          <div class="name">${item.name}</div>
          <img src="${barcodeImages[item.barcode]}" />
          <div class="sku">${item.sku}</div>
          ${showPrice ? `<div class="price">KES ${item.sellingPrice.toLocaleString()}</div>` : ''}
        </div>
      `)
    ).join('');

    printWindow.document.write(`
      <html>
        <head>
          <title>Print Labels</title>
          <style>
            @page { margin: 0; size: A4; }
            body { margin: 0; padding: 0; font-family: sans-serif; }
            .grid { 
              display: grid; 
              grid-template-columns: repeat(${preset.cols}, ${preset.width}mm);
              gap: 0;
            }
            .label { 
              box-sizing: border-box;
              border: 0.1mm solid #eee;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              text-align: center;
              overflow: hidden;
            }
            .name { font-weight: bold; font-size: 8pt; margin-bottom: 2pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; width: 100%; }
            img { max-width: 90%; height: auto; }
            .sku { font-size: 6pt; color: #666; margin-top: 1pt; }
            .price { font-size: 9pt; font-weight: 900; color: #000; margin-top: 2pt; }
          </style>
        </head>
        <body>
          <div class="grid">
            ${labelHtml}
          </div>
          <script>
            window.onload = () => { window.print(); window.close(); };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const totalLabels = batch.reduce((sum, item) => sum + item.copies, 0);

  return (
    <div className="route-workspace space-y-8 pb-20">
      <ConfirmDialog
        isOpen={confirmConfig.isOpen}
        title={confirmConfig.title}
        message={confirmConfig.message}
        onConfirm={confirmConfig.onConfirm}
        onCancel={() => setConfirmConfig(prev => ({ ...prev, isOpen: false }))}
        type={confirmConfig.type}
      />
      <div className="route-body desktop-scroll pr-1 custom-scrollbar">
      <div className="bg-white p-8 rounded-4xl shadow-sm border border-gray-100">
        <h1 className="text-3xl font-black text-gray-900 mb-2">Barcode Label Sheets</h1>
        <p className="text-gray-500 mb-8">Choose a product and label size, then print a sheet for sticker paper.</p>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-12">
          {/* Left: Configuration */}
          <div className="space-y-8">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-900 uppercase tracking-wider">Product</label>
                <select 
                  value={selectedProductId}
                  onChange={e => setSelectedProductId(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all appearance-none"
                >
                  <option value="">Select a product...</option>
                  {products.map(p => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-900 uppercase tracking-wider">Copies</label>
                <input 
                  type="number"
                  value={copies}
                  onChange={e => setCopies(parseInt(e.target.value) || 0)}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                />
              </div>
            </div>

            <div className="flex gap-4">
              <button 
                onClick={addToBatch}
                className="flex-1 py-4 bg-indigo-50 text-indigo-600 rounded-2xl font-bold hover:bg-indigo-100 transition-all flex items-center justify-center gap-2"
              >
                <Plus className="w-5 h-5" />
                Add Product To Batch
              </button>
              <button 
                onClick={clearBatch}
                className="px-8 py-4 bg-gray-50 text-gray-600 rounded-2xl font-bold hover:bg-gray-100 transition-all"
              >
                Clear Batch
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-900 uppercase tracking-wider">Barcode Format</label>
                <select 
                  value={barcodeFormat}
                  onChange={e => setBarcodeFormat(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                >
                  {BARCODE_FORMATS.map(f => <option key={f} value={f}>{f}</option>)}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-900 uppercase tracking-wider">Label Preset</label>
                <select 
                  value={selectedPresetId}
                  onChange={e => setSelectedPresetId(e.target.value)}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                >
                  {PRESETS.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-900 uppercase tracking-wider">Offset X (mm)</label>
                <input 
                  type="number"
                  value={offsetX}
                  onChange={e => setOffsetX(parseFloat(e.target.value) || 0)}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-900 uppercase tracking-wider">Offset Y (mm)</label>
                <input 
                  type="number"
                  value={offsetY}
                  onChange={e => setOffsetY(parseFloat(e.target.value) || 0)}
                  className="w-full p-4 bg-gray-50 border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <input 
                type="checkbox"
                id="showPrice"
                checked={showPrice}
                onChange={e => setShowPrice(e.target.checked)}
                className="w-5 h-5 rounded border-gray-300 text-indigo-600 focus:ring-indigo-600"
              />
              <label htmlFor="showPrice" className="text-sm font-bold text-gray-900 uppercase tracking-wider cursor-pointer">
                Show price on labels
              </label>
            </div>

            <div className="flex gap-4 pt-4">
              <button 
                onClick={printLabels}
                className="flex-1 py-4 bg-indigo-600 text-white rounded-2xl font-bold hover:bg-indigo-700 shadow-lg shadow-indigo-100 transition-all flex items-center justify-center gap-2"
              >
                <Printer className="w-5 h-5" />
                Print Labels
              </button>
              <button className="px-8 py-4 bg-teal-50 text-teal-600 rounded-2xl font-bold hover:bg-teal-100 transition-all flex items-center justify-center gap-2">
                <Grid className="w-5 h-5" />
                Generate Sheet
              </button>
            </div>
          </div>

          {/* Right: Template Manager */}
          <div className="bg-gray-50/50 p-8 rounded-4xl border border-gray-100 space-y-8">
            <div>
              <h3 className="text-xl font-black text-gray-900 mb-2">Template Manager</h3>
              <p className="text-sm text-gray-500">Save, reuse, share, and control access to label batches.</p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-900 uppercase tracking-wider">Template Name</label>
                <input 
                  type="text"
                  value={templateName}
                  onChange={e => setTemplateName(e.target.value)}
                  placeholder="e.g., sugar labels"
                  className="w-full p-4 bg-white border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-bold text-gray-900 uppercase tracking-wider">Saved Templates</label>
                <select 
                  value={selectedTemplateId}
                  onChange={e => loadTemplate(e.target.value)}
                  className="w-full p-4 bg-white border border-gray-100 rounded-2xl focus:ring-2 focus:ring-indigo-600 outline-none transition-all"
                >
                  <option value="">Select a template...</option>
                  {templates.map(t => (
                    <option key={t.id} value={t.id}>{t.name} {t.isDefault ? '[default]' : ''}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              <span className="px-3 py-1 bg-orange-100 text-orange-700 rounded-full text-[10px] font-bold uppercase tracking-wider">
                {templates.find(t => t.id === selectedTemplateId)?.ownerId === user?.uid ? 'Owner template' : 'Shared template'}
              </span>
              <span className="px-3 py-1 bg-gray-100 text-gray-600 rounded-full text-[10px] font-bold uppercase tracking-wider">
                Shared with {templates.find(t => t.id === selectedTemplateId)?.sharedWith?.length || 0} admins
              </span>
              {templates.find(t => t.id === selectedTemplateId)?.isDefault && (
                <span className="px-3 py-1 bg-yellow-100 text-yellow-700 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  Current default template
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <button onClick={saveTemplate} className="py-3 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-700 hover:border-indigo-600 hover:text-indigo-600 transition-all flex items-center justify-center gap-2">
                <Save className="w-4 h-4" />
                Save
              </button>
              <button onClick={() => selectedTemplateId && loadTemplate(selectedTemplateId)} className="py-3 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-700 hover:border-indigo-600 hover:text-indigo-600 transition-all flex items-center justify-center gap-2">
                <Download className="w-4 h-4" />
                Load
              </button>
              <button onClick={setAsDefault} className="py-3 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-700 hover:border-indigo-600 hover:text-indigo-600 transition-all flex items-center justify-center gap-2">
                <CheckCircle2 className="w-4 h-4" />
                Default
              </button>
              <button onClick={shareTemplate} className="py-3 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-700 hover:border-indigo-600 hover:text-indigo-600 transition-all flex items-center justify-center gap-2">
                <Share2 className="w-4 h-4" />
                Share
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3">
              <button onClick={removeAccess} className="py-3 bg-red-50 text-red-600 rounded-xl text-xs font-bold hover:bg-red-100 transition-all">
                Remove Access
              </button>
              <button onClick={() => setShowHistory(true)} className="py-3 bg-gray-100 text-gray-600 rounded-xl text-xs font-bold hover:bg-gray-200 transition-all flex items-center justify-center gap-2">
                <History className="w-4 h-4" />
                History
              </button>
              <button onClick={deleteTemplate} className="py-3 bg-red-600 text-white rounded-xl text-xs font-bold hover:bg-red-700 transition-all">
                Delete
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Batch Table */}
      <div className="bg-white rounded-4xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto max-h-150 overflow-y-auto pr-2 custom-scrollbar">
          <table className="w-full text-left">
            <thead className="sticky top-0 z-10 shadow-sm bg-gray-50/50 border-b border-gray-100">
              <tr className="text-[10px] uppercase font-black text-gray-600 tracking-widest">
                <th className="px-8 py-6">Product</th>
                <th className="px-8 py-6">SKU</th>
                <th className="px-8 py-6">Copies</th>
                <th className="px-8 py-6 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {batch.map(item => (
                <tr key={item.productId} className="group hover:bg-gray-50/30 transition-colors">
                  <td className="px-8 py-6 font-bold text-gray-900">{item.name}</td>
                  <td className="px-8 py-6 text-sm text-gray-500 font-mono">{item.sku}</td>
                  <td className="px-8 py-6">
                    <input 
                      type="number"
                      value={item.copies}
                      onChange={e => updateBatchCopies(item.productId, parseInt(e.target.value) || 0)}
                      className="w-20 p-2 bg-gray-50 border border-gray-100 rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-indigo-600"
                    />
                  </td>
                  <td className="px-8 py-6 text-right">
                    <button 
                      onClick={() => removeFromBatch(item.productId)}
                      className="px-4 py-2 bg-red-50 text-red-600 rounded-xl text-xs font-bold hover:bg-red-100 transition-all"
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {batch.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-8 py-20 text-center">
                    <Tag className="w-12 h-12 text-gray-100 mx-auto mb-4" />
                    <p className="text-sm font-bold text-gray-500 uppercase tracking-widest">Batch is empty</p>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Preview Section */}
      <div className="bg-white p-8 rounded-4xl shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-8">
          <h2 className="text-2xl font-black text-gray-900">Preview</h2>
          <span className="text-sm font-bold text-indigo-600 bg-indigo-50 px-4 py-2 rounded-full">
            {totalLabels} labels
          </span>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-h-150 overflow-y-auto p-4 bg-gray-50 rounded-4xl">
          {batch.flatMap(item => 
            Array(item.copies).fill(0).map((_, i) => (
              <LabelPreview 
                key={`${item.productId}-${i}`} 
                item={item} 
                format={barcodeFormat}
                showPrice={showPrice}
                offsetX={offsetX}
                offsetY={offsetY}
              />
            ))
          )}
          {batch.length === 0 && (
            <div className="col-span-full py-20 text-center">
              <p className="text-gray-400 font-medium italic">Add products to batch to see preview</p>
            </div>
          )}
        </div>
      </div>

      </div>
      {/* History Modal */}
      {showHistory && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-4xl w-full max-w-2xl overflow-hidden shadow-2xl">
            <div className="p-6 bg-indigo-600 text-white flex justify-between items-center">
              <h3 className="text-xl font-bold">Print History</h3>
              <button onClick={() => setShowHistory(false)} className="p-2 hover:bg-white/20 rounded-full transition-colors">
                <X className="w-6 h-6" />
              </button>
            </div>
            <div className="p-6 max-h-[60vh] overflow-y-auto">
              <div className="space-y-4">
                {history.map((h, i) => (
                  <div key={h.id} className="p-4 bg-gray-50 rounded-2xl border border-gray-100 flex items-center justify-between">
                    <div>
                      <p className="font-bold text-gray-900">Batch #{history.length - i}</p>
                      <p className="text-sm text-gray-500">{h.timestamp?.toDate().toLocaleString()}</p>
                      <p className="text-xs text-indigo-600 font-bold mt-1">{h.totalLabels} labels • {h.items.length} products</p>
                    </div>
                    <button 
                      onClick={() => { setBatch(h.items); setShowHistory(false); }}
                      className="px-4 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-700 hover:border-indigo-600 hover:text-indigo-600 transition-all"
                    >
                      Restore Batch
                    </button>
                  </div>
                ))}
                {history.length === 0 && (
                  <div className="text-center py-10 text-gray-400">
                    No history found
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function LabelPreview({ item, format, showPrice, offsetX, offsetY }: { 
  item: LabelBatchItem, 
  format: string, 
  showPrice: boolean,
  offsetX: number,
  offsetY: number
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (canvasRef.current) {
      try {
        JsBarcode(canvasRef.current, item.barcode, {
          format: format as any,
          width: 1.5,
          height: 40,
          displayValue: true,
          fontSize: 10,
          margin: 0
        });
      } catch (e) {
        if (process.env.NODE_ENV === 'development') {
          console.error('Barcode preview failed', e);
        }
      }
    }
  }, [item.barcode, format]);

  return (
    <div 
      className="bg-white border border-dashed border-gray-300 rounded-xl flex flex-col items-center justify-center text-center shadow-sm overflow-hidden"
      style={{ padding: `${offsetY + 4}mm ${offsetX + 4}mm` }}
    >
      <div className="w-full text-[10px] font-black text-gray-900 mb-1 truncate">{item.name}</div>
      <canvas ref={canvasRef} className="max-w-full h-auto" />
      <div className="w-full flex justify-between items-center mt-2 px-1">
        <span className="text-[8px] font-bold text-gray-600 font-mono">{item.sku}</span>
        {showPrice && (
          <span className="text-[10px] font-black text-indigo-600">KES {item.sellingPrice.toLocaleString()}</span>
        )}
      </div>
    </div>
  );
}
