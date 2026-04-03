import systemHandler from '../../backend/handlers/admin/system.js';

export default async function handler(req: any, res: any) {
  return systemHandler(req, res);
}
