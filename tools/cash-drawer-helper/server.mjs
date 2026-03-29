import http from 'node:http';
import net from 'node:net';

const port = Number(process.env.DRAWER_HELPER_PORT || 17363);
const printerHost = process.env.DRAWER_PRINTER_HOST || '';
const printerPort = Number(process.env.DRAWER_PRINTER_PORT || 9100);
const pulseHex = String(process.env.DRAWER_PULSE_HEX || '1B700019FA').replace(/[^a-fA-F0-9]/g, '');
const socketTimeoutMs = Number(process.env.DRAWER_SOCKET_TIMEOUT_MS || 4000);
const allowOrigin = process.env.DRAWER_ALLOW_ORIGIN || '*';
const dryRun = /^(1|true|yes)$/i.test(process.env.DRAWER_DRY_RUN || '');

function writeJson(res, statusCode, payload) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS'
  });
  res.end(JSON.stringify(payload));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function sendDrawerPulse() {
  return new Promise((resolve, reject) => {
    if (dryRun) {
      resolve({
        ok: true,
        mode: 'dry-run',
        printerHost: printerHost || null,
        printerPort,
        bytesSent: pulseHex.length / 2
      });
      return;
    }

    if (!printerHost) {
      reject(new Error('DRAWER_PRINTER_HOST is not configured.'));
      return;
    }

    const payload = Buffer.from(pulseHex, 'hex');
    let settled = false;
    const socket = net.createConnection({ host: printerHost, port: printerPort });

    const finish = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      callback(value);
    };

    socket.setTimeout(socketTimeoutMs, () => {
      finish(reject, new Error('Timed out while connecting to the drawer printer.'));
    });

    socket.once('error', (error) => {
      finish(reject, error);
    });

    socket.once('connect', () => {
      socket.write(payload, (error) => {
        if (error) {
          finish(reject, error);
          return;
        }

        finish(resolve, {
          ok: true,
          mode: 'network-printer',
          printerHost,
          printerPort,
          bytesSent: payload.length
        });
      });
    });
  });
}

const server = http.createServer(async (req, res) => {
  if (!req.url) {
    writeJson(res, 404, { error: 'Not Found' });
    return;
  }

  if (req.method === 'OPTIONS') {
    writeJson(res, 204, { ok: true });
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    writeJson(res, 200, {
      ok: true,
      dryRun,
      printerConfigured: Boolean(printerHost),
      printerHost: printerHost || null,
      printerPort
    });
    return;
  }

  if (req.method === 'POST' && req.url === '/open-drawer') {
    try {
      const body = await readJsonBody(req);
      const result = await sendDrawerPulse();

      writeJson(res, 200, {
        ok: true,
        result,
        eventType: typeof body.eventType === 'string' ? body.eventType : 'manual',
        saleId: typeof body.saleId === 'string' ? body.saleId : null,
        triggeredAt: new Date().toISOString()
      });
    } catch (error) {
      writeJson(res, 500, {
        error: error instanceof Error ? error.message : 'Failed to trigger cash drawer.'
      });
    }
    return;
  }

  writeJson(res, 404, { error: 'Not Found' });
});

server.listen(port, '127.0.0.1', () => {
  console.log(`[drawer-helper] listening on http://127.0.0.1:${port}`);
  if (dryRun) {
    console.log('[drawer-helper] running in dry-run mode');
  } else {
    console.log(`[drawer-helper] printer target ${printerHost || '<missing-host>'}:${printerPort}`);
  }
});
