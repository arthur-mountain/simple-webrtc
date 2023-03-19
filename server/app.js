import 'dotenv/config';
import express from 'express';
import path from 'path';
import './websocket.js';

const app = express();
const port = process.env.PORT || 8000;

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.resolve(process.cwd(), '../client')));

app.get('/', (_req, res) => {
  res.render('index.html');
});

app.get('/favicon.ico', (_, res) => {
  res.status(204).end();
});

app.post('/type', async (_, res) => {
  try {
    const types = (await import('./eventType.js')).default;
    res.json(types);
  } catch (error) {
    res.json(error.code);
  };
});

app.listen(port, () => {
  console.log(`Server starting with port:${port}...`);
});