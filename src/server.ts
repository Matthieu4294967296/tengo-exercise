import express from 'express';
import { getTender, listTenders, parsePage } from './api/tenders.ts';

const PORT = Number(process.env.PORT ?? 3000);

const app = express();

app.get('/tenders', async (request, response) => {
  const { limit, offset } = parsePage(request.query as { limit?: string; offset?: string });
  response.json(await listTenders(limit, offset));
});

app.get('/tenders/:id', async (request, response) => {
  const rawId = request.params.id;
  if (!/^\d+$/.test(rawId)) {
    response.status(400).json({ error: 'id must be an integer' });
    return;
  }
  const tender = await getTender(Number(rawId));
  if (!tender) {
    response.status(404).json({ error: 'tender not found' });
    return;
  }
  response.json(tender);
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
