import { db, collection, addDoc, serverTimestamp } from '../data';

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
    if (process.env.NODE_ENV === 'development') {
      console.error('Error recording audit log:', error);
    }
  }
};
