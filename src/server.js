import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { summarize } from './summary.js';
import { isValidDay, parseInstant, utcOffset } from './time.js';

const MAX_BODY_BYTES = 16 * 1024;

const STATIC_FILES = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/index.html': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/style.css': ['style.css', 'text/css; charset=utf-8'],
};

class HttpError extends Error {
  constructor(status, code, message, details) {
    super(message);
    Object.assign(this, { status, code, details });
  }
}

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'unsupported_media_type', 'Нужен заголовок Content-Type: application/json');
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw new HttpError(413, 'payload_too_large', 'Слишком большое тело запроса');
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'invalid_json', 'Тело запроса — не корректный JSON');
  }
}

/** Поездка для ответа API: сохранённые поля + вычисленные для удобства клиента. */
function present(trip) {
  return {
    ...trip,
    net: trip.amount - trip.commission,
    durationMinutes: Math.round((parseInstant(trip.end) - parseInstant(trip.start)) / 60_000),
  };
}

function dayParam(raw) {
  const day = decodeURIComponent(raw);
  if (!isValidDay(day)) throw new HttpError(400, 'invalid_date', 'Дата должна быть в формате YYYY-MM-DD');
  return day;
}

export function createServer({ store, timeZone, publicDir }) {
  async function handleApi(req, res, pathname) {
    const method = req.method;
    const allow = (...methods) => {
      if (!methods.includes(method)) throw new HttpError(405, 'method_not_allowed', `Метод ${method} не поддерживается`);
    };

    if (pathname === '/api/health') {
      allow('GET');
      return sendJson(res, 200, { ok: true, trips: store.size });
    }

    if (pathname === '/api/config') {
      allow('GET');
      return sendJson(res, 200, { timeZone, utcOffset: utcOffset(timeZone) });
    }

    if (pathname === '/api/days') {
      allow('GET');
      return sendJson(res, 200, { days: store.days() });
    }

    const dayMatch = /^\/api\/days\/([^/]+)(?:\/(trips|summary))?$/.exec(pathname);
    if (dayMatch) {
      allow('GET');
      const date = dayParam(dayMatch[1]);
      const trips = store.listByDay(date);
      if (dayMatch[2] === 'trips') return sendJson(res, 200, { date, trips: trips.map(present) });
      if (dayMatch[2] === 'summary') return sendJson(res, 200, { date, summary: summarize(trips) });
      return sendJson(res, 200, { date, summary: summarize(trips), trips: trips.map(present) });
    }

    if (pathname === '/api/trips') {
      allow('POST');
      const result = store.add(await readJson(req));
      switch (result.status) {
        case 'created':
          return sendJson(res, 201, { created: true, trip: present(result.trip) });
        case 'exists':
          return sendJson(res, 200, { created: false, trip: present(result.trip) });
        case 'invalid':
          throw new HttpError(422, 'validation_error', 'Проверьте данные поездки', result.errors);
        case 'conflict': {
          const error = { code: result.code, message: result.message };
          if (result.conflictsWith) error.conflictsWith = result.conflictsWith;
          return sendJson(res, 409, { error });
        }
      }
    }

    throw new HttpError(404, 'not_found', 'Такого адреса в API нет');
  }

  async function handleStatic(req, res, pathname) {
    const file = STATIC_FILES[pathname];
    if (!file || (req.method !== 'GET' && req.method !== 'HEAD')) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Не найдено');
    }
    const [name, type] = file;
    const body = await fs.readFile(path.join(publicDir, name));
    res.writeHead(200, { 'Content-Type': type });
    res.end(req.method === 'HEAD' ? undefined : body);
  }

  return http.createServer(async (req, res) => {
    const { pathname } = new URL(req.url, 'http://localhost');
    try {
      if (pathname.startsWith('/api/')) await handleApi(req, res, pathname);
      else await handleStatic(req, res, pathname);
    } catch (err) {
      if (err instanceof HttpError) {
        const error = { code: err.code, message: err.message };
        if (err.details) error.details = err.details;
        return sendJson(res, err.status, { error });
      }
      console.error(err);
      sendJson(res, 500, { error: { code: 'internal', message: 'Внутренняя ошибка сервера' } });
    }
  });
}
