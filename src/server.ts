import express from 'express';

const PORT = Number(process.env.PORT ?? 3000);

const app = express();

app.get('/tenders', (_request, response) => {
  response.json({ results: [], count: 0 });
});

app.get('/tenders/:id', (_request, response) => {
  response.json({});
});

app.listen(PORT, () => {
  console.log(`API listening on http://localhost:${PORT}`);
});
