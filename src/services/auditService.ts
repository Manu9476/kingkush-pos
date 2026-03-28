import { db, collection, addDoc, serverTimestamp } from '../data';
import { AuditLog } from '../types';

export const recordAuditLog = async (userId: string, userName: string, action: string, details: string) => {
  try {
    await addDoc(collection(db, 'audit_logs'), {
      userId,
      userName,
      action,
      details,
      timestamp: serverTimestamp()
    });
  } catch (error) {
    console.error('Error recording audit log:', error);
  }
};
