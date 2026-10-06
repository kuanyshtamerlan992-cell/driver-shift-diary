import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TripStore } from './store.js';
import { createServer } from './server.js';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

const port = Number(process.env.PORT ?? 3000);
const timeZone = process.env.APP_TIMEZONE ?? 'Asia/Almaty';
const dataFile = path.resolve(process.env.DATA_FILE ?? path.join(root, 'data', 'trips.json'));

// Проверяем часовой пояс при старте, а не на первом запросе.
new Intl.DateTimeFormat('en-US', { timeZone });

const store = TripStore.open({
  file: dataFile,
  seedFile: path.join(root, 'data', 'trips.sample.json'),
  timeZone,
});

createServer({ store, timeZone, publicDir: path.join(root, 'public') }).listen(port, () => {
  console.log(`Дневник смен водителя: http://localhost:${port}`);
  console.log(`Данные: ${dataFile} (${store.size} поездок), часовой пояс: ${timeZone}`);
});
